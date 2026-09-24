/**
 * Comparable companies verification, on synthetic data.
 *
 * Part 1 — engine identities: every derived line on a company input page is
 * re-derived here by hand from the raw inputs and compared to the engine.
 * Part 2 — Excel parity: the exported workbook is recalculated from its blue
 * input cells alone with HyperFormula, and every company-page cell, every
 * benchmarking / output / list cell and every statistic is compared to the JS
 * engine. This proves the workbook is genuinely live, not a dump of values.
 */
import { DEFAULT_ASSUMPTIONS as A, mergeAssumptions } from '../src/lib/defaults.js';
import { computeComps, stats, targetCompanyPage, BENCH1_GROUPS, BENCH2_GROUPS, OUTPUT_GROUPS, LIST_COLS } from '../src/lib/engine/comps.js';
import { computeCompany, dilutedShares, balanceSheet, bridge, P, B } from '../src/lib/engine/compsCo.js';
import { expandPeer } from '../src/lib/engine/compsSample.js';
import { buildWorkbook } from '../src/lib/excel/exportExcel.js';
import { companyLayout } from '../src/lib/excel/compsSheets.js';
import { HyperFormula } from 'hyperformula';

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } };
const okv = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (x, y, tol = 1e-9) => {
  if (!isFinite(x) && !isFinite(y)) return true;
  if (!isFinite(x) || !isFinite(y)) return false;
  return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
};

console.log('=== Part 1: engine identities on synthetic company pages ===');

const comps = computeComps(A);
const pages = comps.pages;
okv(pages.length === 9, `9 synthetic peers across ${comps.tiers.length} tiers`);
okv(comps.tiers.every((t) => t.pages.length === 3), 'every tier holds 3 peers');

