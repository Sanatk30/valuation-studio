/**
 * Per-method checks: build a method's workbook, recalculate it with
 * HyperFormula and compare it, cell by cell, with the engine the app runs.
 * Each check returns { failures: [msg], checks: n }.
 *
 * Equality: relative error ≤ 1e-9 (absolute for values near 0). An engine NaN
 * must be NA / NM text in Excel.
 */
import { buildWorkbook } from '../../src/lib/excel/exportExcel.js';
import { computeThreeStatement } from '../../src/lib/engine/threeStatement.js';
import { computeLbo, lboSensitivity, lboHoldSensitivity } from '../../src/lib/engine/lbo.js';
import { computeIpo } from '../../src/lib/engine/ipo.js';
import { computeForecastRatios, computeHistoryRatios } from '../../src/lib/engine/ratios.js';
import { hasHistory } from '../../src/lib/historyModel.js';
import { recalc, colLetter } from './recalc.mjs';
import { checkCompsWorkbook, checkPrecedentWorkbook } from './templateChecks.mjs';
import { checkDcfWorkbook } from './dcfChecks.mjs';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
/** Scale a numeric cell (a % shown as a fraction); text such as "NA" passes through. */
const sc = (v, k) => (typeof v === 'number' ? v * k : v);

/** A check context: collects failures with a readable message. */
function ctx(label) {
  const failures = [];
  let checks = 0;
  const same = (xl, eng, msg, tol = 1e-9) => {
    checks++;
    if (!isNum(eng)) {
      if (!(typeof xl === 'string' || (xl && typeof xl === 'object' && xl.type))) failures.push(`${label}: ${msg} — engine NA, Excel ${JSON.stringify(xl)}`);
      return;
    }
    if (!isNum(xl) || Math.abs(xl - eng) > tol * Math.max(1, Math.abs(eng))) failures.push(`${label}: ${msg} — Excel ${JSON.stringify(xl)} vs engine ${eng}`);
  };
  const truthy = (cond, msg) => { checks++; if (!cond) failures.push(`${label}: ${msg}`); };
  return { same, truthy, failures, get checks() { return checks; } };
}

/** Build + recalc, and fail on any evaluation error. */
function open(a, methodId, opts, T) {
  const wb = buildWorkbook(a, methodId, opts);
  const X = recalc(wb);
  const errs = X.errors();
  T.truthy(errs.length === 0, `no evaluation errors (got ${errs.length}: ${errs.slice(0, 3).map((e) => `${e.sheet}!${e.addr} ${e.err} =${e.formula.slice(0, 80)}`).join(' | ')})`);
  return { wb, X };
}

const need = (T, r, what) => { T.truthy(r > 0, `row "${what}" exists`); return r; };

/* ============================================================ 3-Statement */

function checkStatements(a, X, T, { balanceSheet = true } = {}) {
  const ts = computeThreeStatement(a);
  const n = ts.ops.n;
  const S = '3 Statement';
  const col = (i) => colLetter(3 + i);
  const per = (label, arr, msg, sign = 1) => {
    const r = need(T, X.row(S, label), label);
    for (let i = 0; i < n; i++) T.same(sc(X.get(S, `${col(i)}${r}`), sign), arr[i], `${msg} Y${i + 1}`);
  };
  per('Net income', ts.netIncome, 'net income');
  per('Pre-tax income', ts.ebt, 'pre-tax income');
  per('Less: Tax (after tax losses)', ts.taxAmt, 'tax', -1);
  per('Tax losses carried forward', ts.nolClose, 'NOL');
  per('Closing cash', ts.closeCash, 'closing cash');
  per('Closing debt', ts.closeDebt, 'closing debt');
  if (balanceSheet) {
    per("Shareholders' equity", ts.equity, 'equity');
    per('Total net assets', ts.assets, 'assets');
    T.same(X.get(S, `B${X.row(S, "Shareholders' equity")}`), ts.equity0, 'opening equity');
    T.same(X.get(S, `B${X.row(S, 'Other net assets / (liabilities)')}`), ts.otherNetAssets, 'other net assets');
    const cr = X.row(S, 'Balance check (must be 0)');
    for (let i = 0; i < n; i++) T.truthy(Math.abs(X.get(S, `${col(i)}${cr}`)) < 1e-6, `balance ties Y${i + 1}`);
  }
  return ts;
}

