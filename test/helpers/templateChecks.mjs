/**
 * Recalculate a Comparable Company / Precedent Transactions workbook with
 * HyperFormula and compare EVERY computed cell with the engine: each company
 * sheet (income statement, balance sheet, cash flow, ratios, market data /
 * deal terms), both summary tables, every statistics row (overall and per
 * tier), the implied valuation and its summary, and the regression price.
 */
import { buildWorkbook } from '../../src/lib/excel/exportExcel.js';
import { pageCols } from '../../src/lib/excel/templateXlsx.js';
import { IS_LINES, BS_LINES, CF_LINES, RATIO_LINES } from '../../src/lib/engine/companyPage.js';
import { computeComps, COMPS_MULTIPLES, COMPS_BENCH } from '../../src/lib/engine/comps.js';
import { computePrecedent, DEAL_MULTIPLES, DEAL_BENCH } from '../../src/lib/engine/precedent.js';
import { runRegression } from '../../src/lib/engine/regressionModel.js';
import { STAT_LABELS } from '../../src/lib/engine/templateStats.js';
import { recalc } from './recalc.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));

/** Does a recalculated cell show what the engine computed? */
export function same(eng, cell) {
  // A formula that only references an empty cell: Excel shows 0, HyperFormula returns empty.
  if (eng === 0 && cell === null) return true;
  if (isNum(eng)) return isNum(cell) && near(cell, eng);
  if (eng === 'NM' || eng === 'n.a.') return cell === eng;
  if (eng === '' || eng === null || eng === undefined) return cell === '' || cell === null || cell === 0;
  return cell === eng;
}

function ctx(tag) {
  const st = { checks: 0, failures: 0, fails: [] };
  const ok = (cond, msg) => {
    st.checks++;
    if (!cond) { st.failures++; if (st.fails.length < 25) st.fails.push(`${tag}: ${msg}`); }
  };
  return { ok, st };
}

/** Every line of one company sheet vs the engine page. */
function checkPage(X, T, sheet, pg, ytd) {
  const K = pageCols(pg.n, ytd);
  const cols = [...K.fy.map((c, i) => [c, i]), ...(ytd ? [[K.P, pg.cols.P], [K.C, pg.cols.C]] : []), [K.L, pg.cols.L]];
  for (const line of [...IS_LINES, ...BS_LINES, ...CF_LINES, ...RATIO_LINES]) {
    if (line.head) continue;
    for (const [col, i] of cols) {
      const eng = pg.v[line.key][i];
      const cell = X.get(sheet, `${col}${line.row}`);
      T.ok(same(eng, cell), `${sheet}!${col}${line.row} ${line.label}: engine ${JSON.stringify(eng)} vs sheet ${JSON.stringify(cell)}`);
    }
  }
  const m = pg.market;
  const V = K.valCol;
  const mk = [[8, m.borrowings], [9, m.leases], [10, m.cashLike], [11, m.netDebt], [12, m.nci], [13, m.ev], [14, m.bookEquity]];
  if ('bvps' in m) {
    mk.push([7, m.equity]);
    if (String(X.get(sheet, `${K.labelCol}15`) || '').startsWith('Book Value per Share')) mk.push([15, m.bvps]);
  } else mk.push([5, m.equity]);
  for (const [r, v] of mk) T.ok(same(v, X.get(sheet, `${V}${r}`)), `${sheet}!${V}${r} market: engine ${v} vs sheet ${X.get(sheet, `${V}${r}`)}`);
}

/** Header rows of the two summary tables (the rows whose column A reads `first`). */
const headerRows = (X, sheet, first) => X.rows(sheet, first);

function checkStats(X, T, sheet, startRow, show, cols, stats, label) {
  show.forEach((k, i) => {
    const r = startRow + i;
    T.ok(X.get(sheet, `A${r}`) === STAT_LABELS[k], `${sheet}!A${r} is "${STAT_LABELS[k]}" (${label})`);
    for (const c of cols) {
      const eng = stats[c.key][k];
      const cell = X.get(sheet, `${c.col}${r}`);
      T.ok(same(eng, cell), `${sheet}!${c.col}${r} ${label} ${k} ${c.key}: engine ${JSON.stringify(eng)} vs sheet ${JSON.stringify(cell)}`);
    }
  });
}