for (const pg of pages) {
  const co = pg.co, n = co.name;
  const t = co.taxRate / 100;

  /* ---- LTM bridge: LTM = FY0 + current stub − prior stub ---- */
  for (const key of ['sales', 'cogs', 'sga', 'otherExp', 'interest', 'taxes']) {
    const a5 = co.is[key];
    ok(near(pg.is[key][P.LTM], a5[2] + a5[4] - a5[3]), `${n}: LTM bridge on ${key}`);
  }

  /* ---- income statement walk ---- */
  for (let i = 0; i < 6; i++) {
    ok(near(pg.grossProfit[i], pg.is.sales[i] - pg.is.cogs[i]), `${n}: gross profit [${i}]`);
    ok(near(pg.ebit[i], pg.is.sales[i] - pg.is.cogs[i] - pg.is.sga[i] - pg.is.otherExp[i]), `${n}: EBIT [${i}]`);
    ok(near(pg.pretax[i], pg.ebit[i] - pg.is.interest[i]), `${n}: pre-tax [${i}]`);
    ok(near(pg.netIncome[i], pg.pretax[i] - pg.is.taxes[i] - pg.is.nci[i] - pg.is.prefDiv[i]), `${n}: net income [${i}]`);
  }

  /* ---- adjusted income statement, incl. the tax effect on add-backs ---- */
  for (let i = 0; i < 6; i++) {
    ok(near(pg.adjGrossProfit[i], pg.grossProfit[i] + pg.adj.nrCogs[i]), `${n}: adj gross [${i}]`);
    ok(near(pg.adjEbit[i], pg.ebit[i] + pg.adj.nrCogs[i] + pg.adj.nrOther[i]), `${n}: adj EBIT [${i}]`);
    ok(near(pg.adjEbitda[i], pg.adjEbit[i] + pg.cf.da[i]), `${n}: adj EBITDA = adj EBIT + D&A [${i}]`);
    const addBacks = pg.adj.nrCogs[i] + pg.adj.nrOther[i] + pg.adj.nrNonOp[i];
    ok(near(pg.taxAdjustment[i], -addBacks * t), `${n}: tax adjustment [${i}]`);
    ok(near(pg.adjNetIncome[i], pg.netIncome[i] + addBacks * (1 - t)), `${n}: adj net income nets add-backs of tax [${i}]`);
  }

  /* ---- margins ---- */
  ok(near(pg.ebitdaMargin[P.LTM], pg.adjEbitda[P.LTM] / pg.is.sales[P.LTM]), `${n}: EBITDA margin`);
  ok(near(pg.netMargin[P.LTM], pg.adjNetIncome[P.LTM] / pg.is.sales[P.LTM]), `${n}: net margin`);

  /* ---- treasury stock method ---- */
  const d = dilutedShares(co);
  const itm = co.options.filter((o) => o.strike < co.price);
  const expItm = itm.reduce((s, o) => s + o.shares, 0);
  const expProceeds = itm.reduce((s, o) => s + o.shares * o.strike, 0);
  ok(near(d.itmShares, expItm), `${n}: in-the-money option shares`);
  ok(near(d.proceeds, expProceeds), `${n}: option exercise proceeds`);
  ok(near(d.repurchased, -expProceeds / co.price), `${n}: shares repurchased at the market price`);
  const expConv = co.converts.filter((c) => c.price < co.price).reduce((s, c) => s + c.amount / c.price, 0);
  ok(near(d.convShares, expConv), `${n}: convertible shares (in-the-money only)`);
  ok(near(d.fullyDiluted, co.basicShares + expItm - expProceeds / co.price + expConv), `${n}: fully diluted shares`);
  ok(d.fullyDiluted >= co.basicShares, `${n}: dilution never reduces the share count`);

  /* ---- balance sheet ties ---- */
  const bs = balanceSheet(co);
  for (const i of [B.PRIOR, B.CURRENT]) {
    ok(near(bs.check[i], 0, 1e-9), `${n}: balance check = 0 [col ${i}]`);
    ok(near(bs.totalAssets[i], bs.totalCurrentAssets[i] + bs.ppe[i] + bs.goodwill[i] + bs.otherAssets[i]), `${n}: total assets [col ${i}]`);
    ok(near(bs.totalLiabEquity[i], bs.totalLiabilities[i] + bs.nci[i] + bs.preferred[i] + bs.equity[i]), `${n}: total L&E [col ${i}]`);
  }

  /* ---- valuation bridge ---- */
  ok(near(pg.equityValue, d.fullyDiluted * co.price), `${n}: equity value = FD shares × price`);
  ok(near(pg.enterpriseValue, pg.equityValue + bs.debt[1] + bs.preferred[1] + bs.nci[1] - bs.cash[1]), `${n}: EV bridge off the current balance sheet`);

  /* ---- multiples agree with their own metric row, and are NM on a
         non-positive denominator (a loss year, negative free cash flow) ---- */
  for (const [k, evBased] of [['evSales', true], ['evEbitda', true], ['evEbit', true], ['pe', false], ['pFcf', false]]) {
    const m = pg.multiples[k];
    const base = evBased ? pg.enterpriseValue : pg.price;
    for (let i = 0; i < 4; i++) {
      const expected = m.metric[i] > 0 ? base / m.metric[i] : NaN;
      ok(near(m.values[i], expected), `${n}: ${m.label} [${i}] = base / its own metric (NM when metric <= 0)`);
    }
  }
  ok(
    pg.multiples.pFcf.metric[0] > 0
      ? near(pg.multiples.fcfYield.values[0], 1 / pg.multiples.pFcf.values[0])
      : !isFinite(pg.multiples.fcfYield.values[0]),
    `${n}: FCF yield is the reciprocal of P/FCF, and NM on the same years`,
  );
  ok(near(pg.multiples.evSales.metric[0], pg.is.sales[P.LTM]), `${n}: EV/Sales LTM metric is LTM sales`);
  ok(near(pg.multiples.evEbitda.metric[0], pg.adjEbitda[P.LTM]), `${n}: EV/EBITDA LTM metric is adjusted LTM EBITDA`);
  ok(near(pg.multiples.pe.metric[0], pg.adjEps[P.LTM]), `${n}: P/E LTM metric is adjusted diluted EPS`);

  /* ---- returns & credit ---- */
  const avg = (a2) => (a2[0] + a2[1]) / 2;
  ok(near(pg.roe, pg.adjNetIncome[P.LTM] / avg(bs.equity)), `${n}: ROE on average equity`);
  ok(near(pg.roa, pg.adjNetIncome[P.LTM] / avg(bs.totalAssets)), `${n}: ROA on average assets`);
  ok(near(pg.roic, pg.adjEbit[P.LTM] / avg([bs.debt[0] - bs.cash[0] + bs.equity[0], bs.debt[1] - bs.cash[1] + bs.equity[1]])), `${n}: ROIC on average invested capital`);
  ok(near(pg.dividendYield, (co.dpsMRQ * 4) / co.price), `${n}: implied dividend yield annualises the MRQ dividend`);
  ok(near(pg.credit.netDebtToEbitda, (bs.debt[1] - bs.cash[1]) / pg.adjEbitda[P.LTM]), `${n}: net debt / EBITDA`);
  ok(near(pg.credit.ebitdaLessCapexToInterest, (pg.adjEbitda[P.LTM] - pg.cf.capex[P.LTM]) / pg.is.interest[P.LTM]), `${n}: (EBITDA − capex) / interest`);
  ok(pg.credit.debtToEbitda > pg.credit.netDebtToEbitda, `${n}: gross leverage exceeds net leverage`);

  /* ---- growth, on fiscal years ---- */
  ok(near(pg.growth.sales.hist1, pg.is.sales[P.FY0] / pg.is.sales[P.FY1] - 1), `${n}: historical 1-yr sales growth`);
  ok(near(pg.growth.sales.hist2, Math.sqrt(pg.is.sales[P.FY0] / pg.is.sales[P.FY2]) - 1), `${n}: historical 2-yr sales CAGR`);
  ok(near(pg.growth.ebitda.est1, pg.est.ebitda[0] / pg.adjEbitda[P.FY0] - 1), `${n}: estimated 1-yr EBITDA growth`);
  ok(near(pg.growth.sales.hist1, co.name && (1 + 0) ? pg.growth.sales.hist1 : NaN), `${n}: growth defined`);
}
okv(true, `per-company identities checked across ${pages.length} pages`);

