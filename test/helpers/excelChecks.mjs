/**
 * Per-method checks: build a method's workbook, recalculate it with
 * HyperFormula and compare it, cell by cell, with the engine the app runs.
 * Each check returns { failures: [msg], checks: n }.
 *
 * Equality: relative error ≤ 1e-9 (absolute for values near 0). An engine NaN
 * must be NA / NM text in Excel.
 */
import { buildWorkbook } from '../../src/lib/excel/exportExcel.js';
import { companyLayout } from '../../src/lib/excel/compsSheets.js';
import { dealLayout } from '../../src/lib/excel/precedentSheets.js';
import { computeDcf, dcfSensitivity, dcfReportedHistory } from '../../src/lib/engine/dcf.js';
import { computeWacc, waccSensitivity, betaPeerStats } from '../../src/lib/engine/wacc.js';
import { computeThreeStatement } from '../../src/lib/engine/threeStatement.js';
import { computeLbo, lboSensitivity, lboHoldSensitivity } from '../../src/lib/engine/lbo.js';
import { computeIpo } from '../../src/lib/engine/ipo.js';
import { computeForecastRatios, computeHistoryRatios } from '../../src/lib/engine/ratios.js';
import { computeComps, targetCompanyPage, BENCH1_GROUPS, BENCH2_GROUPS, OUTPUT_GROUPS } from '../../src/lib/engine/comps.js';
import { computeCompany, P } from '../../src/lib/engine/compsCo.js';
import { computePrecedent } from '../../src/lib/engine/precedent.js';
import { PREMIUM_DAYS } from '../../src/lib/engine/precedentDeal.js';
import { runRegression } from '../../src/lib/engine/regressionModel.js';
import { hasHistory } from '../../src/lib/historyModel.js';
import { recalc, colLetter } from './recalc.mjs';

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

/* ================================================================== DCF */