function checkImplied(X, T, rows, summary) {
  const S = 'Implied Valuation';
  rows.forEach((r, i) => {
    const rr = 13 + i;
    const cells = [['B', r.metric], ['C', r.mults.low], ['D', r.mults.mid], ['E', r.mults.high],
      ['F', r.equity.low], ['G', r.equity.mid], ['H', r.equity.high], ['I', r.price.low], ['J', r.price.mid], ['K', r.price.high]];
    for (const [col, v] of cells) {
      const cell = X.get(S, `${col}${rr}`);
      T.ok(same(v, cell), `${S}!${col}${rr} ${r.key}: engine ${JSON.stringify(v)} vs sheet ${JSON.stringify(cell)}`);
    }
  });
  const at = (label) => X.row(S, label);
  const find = (re) => {
    for (let r = 13; r < 60; r++) { const v = X.get(S, `A${r}`); if (typeof v === 'string' && re.test(v)) return r; }
    return -1;
  };
  const pairs = [[find(/^Lowest implied price/), summary.lowest], [find(/^Median of/), summary.medianMid], [find(/^Highest implied price/), summary.highest], [find(/^(Upside|Premium)/), summary.upside]];
  for (const [r, v] of pairs) T.ok(r > 0 && same(v, X.get(S, `B${r}`)), `${S} summary row ${r}: engine ${JSON.stringify(v)} vs sheet ${JSON.stringify(X.get(S, `B${r}`))}`);
  void at;
}

/** The comps workbook against computeComps (and the regression when on). */
export function checkCompsWorkbook(a, opts = {}) {
  const T = ctx(`comps${opts.tag ? ` [${opts.tag}]` : ''}`);
  const wb = buildWorkbook(a, 'comps', opts);
  const X = recalc(wb);
  const c = computeComps(a);
  const errs = X.errors();
  T.ok(errs.length === 0, `no error cells (${errs.slice(0, 3).map((e) => `${e.sheet}!${e.addr} ${e.err} ${e.formula}`).join(' | ')})`);

  checkPage(X, T, 'Target', c.target.page, c.ytd);
  c.peers.forEach((p, k) => checkPage(X, T, `Peer ${k + 1}`, p.page, c.ytd));

  const S = 'Comps Summary';
  const [h1, h2] = headerRows(X, S, 'Company');
  T.ok(h1 > 0 && h2 > h1, 'two summary tables');
  const t1 = [
    { col: 'D', get: (r) => r.price ?? null }, { col: 'E', get: (r) => r.mcap }, { col: 'F', get: (r) => r.netDebt }, { col: 'G', get: (r) => r.ev },
    { col: 'H', get: (r) => r.revLtm }, { col: 'I', get: (r) => r.ebitdaLtm }, { col: 'J', get: (r) => r.patLtm },
    ...COMPS_MULTIPLES.map((m) => ({ col: m.col, key: m.key, get: (r) => r.mult[m.key] })),
  ];
  const t2 = COMPS_BENCH.map((b) => ({ col: b.col, key: b.key, get: (r) => r.bench[b.key] }));
  const rowsAll = [c.target, ...c.peers];
  rowsAll.forEach((r, i) => {
    for (const col of t1) T.ok(same(col.get(r), X.get(S, `${col.col}${h1 + 1 + i}`)), `${S}!${col.col}${h1 + 1 + i} T1 ${r.role}: engine ${JSON.stringify(col.get(r))} vs sheet ${JSON.stringify(X.get(S, `${col.col}${h1 + 1 + i}`))}`);
    for (const col of t2) T.ok(same(col.get(r), X.get(S, `${col.col}${h2 + 1 + i}`)), `${S}!${col.col}${h2 + 1 + i} T2 ${r.role}: engine ${JSON.stringify(col.get(r))} vs sheet ${JSON.stringify(X.get(S, `${col.col}${h2 + 1 + i}`))}`);
  });
  if (c.peers.length) {
    const s1 = h1 + 1 + rowsAll.length + 1;
    checkStats(X, T, S, s1, c.statSel.show, COMPS_MULTIPLES, c.stats1, 'T1 overall');
    const s2 = h2 + 1 + rowsAll.length + 1;
    checkStats(X, T, S, s2, c.statSel.show, COMPS_BENCH, c.stats2, 'T2 overall');
    // tier blocks: a "Tier" marker row, then the stats rows
    const tierRows = X.rows(S, 'Tier').filter((r) => r > h1 + 1);
    const t1Tier = tierRows.filter((r) => r < h2), t2Tier = tierRows.filter((r) => r > h2);
    T.ok(t1Tier.length === c.tiers.length && t2Tier.length === c.tiers.length, `one tier block per tier (${c.tiers.length})`);
    c.tiers.forEach((tg, i) => {
      T.ok(X.get(S, `B${t1Tier[i]}`) === tg.name, `tier block ${i + 1} is ${tg.name}`);
      checkStats(X, T, S, t1Tier[i] + 1, c.statSel.show, COMPS_MULTIPLES, tg.stats1, `T1 ${tg.name}`);
      checkStats(X, T, S, t2Tier[i] + 1, c.statSel.show, COMPS_BENCH, tg.stats2, `T2 ${tg.name}`);
    });
  }
  checkImplied(X, T, c.implied, c.summary);

  if (!opts.skipped?.regression && a.regression?.yVar) {
    const R = runRegression(a);
    const names = wb.worksheets.map((w) => w.name);
    T.ok(names.includes('Regression'), 'Regression sheet present');
    if (R.price && names.includes('Regression')) {
      const r = X.row('Regression', 'Implied share price');
      T.ok(r > 0 && near(X.get('Regression', `B${r}`), R.price.mid), `regression price: engine ${R.price.mid} vs sheet ${X.get('Regression', `B${r}`)}`);
      T.ok(near(X.get('Regression', `B${r + 1}`), R.price.lo) && near(X.get('Regression', `B${r + 2}`), R.price.hi), 'regression ±1 SE prices');
    }
  }
  return { ...T.st, wb, X, c };
}