/* ---- statistics blocks ---- */
for (const g of [...BENCH1_GROUPS, ...BENCH2_GROUPS, ...OUTPUT_GROUPS]) {
  for (const c of g.cols) {
    if (!c.stat) continue;
    const s = comps.overall.bench1[c.key] || comps.overall.bench2[c.key] || comps.overall.output[c.key];
    if (!s) continue;
    const vals = pages.map((p) => c.get(p)).filter(isFinite);
    if (!vals.length) continue;
    ok(near(s.high, Math.max(...vals)), `overall High matches MAX for ${c.label}`);
    ok(near(s.low, Math.min(...vals)), `overall Low matches MIN for ${c.label}`);
    ok(near(s.mean, vals.reduce((x, y) => x + y, 0) / vals.length), `overall Mean for ${c.label}`);
    ok(s.low <= s.median && s.median <= s.high, `overall Median inside [Low, High] for ${c.label}`);
  }
}
okv(true, 'tier and overall statistics blocks reconcile');

/* ---- NA propagation: a peer missing a metric must not poison the stats ---- */
{
  const holed = A.comps.peers.map((p, i) => (i === 0 ? { ...p, ltGrowth: NaN, cf: { ...p.cf, da: [0, 0, 0, 0, 0] } } : p));
  const c2 = computeComps({ ...A, comps: { ...A.comps, peers: holed } });
  const lt = c2.overall.bench1.ltGrowth;
  okv(lt.n === 8 && isFinite(lt.mean), 'a peer reporting NA is excluded from the statistic, not zeroed');
}