export function checkDcf(a, opts = {}) {
  const skipped = opts.skipped || {};
  const T = ctx(`dcf${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { X } = open(a, 'dcf', opts, T);
  const dcf = computeDcf(a);
  const sens = dcfSensitivity(a);
  const n = dcf.ops.n;
  const hist = skipped.history ? null : dcfReportedHistory(a);
  const H = hist ? hist.n : 0;
  const cLtm = H ? 4 + H : 3;
  const proj = (i) => colLetter(cLtm + 1 + i);
  const S = 'DCF';
  const perYear = (label, arr, msg, scale = 1, which = 'first') => {
    const r = need(T, which === 'last' ? X.rowLast(S, label, 'B') : X.row(S, label, 'B'), label);
    for (let i = 0; i < n; i++) T.same(sc(X.get(S, `${proj(i)}${r}`), scale), arr[i], `${msg} Y${i + 1}`);
  };
  perYear('Sales', dcf.ops.revenue, 'sales');
  perYear('EBITDA', dcf.ops.ebitda, 'EBITDA');
  perYear('EBIT', dcf.ops.ebit, 'EBIT');
  perYear('Tax losses carried forward', dcf.nolCloseU, 'unlevered NOL');
  perYear('Less: Taxes (after tax losses)', dcf.fcffTax, 'FCFF tax');
  perYear('Unlevered Free Cash Flow', dcf.fcff, 'FCFF');
  perYear('Present Value of Free Cash Flow', dcf.pv, 'PV FCFF');
  T.same(X.get(S, `${colLetter(cLtm)}${X.row(S, 'EBITDA', 'B')}`), dcf.ops.ebitda0, 'LTM EBITDA = explicit input');

  if (H) {
    const salesRow = X.row(S, 'Sales', 'B'), ebitdaRow = X.row(S, 'EBITDA', 'B');
    for (let i = 0; i < H; i++) {
      T.same(X.get(S, `${colLetter(3 + i)}${salesRow}`), hist.revenue[i], `reported sales ${hist.labels[i]}`);
      T.same(X.get(S, `${colLetter(3 + i)}${ebitdaRow}`), hist.ebitda[i], `reported EBITDA ${hist.labels[i]}`);
    }
  }

  const evRow = need(T, X.rowLast(S, 'Enterprise Value', 'B'), 'EV');
  T.same(X.get(S, `D${evRow}`), dcf.gordon.ev, 'EV (perpetuity growth)');
  T.same(X.get(S, `E${evRow}`), dcf.exit.ev, 'EV (exit multiple)');
  const pxRow = need(T, X.row(S, 'Implied Share Price', 'G'), 'price');
  T.same(X.get(S, `I${pxRow}`), dcf.gordon.price, 'FCFF Gordon price');
  T.same(X.get(S, `J${pxRow}`), dcf.exit.price, 'FCFF exit price');
  const nolRow = need(T, X.row(S, 'PV of Unused Tax Losses at Year N (NOL × t)', 'B'), 'PV NOL');
  T.same(X.get(S, `D${nolRow}`), dcf.pvNolFcff, 'PV of unused NOL (FCFF)');
  T.same(X.get(S, `D${X.row(S, 'Normalised Terminal-Year FCF (fully taxed)', 'B')}`), dcf.fcffNormN, 'normalised terminal FCFF');
  T.same(sc(X.get(S, `E${X.row(S, 'Exit-multiple TV → implied perpetuity growth', 'B')}`), 100), dcf.impliedPerpGrowth, 'implied perpetuity growth');
  T.same(X.get(S, `E${X.row(S, 'Perpetuity growth TV → implied exit EV/EBITDA', 'B')}`), dcf.impliedExitMultiple, 'implied exit multiple');

  const grid = (title, col0, engGrid, what) => {
    const b = need(T, X.row(S, title, col0 === 'C' ? 'B' : 'I'), title);
    const c0 = col0.charCodeAt(0) - 64;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) T.same(X.get(S, `${colLetter(c0 + j)}${b + 2 + i}`), engGrid[i][j], `${what} grid [${i}][${j}]`);
  };
  grid('SENSITIVITY — IMPLIED SHARE PRICE: WACC × PERPETUITY GROWTH', 'C', sens.gordonGrid, 'Gordon');
  grid('SENSITIVITY — IMPLIED SHARE PRICE: WACC × EXIT EV/EBITDA', 'J', sens.exitGrid, 'exit');

  if (!skipped.fcfe) {
    perYear('Free Cash Flow to Equity', dcf.fcfe, 'FCFE');
    perYear('Net income (3-statement basis)', dcf.niDcf, 'NI (3-statement basis)');
    const fr = need(T, X.row(S, 'Implied Share Price', 'B'), 'FCFE price');
    T.same(X.get(S, `D${fr}`), dcf.fcfeGordon.price, 'FCFE Gordon price');
    T.same(X.get(S, `E${fr}`), dcf.fcfeExit.price, 'FCFE exit-P/E price');
    T.same(X.get(S, `D${X.row(S, 'Plus: Opening Cash', 'B')}`), dcf.fcfeCash, 'FCFE opening cash');
    grid('SENSITIVITY — FCFE SHARE PRICE: COST OF EQUITY × PERPETUITY GROWTH', 'C', sens.fcfeGrid, 'FCFE');
  } else {
    T.truthy(X.row(S, 'Free Cash Flow to Equity', 'B') < 0, 'no FCFE block when FCFE is skipped');
  }

  // WACC
  const k = computeWacc(a);
  T.same(sc(X.get('Inputs', `B${X.row('Inputs', 'WACC')}`), 100), k.wacc, 'Inputs WACC');
  T.same(sc(X.get('WACC', `D${X.row('WACC', 'WACC', 'B')}`), 100), k.wacc, 'WACC page');
  T.same(sc(X.get('WACC', `D${X.row('WACC', 'Cost of Equity (CAPM)', 'B')}`), 100), k.costEquity, 'WACC page CoE');
  const ws = waccSensitivity(a);
  const sb = need(T, X.row('WACC', 'WACC Sensitivity — Capital Structure × Pre-tax Cost of Debt', 'F'), 'WACC surface');
  for (let i = 0; i < 5; i++) {
    T.same(sc(X.get('WACC', `F${sb + 2 + i}`), 100), ws.wdSteps[i], `WACC surface row ${i}`);
    for (let j = 0; j < 5; j++) T.same(sc(X.get('WACC', `${colLetter(7 + j)}${sb + 2 + i}`), 100), ws.grid[i][j], `WACC surface [${i}][${j}]`);
  }
  const bp = betaPeerStats(a);
  if (bp.rows.length) {
    bp.rows.forEach((p, i) => T.same(X.get('WACC', `J${9 + i}`), p.unleveredBeta, `peer unlevered beta ${p.name}`));
    T.same(X.get('WACC', `J${X.row('WACC', 'Mean', 'F')}`), bp.mean, 'peer unlevered beta mean');
    T.same(X.get('WACC', `J${X.row('WACC', 'Median', 'F')}`), bp.median, 'peer unlevered beta median');
    T.same(X.get('WACC', `J${X.row('WACC', 'Peer mean', 'F')}`), bp.releveredMean, 'relevered mean');
    T.same(X.get('WACC', `J${X.row('WACC', 'Peer median', 'F')}`), bp.releveredMedian, 'relevered median');
  }
  return T;
}

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

/* ================================================================ Comps */

/** Every checked field of a company page against computeCompany. */
function checkCompanyPage(X, T, sheet, page, L, tag) {
  const g = (addr) => X.get(sheet, addr);
  const s = (addr, eng, what) => T.same(g(addr), eng, `${tag} ${what}`);
  s(`T${L.fullyDiluted}`, page.shares.fullyDiluted, 'diluted shares');
  s(`E${L.equityValue}`, page.equityValue, 'equity value');
  s(`E${L.ev}`, page.enterpriseValue, 'EV');
  const cols = ['I', 'J', 'K', 'L', 'M', 'N'];
  const series = [
    ['sales', page.is.sales], ['cogs', page.is.cogs], ['grossProfit', page.grossProfit],
    ['sga', page.is.sga], ['otherExp', page.is.otherExp], ['ebit', page.ebit],
    ['interest', page.is.interest], ['pretax', page.pretax], ['taxes', page.is.taxes],
    ['netIncome', page.netIncome], ['effTax', page.effTaxRate], ['dilEps', page.eps],
    ['wtdShares', page.is.dilutedShares],
    ['adjGross', page.adjGrossProfit], ['adjGrossM', page.grossMargin],
    ['adjEbit', page.adjEbit], ['adjEbitM', page.ebitMargin],
    ['ebitdaB', page.ebitda], ['adjEbitda', page.adjEbitda], ['adjEbitdaM', page.ebitdaMargin],
    ['taxAdj', page.taxAdjustment], ['adjNi', page.adjNetIncome], ['adjNiM', page.netMargin],
    ['adjEps', page.adjEps],
    ['cfo', page.cf.cfo], ['capex', page.cf.capex], ['fcf', page.fcf],
    ['fcfMargin', page.fcfMargin], ['fcfPerShare', page.fcfPerShare], ['da', page.cf.da],
    ['capexPct', page.capexPctSales], ['daPct', page.daPctSales],
  ];
  for (const [key, vals] of series) cols.forEach((c, i) => s(`${c}${L[key]}`, vals[i], `${key}[${i}]`));
  const bs = page.bs;
  for (const [key, vals] of [
    ['bsTca', bs.totalCurrentAssets], ['bsTotalAssets', bs.totalAssets], ['bsTcl', bs.totalCurrentLiab],
    ['bsTotalLiab', bs.totalLiabilities], ['bsTotalLe', bs.totalLiabEquity],
  ]) ['S', 'T'].forEach((c, i) => s(`${c}${L[key]}`, vals[i], `${key}[${i}]`));
  s(`T${L.plusOptions}`, page.shares.itmShares, 'ITM option shares');
  s(`T${L.lessRepurch}`, page.shares.repurchased, 'shares repurchased');
  s(`T${L.netNewOptions}`, page.shares.netNew, 'net new option shares');
  s(`T${L.plusConverts}`, page.shares.convShares, 'convertible shares');
  s(`C${L.evSales}`, page.multiples.evSales.metric[0], 'EV/Sales metric');
  s(`C${L.evEbitda}`, page.multiples.evEbitda.metric[0], 'EV/EBITDA metric');
  s(`C${L.pe}`, page.multiples.pe.metric[0], 'P/E metric');
  s(`E${L.debtEbitda}`, page.credit.debtToEbitda, 'debt/EBITDA');
  s(`E${L.ebitInt}`, page.credit.ebitToInterest, 'EBIT/interest');
  s(`C${L.hist2}`, page.growth.ebitda.hist2, 'EBITDA CAGR 2y');
  s(`E${L.hist2}`, page.growth.eps.hist2, 'EPS CAGR 2y');
  s(`B${L.evSales}`, page.multiples.evSales.values[0], 'EV/Sales');
  s(`B${L.evEbitda}`, page.multiples.evEbitda.values[0], 'EV/EBITDA');
  s(`B${L.evEbit}`, page.multiples.evEbit.values[0], 'EV/EBIT');
  s(`B${L.pe}`, page.multiples.pe.values[0], 'P/E');
  s(`B${L.pFcf}`, page.multiples.pFcf.values[0], 'P/FCF');
  s(`B${L.fcfYield}`, page.multiples.fcfYield.values[0], 'FCF yield');
  s(`E${L.roic}`, page.roic, 'ROIC');
  s(`E${L.roe}`, page.roe, 'ROE');
  s(`E${L.roa}`, page.roa, 'ROA');
  s(`E${L.divYield}`, page.dividendYield, 'dividend yield');
  s(`E${L.pctHigh}`, page.pctOf52wHigh, '% of 52w high');
  s(`E${L.debtCap}`, page.credit.debtToTotalCap, 'debt/cap');
  s(`E${L.netDebtEbitda}`, page.credit.netDebtToEbitda, 'net debt/EBITDA');
  s(`E${L.ebitdaInt}`, page.credit.ebitdaToInterest, 'EBITDA/interest');
  s(`E${L.ebitdaCapexInt}`, page.credit.ebitdaLessCapexToInterest, '(EBITDA−capex)/interest');
  s(`B${L.hist1}`, page.growth.sales.hist1, 'sales growth 1y');
  s(`B${L.hist2}`, page.growth.sales.hist2, 'sales CAGR 2y');
  s(`C${L.hist1}`, page.growth.ebitda.hist1, 'EBITDA growth 1y');
  s(`D${L.hist1}`, page.growth.fcf.hist1, 'FCF/sh growth 1y');
  s(`E${L.hist1}`, page.growth.eps.hist1, 'EPS growth 1y');
  s(`T${L.bsCheck}`, page.bs.check[1], 'balance check');
}

/** Find a stat column by its header label on an analysis page (row 8). */
function statColumn(X, sheet, label) {
  const id = X.hf.getSheetId(sheet);
  const { width } = X.hf.getSheetDimensions(id);
  for (let c = 0; c < width; c++) if (X.hf.getCellValue({ sheet: id, col: c, row: 7 }) === label) return colLetter(c + 1);
  return null;
}

export function checkComps(a, opts = {}) {
  const T = ctx(`comps${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { wb, X } = open(a, 'comps', opts, T);
  const comps = computeComps(a);
  const peers = a.comps?.peers || [];
  const all = [targetCompanyPage(a), ...peers];
  const L = companyLayout(Math.max(5, ...all.map((c) => (c.options || []).length)), Math.max(5, ...all.map((c) => (c.converts || []).length)));
  const names = wb.worksheets.map((w) => w.name);
  const listAt = names.indexOf('List');
  const targetSheet = names[listAt + 1];
  checkCompanyPage(X, T, targetSheet, comps.targetPage, L, 'target');
  peers.forEach((p, i) => checkCompanyPage(X, T, names[listAt + 2 + i], comps.pages[i], L, p.name));

  // analysis pages — the Overall block of every statistic column
  const pages = [['Benchmarking 1', BENCH1_GROUPS, 'bench1'], ['Benchmarking 2', BENCH2_GROUPS, 'bench2'], ['Comps Analysis', OUTPUT_GROUPS, 'output']];
  for (const [sheet, groups, key] of pages) {
    const overall = X.row(sheet, 'Overall', 'B');
    if (!peers.length) { T.truthy(overall < 0, `${sheet}: no Overall block without peers`); continue; }
    const at = (label) => X.rows(sheet, label, 'B').find((r) => r > overall);
    for (const c of groups.flatMap((gp) => gp.cols).filter((c) => c.stat)) {
      const col = statColumn(X, sheet, c.label);
      T.truthy(!!col, `${sheet}: column "${c.label}"`);
      if (!col) continue;
      const st = comps.overall[key][c.key];
      T.same(X.get(sheet, `${col}${at('Mean')}`), st.mean, `${sheet} ${c.label} mean`);
      T.same(X.get(sheet, `${col}${at('Median')}`), st.median, `${sheet} ${c.label} median`);
      T.same(X.get(sheet, `${col}${at('High')}`), st.high, `${sheet} ${c.label} high`);
      T.same(X.get(sheet, `${col}${at('Low')}`), st.low, `${sheet} ${c.label} low`);
    }
  }

  // implied valuation — every row side by side
  if (peers.length) {
    for (const row of comps.rows) {
      const r = need(T, X.row('Implied Valuation', row.label, 'B'), row.label);
      T.same(X.get('Implied Valuation', `C${r}`), row.impliedLow, `${row.label} 25th`);
      T.same(X.get('Implied Valuation', `D${r}`), row.impliedMedian, `${row.label} median`);
      T.same(X.get('Implied Valuation', `E${r}`), row.impliedHigh, `${row.label} 75th`);
    }
  }

  // regression
  if (!opts.skipped?.regression && a.regression?.yVar) {
    const reg = runRegression(a);
    T.truthy(X.sheets.includes('Regression'), 'Regression sheet present');
    if (reg.fit?.ok) {
      T.same(X.get('Regression', `B${X.row('Regression', 'Intercept')}`), reg.fit.beta[0], 'regression intercept');
      T.same(X.get('Regression', `B${X.row('Regression', 'R²')}`), reg.fit.r2, 'regression R²');
      if (reg.price) {
        T.same(X.get('Regression', `B${X.row('Regression', 'Implied share price')}`), reg.price.mid, 'regression price');
        const lo = X.rows('Regression', '−1 SE'), hi = X.rows('Regression', '+1 SE');
        T.same(X.get('Regression', `B${lo[lo.length - 1]}`), reg.price.lo, 'regression price −1 SE');
        T.same(X.get('Regression', `B${hi[hi.length - 1]}`), reg.price.hi, 'regression price +1 SE');
      }
    }
  } else {
    T.truthy(!X.sheets.includes('Regression'), 'no Regression sheet when skipped');
  }
  return T;
}

/* ============================================================ Precedent */

export function checkPrecedent(a, opts = {}) {
  const T = ctx(`precedent${opts.tag ? ` [${opts.tag}]` : ''}`);
  const { wb, X } = open(a, 'precedent', opts, T);
  const prec = computePrecedent(a);
  const DL = dealLayout();
  const L = companyLayout(Math.max(5, ...prec.deals.map((d) => (d.deal.target.options || []).length)), Math.max(5, ...prec.deals.map((d) => (d.deal.target.converts || []).length)));
  const names = wb.worksheets.map((w) => w.name);
  const first = names.indexOf('Deal List') + 1;
  prec.deals.forEach((d, i) => {
    const sheet = names[first + i];
    const tag = sheet;
    T.same(X.get(sheet, `E${DL.offer}`), d.offerPrice, `${tag} offer price`);
    T.same(X.get(sheet, `E${DL.stockOffer}`), d.stockOffer, `${tag} stock leg`);
    T.same(X.get(sheet, `E${DL.equityValue}`), d.equityValue, `${tag} equity value`);
    T.same(X.get(sheet, `E${DL.ev}`), d.enterpriseValue, `${tag} EV`);
    T.same(X.get(sheet, `E${DL.evSales}`), d.evSales, `${tag} EV/Sales`);
    T.same(X.get(sheet, `E${DL.evEbitda}`), d.evEbitda, `${tag} EV/EBITDA`);
    T.same(X.get(sheet, `E${DL.evEbit}`), d.evEbit, `${tag} EV/EBIT`);
    T.same(X.get(sheet, `E${DL.pe}`), d.pe, `${tag} P/E`);
    T.same(X.get(sheet, `N${L.adjEbitdaM}`), d.ebitdaMargin, `${tag} EBITDA margin`);
    PREMIUM_DAYS.forEach((w, k) => T.same(X.get(sheet, `E${DL.premFirst + k}`), d.premiums[w], `${tag} premium ${w}d`));
  });
  const S = 'Precedent';
  const rowsByKey = { evSales: 'EV / LTM Sales × target LTM revenue', evEbitda: 'EV / LTM EBITDA × target LTM EBITDA' };
  for (const row of prec.rows) {
    const r = need(T, X.row(S, rowsByKey[row.key], 'B'), row.key);
    T.same(X.get(S, `C${r}`), row.impliedLow, `${row.key} 25th`);
    T.same(X.get(S, `D${r}`), row.impliedMedian, `${row.key} median`);
    T.same(X.get(S, `E${r}`), row.impliedHigh, `${row.key} 75th`);
  }
  const pr = need(T, X.row(S, 'Premiums paid (1-day) on the current share price', 'B'), 'premia');
  T.same(X.get(S, `C${pr}`), prec.premia.impliedLow, 'premia 25th');
  T.same(X.get(S, `D${pr}`), prec.premia.impliedMedian, 'premia median');
  T.same(X.get(S, `E${pr}`), prec.premia.impliedHigh, 'premia 75th');
  return T;
}

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

export { P };