export function checkTs(a, opts = {}, methodId = 'ts') {
  const T = ctx(`${methodId}${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { X } = open(a, methodId, opts, T);
  checkStatements(a, X, T);
  // the forecast ratio block, row for row
  const R = computeForecastRatios(a);
  for (const sec of R.sections) {
    for (const row of sec.rows) {
      const r = X.row('3 Statement', row.label);
      T.truthy(r > 0, `ratio row "${row.label}"`);
      if (r < 0) continue;
      row.vals.forEach((v, i) => T.same(sc(X.get('3 Statement', `${colLetter(3 + i)}${r}`), (row.fmt === 'pct' ? 100 : 1)), v, `${row.label} Y${i + 1}`, 1e-8));
    }
  }
  if (methodId === 'ratios' && !opts.skipped?.history && hasHistory(a.history)) {
    const freq = a.ratio?.freq === 'Q' && a.history?.quarterly?.dates?.length ? 'Q' : 'Y';
    const periods = Number.isInteger(a.ratio?.histYears) ? a.ratio.histYears * (freq === 'Q' ? 4 : 1) : null;
    const H = computeHistoryRatios(a, freq, periods);
    const all = a.history[freq === 'Q' ? 'quarterly' : 'annual'].dates.length;
    const first = all - H.N;
    for (const sec of H.sections) {
      for (const row of sec.rows) {
        const r = X.row('Past Ratios', row.label);
        T.truthy(r > 0, `past ratio row "${row.label}"`);
        if (r < 0) continue;
        row.vals.forEach((v, j) => T.same(sc(X.get('Past Ratios', `${colLetter(2 + first + j)}${r}`), (row.fmt === 'pct' ? 100 : 1)), v, `past ${row.label} ${H.labels[j]}`, 1e-8));
      }
    }
  }
  return T;
}

/* ================================================================== LBO */

export function checkLbo(a, opts = {}) {
  const T = ctx(`lbo${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { X } = open(a, 'lbo', opts, T);
  const l = computeLbo(a);
  const S = 'LBO';
  const b = (label, eng, msg = label, scale = 1) => T.same(sc(X.get(S, `B${need(T, X.row(S, label), label)}`), scale), eng, msg);
  b('Total uses', l.uses);
  b('Sponsor equity (plug)', l.sponsorEquity);
  b('Exit equity value', l.exitEquity);
  b('Net debt at exit', l.netDebtExit);
  b('MOIC', l.moic);
  b('IRR (no interim distributions)', l.irr, 'IRR', 100);
  b('Exit equity (check)', l.exitEquity, 'value-creation bridge ties');
  b('Max entry enterprise value', l.entryEvMax);
  b('Floor price per share (at the hurdle)', l.floorPrice);
  b('Floor price — hurdle + step (low)', l.floorLow);
  b('Floor price — hurdle − step (high)', l.floorHigh);
  const n = l.ops.n;
  const per = (label, arr, msg, sign = 1) => {
    const r = need(T, X.row(S, label), label);
    for (let i = 0; i < n; i++) T.same(sc(X.get(S, `${colLetter(3 + i)}${r}`), sign), arr[i], `${msg} Y${i + 1}`);
  };
  per('Net income', l.netIncome, 'net income');
  per('Free cash flow', l.fcf, 'FCF');
  per('Tax losses carried forward', l.nolClose, 'NOL');
  per('Cash balance', l.cashBal, 'cash');
  per('Closing senior debt', l.closeSenior, 'senior');
  per('Closing mezzanine debt', l.closeMezz, 'mezz');
  per('Less: Cash interest', l.cashInterest, 'cash interest', -1);
  const s1 = lboSensitivity(a);
  const g1 = need(T, X.row(S, 'SENSITIVITY — IRR: ENTRY (rows) × EXIT MULTIPLE (cols)'), 'entry grid');
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) T.same(sc(X.get(S, `${colLetter(2 + j)}${g1 + 2 + i}`), 100), s1.grid[i][j], `entry×exit [${i}][${j}]`);
  const s2 = lboHoldSensitivity(a);
  const g2 = need(T, X.row(S, 'SENSITIVITY — IRR: HOLDING PERIOD (rows) × EXIT MULTIPLE (cols)'), 'hold grid');
  s2.years.forEach((y, i) => { for (let j = 0; j < 5; j++) T.same(sc(X.get(S, `${colLetter(2 + j)}${g2 + 2 + i}`), 100), s2.grid[i][j], `hold ${y}y [${j}]`); });
  return T;
}

/* ================================================================== IPO */

export function checkIpo(a, opts = {}) {
  const T = ctx(`ipo${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { X } = open(a, 'ipo', opts, T);
  checkStatements(a, X, T, { balanceSheet: false });
  const p = computeIpo(a);
  const S = 'IPO';
  const b = (label, eng, scale = 1) => T.same(sc(X.get(S, `B${need(T, X.row(S, label), label)}`), scale), eng, label);
  b('Fair pre-money equity value', p.fairEquityPre);
  b('OFFER PRICE', p.offerPrice);
  b('Primary shares issued', p.primaryShares);
  b('Greenshoe shares (size × % exercised)', p.greenshoeShares);
  b('Post-IPO shares outstanding', p.postShares);
  b('Greenshoe proceeds', p.greenshoeProceeds);
  b('Gross primary proceeds (incl. primary greenshoe)', p.grossPrimary);
  b('Gross secondary proceeds (to selling holders)', p.grossSecondary);
  b('Net primary proceeds to the company', p.netPrimary);
  b('Net debt post-IPO', p.netDebtPost);
  b('Pro-forma Year-1 pre-tax income', p.ebtPost);
  b('Pro-forma tax (after tax losses)', p.taxPost);
  b('Pro-forma Year-1 net income', p.niPost);
  b('Year-1 EPS post-IPO', p.epsPost);
  b('EPS dilution', p.epsDilution, 100);
  b('Market cap at the offer (post-greenshoe)', p.mktCapAtOffer);
  b('Fair value per share post-IPO', p.fairPricePost);
  b('Uplift when the discount unwinds', p.uplift, 100);
  b('Bookbuild low (offer − band)', p.rangeLow);
  b('Free float (new investors)', p.freeFloat);
  b('Existing holders', p.existingPost);
  return T;
}

/* ============================================ Comps / Precedent / DCF (templates) */

/** The template workbooks (test/helpers/templateChecks.mjs), in this file's { failures, checks } shape. */
const adapt = (label, res) => ({ failures: res.fails.map((f) => `${label}: ${f}`), checks: res.checks });
export const checkComps = (a, opts = {}) => adapt(`comps${opts.tag ? ` [${opts.tag}]` : ''}`, checkCompsWorkbook(a, opts));
export const checkPrecedent = (a, opts = {}) => adapt(`precedent${opts.tag ? ` [${opts.tag}]` : ''}`, checkPrecedentWorkbook(a, opts));
export const checkDcf = (a, opts = {}) => adapt(`dcf${opts.tag ? ` [${opts.tag}]` : ''}`, checkDcfWorkbook(a, opts));

/* ============================================================= Combined */

export function checkCombined(a, combined, opts = {}) {
  const T = ctx(`combined${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { X } = open(a, 'combined', { ...opts, combined }, T);
  const ok = combined.rows.length > 0 && combined.rows.every((r) => Number.isFinite(r.value) && Number.isFinite(r.weight));
  const value = ok ? combined.rows.reduce((s, r) => s + (r.weight / 100) * r.value, 0) : NaN;
  const px = combined.marketPrice;
  T.same(X.get('Combined', `D${X.row('Combined', 'Weighted value per share', 'B')}`), value, 'weighted value');
  T.same(sc(X.get('Combined', `D${X.row('Combined', 'Upside / (downside) to the market price', 'B')}`), 100), px > 0 && Number.isFinite(value) ? (value / px - 1) * 100 : NaN, 'upside');
  T.truthy(X.sheets.length === 2, `combined file = Cover + one sheet (got ${X.sheets.join(', ')})`);
  return T;
}