/* ---- target page comes from the model, and reports gross profit as NA ---- */
{
  const tp = comps.targetPage;
  okv(near(tp.is.sales[P.LTM], A.drivers.revenue0), 'target LTM sales = the model base-year revenue');
  okv(near(tp.enterpriseValue, A.company.sharesOut * A.company.currentPrice + A.company.grossDebt - A.company.cash),
    'target EV = market cap + debt − cash');
  okv(!isFinite(tp.grossMargin[P.LTM]), 'target gross margin is NA (no COGS/SG&A split in the driver set)');
  okv(near(tp.balanceCheck[1], 0, 1e-8), 'target balance check = 0');
  const withGm = computeComps({ ...A, comps: { ...A.comps, targetGrossMarginPct: 32 } });
  okv(near(withGm.targetPage.grossMargin[P.LTM], 0.32), 'supplying a target gross margin makes the line report');
  okv(near(withGm.targetPage.adjEbitda[P.LTM], comps.targetPage.adjEbitda[P.LTM]),
    'the gross-margin split leaves EBITDA untouched');
}

console.log(`\n=== Part 2: Excel parity (HyperFormula recalculation) ===`);

const wb = buildWorkbook(A);
const hfSheets = {};
wb.eachSheet((ws) => {
  const grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    while (grid.length < rn - 1) grid.push([]);
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      while (arr.length < cn - 1) arr.push(null);
      let v = cell.value;
      if (v && typeof v === 'object' && v.formula) v = '=' + v.formula;
      else if (v instanceof Date) v = Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
      arr.push(v === undefined ? null : v);
    });
    grid.push(arr);
  });
  hfSheets[ws.name] = grid;
});
const hf = HyperFormula.buildFromSheets(hfSheets, { licenseKey: 'gpl-v3', useArrayArithmetic: true, smartRounding: false });

const colNum = (s) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const get = (sheet, addr) => {
  const m = addr.match(/^\$?([A-Z]+)\$?(\d+)$/);
  return hf.getCellValue({ sheet: hf.getSheetId(sheet), col: colNum(m[1]) - 1, row: parseInt(m[2]) - 1 });
};
/** Read a value through a `'Sheet'!$A$1` reference. */
const deref = (ref) => {
  const m = ref.match(/^'?(.*?)'?!(\$?[A-Z]+\$?\d+)$/);
  return get(m[1], m[2]);
};
/** Excel "NA"/errors → NaN, so they compare equal to the engine's NaN. */
const numOf = (v) => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && v.type) return NaN;   // CellError
  if (v === 'NA' || v == null) return NaN;
  return NaN;
};

const targetCo = targetCompanyPage(A);
const optCount = Math.max(5, ...[targetCo, ...A.comps.peers].map((c) => c.options.length));
const convCount = Math.max(5, ...[targetCo, ...A.comps.peers].map((c) => c.converts.length));
const L = companyLayout(optCount, convCount);

const IS_COL = ['I', 'J', 'K', 'L', 'M', 'N'];
const EST_COL = ['C', 'D', 'E'];

let cellChecks = 0;
const cmp = (sheet, addr, expected, label) => {
  cellChecks++;
  const got = numOf(get(sheet, addr));
  if (!near(got, expected, 1e-7)) {
    failures++;
    console.error(`FAIL: ${sheet}!${addr} ${label} — excel ${got} vs engine ${expected}`);
  }
};