/** The precedent workbook against computePrecedent. */
export function checkPrecedentWorkbook(a, opts = {}) {
  const T = ctx(`precedent${opts.tag ? ` [${opts.tag}]` : ''}`);
  const wb = buildWorkbook(a, 'precedent', opts);
  const X = recalc(wb);
  const p = computePrecedent(a);
  const errs = X.errors();
  T.ok(errs.length === 0, `no error cells (${errs.slice(0, 3).map((e) => `${e.sheet}!${e.addr} ${e.err} ${e.formula}`).join(' | ')})`);

  checkPage(X, T, 'Company Being Valued', p.company.page, p.ytd);
  p.deals.forEach((d, k) => checkPage(X, T, `Deal ${k + 1}`, d.page, p.ytd));
  // inputs sheet: implied 100% equity and control premium
  p.deals.forEach((d, k) => {
    T.ok(same(d.equity, X.get('Inputs', `H${17 + k}`)), `Inputs!H${17 + k} implied 100% equity`);
    T.ok(same(d.premium, X.get('Inputs', `N${17 + k}`)), `Inputs!N${17 + k} control premium: engine ${JSON.stringify(d.premium)} vs ${JSON.stringify(X.get('Inputs', `N${17 + k}`))}`);
  });

  const S = 'Transaction Summary';
  const [h1, h2] = headerRows(X, S, 'Deal');
  T.ok(h1 > 0 && h2 > h1, 'two summary tables');
  const t1 = [
    { col: 'H', key: 'equity', get: (d) => d.equity }, { col: 'I', get: (d) => d.netDebt }, { col: 'J', key: 'ev', get: (d) => d.ev },
    { col: 'K', get: (d) => d.revLtm }, { col: 'L', get: (d) => d.ebitdaLtm }, { col: 'M', get: (d) => d.patLtm },
    ...DEAL_MULTIPLES.map((m) => ({ col: m.col, key: m.key, get: (d) => d.mult[m.key] })),
    { col: 'S', key: 'premium', get: (d) => d.premium },
  ];
  const t2 = DEAL_BENCH.map((b) => ({ col: b.col, key: b.key, get: (d) => d.bench[b.key] }));
  p.deals.forEach((d, i) => {
    for (const col of t1) T.ok(same(col.get(d), X.get(S, `${col.col}${h1 + 1 + i}`)), `${S}!${col.col}${h1 + 1 + i} T1 ${d.role}: engine ${JSON.stringify(col.get(d))} vs sheet ${JSON.stringify(X.get(S, `${col.col}${h1 + 1 + i}`))}`);
    for (const col of t2) T.ok(same(col.get(d), X.get(S, `${col.col}${h2 + 1 + i}`)), `${S}!${col.col}${h2 + 1 + i} T2 ${d.role}: engine ${JSON.stringify(col.get(d))} vs sheet ${JSON.stringify(X.get(S, `${col.col}${h2 + 1 + i}`))}`);
  });
  if (p.deals.length) {
    checkStats(X, T, S, h1 + 1 + p.deals.length + 1, p.statSel.show, t1.filter((x) => x.key), p.stats1, 'T1');
    checkStats(X, T, S, h2 + 1 + p.deals.length + 1, p.statSel.show, t2, p.stats2, 'T2');
  }
  checkImplied(X, T, p.implied, p.summary);
  return { ...T.st, wb, X, p };
}