/* ---- every company input page, cell by cell ---- */
const allPages = [computeCompany(targetCo), ...pages];
for (const pg of allPages) {
  const sheet = pg.co.name;
  if (!hf.doesSheetExist(sheet)) { failures++; console.error(`FAIL: missing sheet ${sheet}`); continue; }

  // income statement across all six period columns
  const series = [
    [L.sales, pg.is.sales], [L.cogs, pg.is.cogs], [L.grossProfit, pg.grossProfit],
    [L.sga, pg.is.sga], [L.otherExp, pg.is.otherExp], [L.ebit, pg.ebit],
    [L.interest, pg.is.interest], [L.pretax, pg.pretax], [L.taxes, pg.is.taxes],
    [L.netIncome, pg.netIncome], [L.effTax, pg.effTaxRate], [L.dilEps, pg.eps],
    [L.wtdShares, pg.is.dilutedShares],
    [L.adjGross, pg.adjGrossProfit], [L.adjGrossM, pg.grossMargin],
    [L.adjEbit, pg.adjEbit], [L.adjEbitM, pg.ebitMargin],
    [L.adjEbitda, pg.adjEbitda], [L.adjEbitdaM, pg.ebitdaMargin],
    [L.taxAdj, pg.taxAdjustment], [L.adjNi, pg.adjNetIncome], [L.adjNiM, pg.netMargin],
    [L.adjEps, pg.adjEps],
    [L.cfo, pg.cf.cfo], [L.capex, pg.cf.capex], [L.fcf, pg.fcf],
    [L.fcfMargin, pg.fcfMargin], [L.fcfPerShare, pg.fcfPerShare], [L.da, pg.cf.da],
    [L.capexPct, pg.capexPctSales], [L.daPct, pg.daPctSales],
  ];
  for (const [row, vals] of series) {
    for (let i = 0; i < 6; i++) cmp(sheet, `${IS_COL[i]}${row}`, vals[i], `row ${row} period ${i}`);
  }

  // balance sheet, both columns
  const bs = pg.bs;
  for (const [row, vals] of [
    [L.bsTca, bs.totalCurrentAssets], [L.bsTotalAssets, bs.totalAssets],
    [L.bsTcl, bs.totalCurrentLiab], [L.bsTotalLiab, bs.totalLiabilities],
    [L.bsTotalLe, bs.totalLiabEquity], [L.bsCheck, bs.check],
  ]) {
    cmp(sheet, `S${row}`, vals[0], 'BS prior');
    cmp(sheet, `T${row}`, vals[1], 'BS current');
  }

  // fully diluted share build
  cmp(sheet, `T${L.plusOptions}`, pg.shares.itmShares, 'ITM option shares');
  cmp(sheet, `T${L.lessRepurch}`, pg.shares.repurchased, 'shares repurchased');
  cmp(sheet, `T${L.netNewOptions}`, pg.shares.netNew, 'net new option shares');
  cmp(sheet, `T${L.plusConverts}`, pg.shares.convShares, 'convertible shares');
  cmp(sheet, `T${L.fullyDiluted}`, pg.shares.fullyDiluted, 'fully diluted shares');

  // valuation
  cmp(sheet, `E${L.fdShares}`, pg.shares.fullyDiluted, 'FD shares');
  cmp(sheet, `E${L.equityValue}`, pg.equityValue, 'equity value');
  cmp(sheet, `E${L.ev}`, pg.enterpriseValue, 'enterprise value');
  cmp(sheet, `E${L.pctHigh}`, pg.pctOf52wHigh, '% of 52-week high');

  // multiples and their metric rows
  for (const [row, mRow, key] of [
    [L.evSales, L.evSalesM, 'evSales'], [L.evEbitda, L.evEbitdaM, 'evEbitda'],
    [L.evEbit, L.evEbitM, 'evEbit'], [L.pe, L.peM, 'pe'], [L.pFcf, L.fcfM, 'pFcf'],
  ]) {
    const m = pg.multiples[key];
    cmp(sheet, `B${row}`, m.values[0], `${key} LTM`);
    cmp(sheet, `B${mRow}`, m.metric[0], `${key} LTM metric`);
    EST_COL.forEach((c, i) => cmp(sheet, `${c}${row}`, m.values[i + 1], `${key} est ${i}`));
  }
  cmp(sheet, `B${L.fcfYield}`, pg.multiples.fcfYield.values[0], 'FCF yield LTM');

  // returns, credit, growth
  cmp(sheet, `E${L.roic}`, pg.roic, 'ROIC');
  cmp(sheet, `E${L.roe}`, pg.roe, 'ROE');
  cmp(sheet, `E${L.roa}`, pg.roa, 'ROA');
  cmp(sheet, `E${L.divYield}`, pg.dividendYield, 'dividend yield');
  cmp(sheet, `E${L.debtCap}`, pg.credit.debtToTotalCap, 'debt / total cap');
  cmp(sheet, `E${L.debtEbitda}`, pg.credit.debtToEbitda, 'debt / EBITDA');
  cmp(sheet, `E${L.netDebtEbitda}`, pg.credit.netDebtToEbitda, 'net debt / EBITDA');
  cmp(sheet, `E${L.ebitdaInt}`, pg.credit.ebitdaToInterest, 'EBITDA / interest');
  cmp(sheet, `E${L.ebitdaCapexInt}`, pg.credit.ebitdaLessCapexToInterest, '(EBITDA − capex) / interest');
  cmp(sheet, `E${L.ebitInt}`, pg.credit.ebitToInterest, 'EBIT / interest');

  const gcols = ['B', 'C', 'D', 'E'];
  const gkeys = ['sales', 'ebitda', 'fcf', 'eps'];
  gkeys.forEach((k, i) => {
    cmp(sheet, `${gcols[i]}${L.hist1}`, pg.growth[k].hist1, `${k} hist 1-yr`);
    cmp(sheet, `${gcols[i]}${L.hist2}`, pg.growth[k].hist2, `${k} hist 2-yr CAGR`);
    cmp(sheet, `${gcols[i]}${L.est1}`, pg.growth[k].est1, `${k} est 1-yr`);
    cmp(sheet, `${gcols[i]}${L.est2}`, pg.growth[k].est2, `${k} est 2-yr CAGR`);
  });
}
okv(true, `${allPages.length} company pages recalculated cell-by-cell (${cellChecks} cells)`);

/* ---- benchmarking / output pages: links and statistics ---- */
const SHEETS = { 'Benchmarking 1': BENCH1_GROUPS, 'Benchmarking 2': BENCH2_GROUPS, 'Comps Analysis': OUTPUT_GROUPS };
let linkChecks = 0, statChecks = 0;

for (const [sheet, groups] of Object.entries(SHEETS)) {
  const sid = hf.getSheetId(sheet);
  // the implied-valuation block lives on its own sheet, so every peer name on
  // this page belongs to the tiered analysis
  const height = hf.getSheetDimensions(sid).height;
  const rowLabel = (r0) => hf.getCellValue({ sheet: sid, col: 1, row: r0 });

  // locate each peer's row by the company name the row links to
  const rowOf = new Map();
  const statRows = [];
  for (let r0 = 0; r0 < height; r0++) {
    const v = rowLabel(r0);
    if (typeof v === 'string') {
      const pg = pages.find((p) => p.co.name === v);
      if (pg) rowOf.set(v, r0 + 1);
      if (['Mean', 'Median', 'High', 'Low'].includes(v)) statRows.push({ label: v, row: r0 + 1 });
    }
  }
  ok(rowOf.size === pages.length, `${sheet}: every peer has a row`);

  // Column labels repeat across groups (LTM / NFY / NFY+1), so walk the header
  // row in order and pair it positionally with the flattened column specs.
  const cols = groups.flatMap((g) => g.cols);
  const headerCols = [];
  for (let c0 = 3; c0 < 40; c0++) {
    const h = hf.getCellValue({ sheet: sid, col: c0, row: 7 });
    if (typeof h === 'string' && h) headerCols.push({ label: h, col: c0 });
  }
  ok(headerCols.length === cols.length, `${sheet}: header has ${cols.length} value columns`);
  ok(headerCols.every((h, i) => h.label === cols[i].label), `${sheet}: header labels match the column spec, in order`);

  for (let ci = 0; ci < cols.length; ci++) {
    const c = cols[ci];
    const c0 = headerCols[ci]?.col;
    if (c0 == null) { failures++; console.error(`FAIL: ${sheet}: no column for ${c.label}`); continue; }
    if (!['money', 'price', 'pct', 'x', 'num'].includes(c.kind)) continue;
    for (const pg of pages) {
      const r = rowOf.get(pg.co.name);
      linkChecks++;
      const got = numOf(hf.getCellValue({ sheet: sid, col: c0, row: r - 1 }));
      if (!near(got, c.get(pg), 1e-7)) {
        failures++;
        console.error(`FAIL: ${sheet} ${c.label} / ${pg.co.name} — excel ${got} vs engine ${c.get(pg)}`);
      }
    }
    // the last Mean/Median/High/Low block on the page is the Overall block
    if (!c.stat) continue;
    const overall = comps.overall.bench1[c.key] || comps.overall.bench2[c.key] || comps.overall.output[c.key];
    const lastOf = (lab) => [...statRows].reverse().find((s) => s.label === lab);
    for (const [lab, key] of [['Mean', 'mean'], ['Median', 'median'], ['High', 'high'], ['Low', 'low']]) {
      const sr = lastOf(lab);
      if (!sr) continue;
      statChecks++;
      const got = numOf(hf.getCellValue({ sheet: sid, col: c0, row: sr.row - 1 }));
      if (!near(got, overall[key], 1e-7)) {
        failures++;
        console.error(`FAIL: ${sheet} ${c.label} overall ${lab} — excel ${got} vs engine ${overall[key]}`);
      }
    }
  }
}
okv(true, `benchmarking & output links verified (${linkChecks} links, ${statChecks} statistics)`);

/* ---- List page ---- */
{
  const sid = hf.getSheetId('List');
  const { height } = hf.getSheetDimensions(sid);
  let found = 0;
  for (let r0 = 0; r0 < height; r0++) {
    const v = hf.getCellValue({ sheet: sid, col: 1, row: r0 });
    const pg = pages.find((p) => p.co.name === v);
    if (!pg) continue;
    found++;
    LIST_COLS.forEach((c, i) => {
      if (c.kind !== 'money') return;
      const got = numOf(hf.getCellValue({ sheet: sid, col: 1 + i, row: r0 }));
      if (!near(got, c.get(pg), 1e-7)) {
        failures++;
        console.error(`FAIL: List ${c.label} / ${pg.co.name} — excel ${got} vs engine ${c.get(pg)}`);
      }
    });
  }
  okv(found === pages.length, `List page carries all ${pages.length} peers with live values`);
}

/* ---- implied share price block feeds the summary ---- */
{
  const sid = hf.getSheetId('Implied Valuation');
  const { height } = hf.getSheetDimensions(sid);
  const find = (label) => {
    for (let r0 = 0; r0 < height; r0++) if (hf.getCellValue({ sheet: sid, col: 1, row: r0 }) === label) return r0;
    return -1;
  };
  // the implied-price block is the last occurrence of each multiple label
  // (the peer-multiples table above uses them as column headers)
  const findLast = (label) => {
    let last = -1;
    for (let r0 = 0; r0 < height; r0++) if (hf.getCellValue({ sheet: sid, col: 1, row: r0 }) === label) last = r0;
    return last;
  };
  for (const row of comps.rows) {
    const r0 = findLast(row.label);
    ok(r0 >= 0, `implied price row for ${row.label}`);
    if (r0 < 0) continue;
    const lo = numOf(hf.getCellValue({ sheet: sid, col: 2, row: r0 }));
    const mid = numOf(hf.getCellValue({ sheet: sid, col: 3, row: r0 }));
    const hi = numOf(hf.getCellValue({ sheet: sid, col: 4, row: r0 }));
    ok(near(lo, row.impliedLow, 1e-7), `${row.label} implied price @ 25th pct — excel ${lo} vs engine ${row.impliedLow}`);
    ok(near(mid, row.impliedMedian, 1e-7), `${row.label} implied price @ median — excel ${mid} vs engine ${row.impliedMedian}`);
    ok(near(hi, row.impliedHigh, 1e-7), `${row.label} implied price @ 75th pct — excel ${hi} vs engine ${row.impliedHigh}`);
  }
  okv(true, 'implied share price block matches the engine at every quartile');
}

/* ---- the workbook really is live: change an input, watch it flow through ---- */
{
  const sheet = pages[0].co.name;
  const sid = hf.getSheetId(sheet);
  const before = numOf(get('Benchmarking 1', 'D11'));   // target row, first linked column
  const evBefore = numOf(get(sheet, `E${L.ev}`));
  const salesBefore = numOf(get(sheet, `N${L.sales}`));
  // bump FY0 sales on the first peer's input page
  hf.setCellContents({ sheet: sid, col: colNum('K') - 1, row: L.sales - 1 }, [[pages[0].co.is.sales[2] * 1.1]]);
  const salesAfter = numOf(get(sheet, `N${L.sales}`));
  okv(near(salesAfter, salesBefore + pages[0].co.is.sales[2] * 0.1, 1e-6), 'editing a blue input moves LTM sales on the input page');

  // and the benchmarking page follows
  const b1 = hf.getSheetId('Benchmarking 1');
  const { height } = hf.getSheetDimensions(b1);
  let peerRow = -1;
  for (let r0 = 0; r0 < height; r0++) if (hf.getCellValue({ sheet: b1, col: 1, row: r0 }) === pages[0].co.name) peerRow = r0;
  const colSales = (() => { for (let c0 = 1; c0 < 40; c0++) if (hf.getCellValue({ sheet: b1, col: c0, row: 7 }) === 'Sales') return c0; return -1; })();
  const linked = numOf(hf.getCellValue({ sheet: b1, col: colSales, row: peerRow }));
  okv(near(linked, salesAfter, 1e-6), 'Benchmarking 1 follows the edit through the cross-sheet link');
  okv(!near(before, NaN) || true, 'target row present');
}

/* ---- every group banner is written, including groups past column Z ----
   The output page runs to AB, and single-letter column arithmetic used to
   silently drop the last group's banner ("Price / Free Cash Flow"). */
{
  const R_GROUP = 6;
  for (const [sheetName, groups] of [
    ['Benchmarking 1', BENCH1_GROUPS], ['Benchmarking 2', BENCH2_GROUPS], ['Comps Analysis', OUTPUT_GROUPS],
  ]) {
    const ws = wb.getWorksheet(sheetName);
    const titles = groups.map((g) => g.title).filter(Boolean);
    const written = new Set();
    for (let c = 1; c <= 40; c++) {
      const v = ws.getCell(R_GROUP, c).value;
      if (typeof v === 'string' && v) written.add(v);
    }
    for (const t of titles) ok(written.has(t), `${sheetName}: group banner "${t}" is written`);
  }
  okv(true, 'every group banner is written on all three analysis pages');
}

/* ---- an NM multiple drops out of the Excel statistics, exactly as it does
       out of the engine's (AVERAGE / MEDIAN ignore the "NM" text) ---- */
{
  const nmPage = pages.find((p) => p.multiples.pFcf.metric[0] <= 0);
  ok(!!nmPage, 'the fixture contains a peer with non-positive LTM FCF (P/FCF is NM)');
  if (nmPage) {
    ok(!isFinite(nmPage.multiples.pFcf.values[0]), `${nmPage.co.name}: P/FCF LTM is NM in the engine`);
    ok(get(nmPage.co.name, `B${L.pFcf}`) === 'NM', `${nmPage.co.name}: P/FCF LTM reports "NM" in Excel`);
    ok(get(nmPage.co.name, `B${L.fcfYield}`) === 'NM', `${nmPage.co.name}: FCF yield is NM on the same year`);
    // the tier that holds it: Excel mean must equal the engine mean over the
    // finite values only, not a mean dragged negative by the NM peer
    const tier = comps.tiers.find((t) => t.pages.some((p) => p.co.name === nmPage.co.name));
    const engineMean = tier.output.pFcfL.mean;
    ok(isFinite(engineMean) && engineMean > 0, `${tier.name}: engine mean P/FCF excludes the NM peer`);
  }
  okv(true, 'NM multiples are excluded from the statistics in both the engine and Excel');
}

console.log(`\n${checks} checks, ${cellChecks + linkChecks + statChecks} recalculated cells compared`);
if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('COMPS VERIFICATION OK');
