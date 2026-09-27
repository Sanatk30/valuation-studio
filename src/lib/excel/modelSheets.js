/**
 * Three-statement (with the forecast ratio block), past-ratio and IPO pages.
 * Every page links to the operating projection (projectionSheet.js) and the
 * Inputs sheet, and mirrors its engine exactly:
 *
 *   3 Statement — engine/threeStatement.js: interest on OPENING balances (no
 *                 circularity), tax through the NOL carryforward, cash as the
 *                 balancing item, and a constant "other net assets" line that
 *                 ties the opening balance sheet to the reported equity.
 *   Ratios      — engine/ratios.js computeRatios (annual forecast) and
 *                 computeHistoryRatios (reported history only).
 *   IPO         — engine/ipo.js: greenshoe size × % exercised, primary or
 *                 secondary greenshoe, NOL-aware pro-forma Year-1 earnings.
 */
import {
  put, colL, colRun, na, styleSheet, edge, nv,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_MUTED,
  C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';
import { historyLine, fyLabel } from '../historyModel.js';

const MUTED = { italic: true, color: C_MUTED };

/** A navy banner across columns A..(span). */
function sectionHeader(ws, row, text, span) {
  for (let i = 1; i <= span; i++) put(ws, `${colL(i)}${row}`, i === 1 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
  if (span > 1) ws.mergeCells(`A${row}:${colL(span)}${row}`);
  ws.getRow(row).height = 18;
}

/** Year header row: B = Year 0 (opening), C.. = forecast years. */
function yearHeader(ws, row, n, F, opts = {}) {
  const { withZero = true, label } = opts;
  if (label) put(ws, `A${row}`, label, { italic: true, fill: C_SECTION_FILL });
  put(ws, `B${row}`, withZero ? 0 : '', { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  for (let i = 0; i < n; i++) put(ws, `${colL(3 + i)}${row}`, i + 1, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
}

/* ==================================================================== */
/*                           3-Statement sheet                          */
/* ==================================================================== */

/**
 * The linked three-statement model. `P` is the projection page (its `ref`
 * links a projected line). o.balanceSheet = false (IPO) leaves out the
 * balance sheet — the IPO method does not collect PP&E or equity — and keeps
 * the income statement, cash flow and the debt & cash schedule.
 * o.ratios adds the forecast ratio block (computeRatios on the annual model).
 */
export function writeThreeStatementSheet(ws, a, F, R, P, o = {}) {
  const { balanceSheet = true, ratios = false, title = 'THREE-STATEMENT MODEL' } = o;
  const n = a.drivers.years;
  const yc = (i) => colL(3 + i);
  const span = 2 + n;
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 14;
  for (let i = 0; i < n; i++) ws.getColumn(3 + i).width = 14;
  styleSheet(ws, { freezeRow: 3, freezeCol: 2, tab: C_TAB_ANALYSIS, printTitles: '1:3' });

  let tr = 1;
  put(ws, `A${tr}`, title, { bold: true, size: 14 });
  put(ws, `D${tr}`, 'Interest on opening balances — no circular references. Tax after tax losses (NOL).', MUTED);
  ws.getRow(tr).height = 22;
  edge(ws, tr, colRun(1, span), 'bottom', 'medium', C_HDR_FILL);
  tr += 2;
  yearHeader(ws, tr, n, F);
  tr++;

  const T = {};
  const line = (key, label, opts = {}) => { T[key] = tr; put(ws, `A${tr}`, label, opts); tr++; };
  const each = (key, f, fmt, opts = {}) => {
    for (let i = 0; i < n; i++) put(ws, `${yc(i)}${T[key]}`, { formula: f(yc(i), i, i === 0 ? 'B' : yc(i - 1)) }, { fmt, ...opts });
  };
  const link = { color: C_LINK };

  sectionHeader(ws, tr++, 'INCOME STATEMENT', span);
  line('rev', 'Revenue', { bold: true });
  line('ebitda', 'EBITDA');
  line('da', 'Less: D&A');
  line('ebit', 'EBIT', { bold: true });
  line('intExp', 'Less: Interest expense (on opening debt)');
  line('intInc', 'Add: Interest income (on opening cash)');
  line('ebt', 'Pre-tax income', { bold: true });
  line('nolOpen', '   Tax losses brought forward (NOL)', MUTED);
  line('nolUsed', '   NOL used', MUTED);
  line('nolClose', '   Tax losses carried forward', MUTED);
  line('tax', 'Less: Tax (after tax losses)');
  line('ni', 'Net income', { bold: true });
  tr++;
  sectionHeader(ws, tr++, 'CASH FLOW STATEMENT', span);
  line('cfo', 'Cash from operations (NI + D&A − ΔNWC)');
  line('cfi', 'Cash from investing (capex)');
  line('div', 'Less: Dividends');
  line('repay', 'Less: Debt repayment');
  line('cff', 'Cash from financing');
  line('dCash', 'Net change in cash', { bold: true });
  tr++;
  if (balanceSheet) {
    sectionHeader(ws, tr++, 'BALANCE SHEET', span);
    line('cash', 'Cash & equivalents');
    line('nwc', 'Net working capital');
    line('ppe', 'Net PP&E');
    line('ona', 'Other net assets / (liabilities)');
    line('assets', 'Total net assets', { bold: true });
    line('debt', 'Total debt');
    line('equity', "Shareholders' equity");
    line('liabEq', 'Total debt + equity', { bold: true });
    line('check', 'Balance check (must be 0)', { italic: true });
    tr++;
  }
  sectionHeader(ws, tr++, 'DEBT & CASH SCHEDULE', span);
  line('openDebt', 'Opening debt');
  line('schedRepay', 'Mandatory repayment');
  line('closeDebt', 'Closing debt', { bold: true });
  line('openCash', 'Opening cash');
  line('closeCash', 'Closing cash', { bold: true });

  // Year 0 anchors
  put(ws, `B${T.rev}`, { formula: R.rev0 }, { fmt: F.money, ...link });
  put(ws, `B${T.ebitda}`, { formula: R.ebitda0 }, { fmt: F.money, ...link });
  put(ws, `B${T.closeDebt}`, { formula: R.grossDebt }, { fmt: F.money, ...link });
  put(ws, `B${T.closeCash}`, { formula: R.cash }, { fmt: F.money, ...link });

  each('rev', (c, i) => P.ref('sales', i), F.money, { ...link, bold: true });
  each('ebitda', (c, i) => P.ref('ebitda', i), F.money, link);
  each('da', (c, i) => `-${P.ref('da', i)}`, F.money, link);
  each('ebit', (c) => `${c}${T.ebitda}+${c}${T.da}`, F.money, { bold: true });
  each('openDebt', (c, i, p) => `${p}${T.closeDebt}`, F.money);
  each('schedRepay', (c) => `${c}${T.openDebt}*${R.repayPct}`, F.money);
  each('closeDebt', (c) => `${c}${T.openDebt}-${c}${T.schedRepay}`, F.money, { bold: true });
  each('openCash', (c, i, p) => `${p}${T.closeCash}`, F.money);
  each('closeCash', (c) => `${c}${T.openCash}+${c}${T.dCash}`, F.money, { bold: true });
  each('intExp', (c) => `-${c}${T.openDebt}*${R.intDebt}`, F.money);
  each('intInc', (c) => `${c}${T.openCash}*${R.intCash}`, F.money);
  each('ebt', (c) => `${c}${T.ebit}+${c}${T.intExp}+${c}${T.intInc}`, F.money, { bold: true });
  each('nolOpen', (c, i, p) => (i === 0 ? R.nol0 : `${p}${T.nolClose}`), F.money, MUTED);
  each('nolUsed', (c) => `IF(${c}${T.ebt}>0,MIN(${c}${T.nolOpen},${c}${T.ebt}),0)`, F.money, MUTED);
  each('nolClose', (c) => `${c}${T.nolOpen}-${c}${T.nolUsed}+IF(${c}${T.ebt}<=0,-${c}${T.ebt},0)`, F.money, MUTED);
  each('tax', (c) => `-MAX(0,${c}${T.ebt}-${c}${T.nolUsed})*${R.tax}`, F.money);
  each('ni', (c) => `${c}${T.ebt}+${c}${T.tax}`, F.money, { bold: true, top: true });
  each('cfo', (c, i) => `${c}${T.ni}+${P.ref('da', i)}+${P.ref('dnwc', i)}`, F.money);
  each('cfi', (c, i) => P.ref('capex', i), F.money, link);
  each('div', (c) => `-MAX(0,${c}${T.ni})*${R.payout}`, F.money);
  each('repay', (c) => `-${c}${T.schedRepay}`, F.money);
  each('cff', (c) => `${c}${T.div}+${c}${T.repay}`, F.money);
  each('dCash', (c) => `${c}${T.cfo}+${c}${T.cfi}+${c}${T.cff}`, F.money, { bold: true, top: true });

  if (balanceSheet) {
    put(ws, `B${T.cash}`, { formula: R.cash }, { fmt: F.money, ...link });
    put(ws, `B${T.nwc}`, { formula: R.nwc0 }, { fmt: F.money, ...link });
    put(ws, `B${T.ppe}`, { formula: R.ppe0 }, { fmt: F.money, ...link });
    put(ws, `B${T.ona}`, { formula: R.ona }, { fmt: F.money, ...link });
    put(ws, `B${T.debt}`, { formula: R.grossDebt }, { fmt: F.money, ...link });
    each('cash', (c) => `${c}${T.closeCash}`, F.money);
    each('nwc', (c, i) => P.ref('nwc', i), F.money, link);
    each('ppe', (c, i, p) => `${p}${T.ppe}-${P.ref('capex', i)}-${P.ref('da', i)}`, F.money);
    each('ona', (c, i, p) => `${p}${T.ona}`, F.money);
    each('debt', (c) => `${c}${T.closeDebt}`, F.money);
    each('equity', (c, i, p) => `${p}${T.equity}+${c}${T.ni}+${c}${T.div}`, F.money);
    for (const c of ['B', ...Array.from({ length: n }, (_, i) => yc(i))]) {
      put(ws, `${c}${T.assets}`, { formula: `${c}${T.cash}+${c}${T.nwc}+${c}${T.ppe}+${c}${T.ona}` }, { fmt: F.money, bold: true, top: true });
      put(ws, `${c}${T.liabEq}`, { formula: `${c}${T.debt}+${c}${T.equity}` }, { fmt: F.money, bold: true, top: true });
      put(ws, `${c}${T.check}`, { formula: `ROUND(${c}${T.assets}-${c}${T.liabEq},6)` }, { fmt: F.num, italic: true });
    }
    // opening equity = the reported figure (the other-net-assets line is the gap)
    put(ws, `B${T.equity}`, { formula: `B${T.assets}-B${T.debt}` }, { fmt: F.money });
  }

  if (ratios) tr = writeForecastRatios(ws, a, F, R, P, T, tr + 1, n);

  const q = `'${ws.name}'`;
  return { T, yc, ni: (i) => `${q}!$${yc(i)}$${T.ni}`, ebt: (i) => `${q}!$${yc(i)}$${T.ebt}`, nolOpen: (i) => `${q}!$${yc(i)}$${T.nolOpen}`, lastRow: tr };
}

/**
 * The forecast ratio block — computeRatios on the annual model (m = 1), row
 * for row. NOPAT and FCFF come from the projection's unlevered NOL schedule;
 * FCFE = net income + D&A − capex − ΔNWC − repayment. A ratio whose base is
 * zero reads NA.
 */
function writeForecastRatios(ws, a, F, R, P, T, r0, n) {
  const yc = (i) => colL(3 + i);
  const span = 2 + n;
  let r = r0;
  const prev = (key, i) => (i === 0 ? `B${T[key]}` : `${yc(i - 1)}${T[key]}`);
  const avg = (key, i) => `((${prev(key, i)}+${yc(i)}${T[key]})/2)`;
  const cur = (key, i) => `${yc(i)}${T[key]}`;
  // positive-signed flows
  const rev = (i) => cur('rev', i), ebitda = (i) => cur('ebitda', i), ebit = (i) => cur('ebit', i);
  const ebt = (i) => cur('ebt', i), ni = (i) => cur('ni', i);
  const tax = (i) => `(-${cur('tax', i)})`, intExp = (i) => `(-${cur('intExp', i)})`;
  const div = (i) => `(-${cur('div', i)})`, repay = (i) => cur('schedRepay', i);
  const da = (i) => P.ref('da', i), capex = (i) => `(-${P.ref('capex', i)})`, dnwc = (i) => `(-${P.ref('dnwc', i)})`;
  const nopat = (i) => P.ref('ebiat', i), fcff = (i) => P.ref('fcff', i), cfo = (i) => cur('cfo', i);
  const fcfe = (i) => `(${ni(i)}+${da(i)}-${capex(i)}-${dnwc(i)}-${repay(i)})`;
  const closeDebt = (i) => cur('closeDebt', i), closeCash = (i) => cur('closeCash', i);
  const nd = (i) => `(${closeDebt(i)}-${closeCash(i)})`;
  const eqC = (i) => cur('equity', i), assetsC = (i) => cur('assets', i);
  const avgInvCap = (i) => `((${prev('closeDebt', i)}-${prev('closeCash', i)}+${prev('equity', i)}+${closeDebt(i)}-${closeCash(i)}+${eqC(i)})/2)`;
  const avgCapEmp = (i) => `((${prev('closeDebt', i)}+${prev('equity', i)}+${closeDebt(i)}+${eqC(i)})/2)`;
  const avgNwc = (i) => `((${i === 0 ? R.nwc0 : P.ref('nwc', i - 1)}+${P.ref('nwc', i)})/2)`;
  const shares = R.shares, price = R.curPrice;
  const retention = (i) => `(1-${div(i)}/${ni(i)})`;
  const roe = (i) => `(${ni(i)}/${avg('equity', i)})`;
  const eps = (i) => `(${ni(i)}/${shares})`, bvps = (i) => `(${eqC(i)}/${shares})`, dps = (i) => `(${div(i)}/${shares})`;
  const mktcap = `(${price}*${shares})`;
  const ev = (i) => `(${mktcap}+${nd(i)})`;
  const pe = (i) => `(${price}/${eps(i)})`;
  const yoy = (fn) => (i) => (i >= 1 ? `${fn(i)}/${fn(i - 1)}-1` : null);

  const hasValuation = a.company.currentPrice > 0 && a.company.sharesOut > 0;
  const sections = [
    ['Profitability & margins', [
      ['EBITDA margin', 'pct', (i) => `${ebitda(i)}/${rev(i)}`],
      ['EBIT (operating) margin', 'pct', (i) => `${ebit(i)}/${rev(i)}`],
      ['Pre-tax margin', 'pct', (i) => `${ebt(i)}/${rev(i)}`],
      ['Net profit margin', 'pct', (i) => `${ni(i)}/${rev(i)}`],
      ['FCFF margin', 'pct', (i) => `${fcff(i)}/${rev(i)}`],
      ['Effective tax rate', 'pct', (i) => `${tax(i)}/${ebt(i)}`],
    ]],
    ['Returns (annualised) & DuPont', [
      ['Return on equity (ROE)', 'pct', roe],
      ['Return on assets (ROA)', 'pct', (i) => `${ni(i)}/${avg('assets', i)}`],
      ['Return on invested capital (ROIC)', 'pct', (i) => `${nopat(i)}/${avgInvCap(i)}`],
      ['Return on capital employed (ROCE)', 'pct', (i) => `${ebit(i)}/${avgCapEmp(i)}`],
      ['DuPont · net margin', 'pct', (i) => `${ni(i)}/${rev(i)}`],
      ['DuPont · asset turnover', 'x', (i) => `${rev(i)}/${avg('assets', i)}`],
      ['DuPont · equity multiplier', 'x', (i) => `${avg('assets', i)}/${avg('equity', i)}`],
    ]],
    ['Leverage & solvency', [
      ['Debt / Equity', 'x', (i) => `${closeDebt(i)}/${eqC(i)}`],
      ['Net debt / Equity', 'x', (i) => `${nd(i)}/${eqC(i)}`],
      ['Net debt / EBITDA (ann.)', 'x', (i) => `${nd(i)}/${ebitda(i)}`],
      ['Debt / EBITDA (ann.)', 'x', (i) => `${closeDebt(i)}/${ebitda(i)}`],
      ['Net debt / Capital', 'pct', (i) => `${nd(i)}/(${nd(i)}+${eqC(i)})`],
      ['Equity ratio (equity / assets)', 'pct', (i) => `${eqC(i)}/${assetsC(i)}`],
      ['Financial leverage (assets / equity)', 'x', (i) => `${assetsC(i)}/${eqC(i)}`],
    ]],
    ['Coverage', [
      ['Interest coverage (EBIT / int.)', 'x', (i) => `${ebit(i)}/${intExp(i)}`],
      ['EBITDA / interest', 'x', (i) => `${ebitda(i)}/${intExp(i)}`],
      ['(EBITDA − capex) / interest', 'x', (i) => `(${ebitda(i)}-${capex(i)})/${intExp(i)}`],
      ['Debt-service cover (DSCR)', 'x', (i) => `${ebitda(i)}/(${intExp(i)}+${repay(i)})`],
    ]],
    ['Efficiency & liquidity', [
      ['Asset turnover (ann.)', 'x', (i) => `${rev(i)}/${avg('assets', i)}`],
      ['Fixed-asset turnover (ann.)', 'x', (i) => `${rev(i)}/${avg('ppe', i)}`],
      ['NWC turnover (ann.)', 'x', (i) => `${rev(i)}/${avgNwc(i)}`],
      ['NWC / revenue', 'pct', (i) => `${P.ref('nwc', i)}/${rev(i)}`],
      ['Cash / debt', 'x', (i) => `${closeCash(i)}/${closeDebt(i)}`],
      ['Reinvestment rate', 'pct', (i) => `(${capex(i)}-${da(i)}+${dnwc(i)})/${nopat(i)}`],
    ]],
    ['Per share', [
      ['EPS (ann.)', 'price', eps],
      ['DPS (ann.)', 'price', dps],
      ['Book value / share', 'price', bvps],
      ['FCFF / share (ann.)', 'price', (i) => `${fcff(i)}/${shares}`],
      ['Dividend payout', 'pct', (i) => `${div(i)}/${ni(i)}`],
      ['Retention ratio', 'pct', retention],
    ]],
    ['Cash flow', [
      ['FCFF', 'num', fcff],
      ['FCFE', 'num', fcfe],
      ['Operating cash flow (CFO)', 'num', cfo],
      ['FCF conversion (FCFF / EBITDA)', 'pct', (i) => `${fcff(i)}/${ebitda(i)}`],
      ['Cash-flow margin (CFO / rev.)', 'pct', (i) => `${cfo(i)}/${rev(i)}`],
    ]],
    ['Growth', [
      ['Revenue growth (period/period)', 'pct', yoy(rev)],
      ['Revenue growth (YoY)', 'pct', yoy(rev)],
      ['EBITDA growth (YoY)', 'pct', yoy(ebitda)],
      ['Net income growth (YoY)', 'pct', yoy(ni)],
      ['Sustainable growth (ROE × retention)', 'pct', (i) => `${roe(i)}*${retention(i)}`],
    ]],
    ...(hasValuation ? [['Valuation (at current price)', [
      ['Market capitalisation', 'num', () => mktcap],
      ['Enterprise value (EV)', 'num', ev],
      ['P / E', 'x', pe],
      ['P / B', 'x', (i) => `${price}/${bvps(i)}`],
      ['EV / EBITDA (ann.)', 'x', (i) => `${ev(i)}/${ebitda(i)}`],
      ['EV / Sales (ann.)', 'x', (i) => `${ev(i)}/${rev(i)}`],
      ['Dividend yield', 'pct', (i) => `${dps(i)}/${price}`],
      ['FCFE yield', 'pct', (i) => `${fcfe(i)}/${mktcap}`],
      ['Earnings yield', 'pct', (i) => `1/${pe(i)}`],
    ]]] : []),
  ];

  const fmtOf = (k) => ({ pct: F.pct, x: F.x2, price: F.price, num: F.money }[k]);
  sectionHeader(ws, r++, 'RATIO ANALYSIS — FORECAST', span);
  for (const [title, rows] of sections) {
    put(ws, `A${r}`, title, { bold: true, fill: C_SECTION_FILL });
    for (let c = 2; c <= span; c++) put(ws, `${colL(c)}${r}`, '', { fill: C_SECTION_FILL });
    r++;
    for (const [label, kind, fn] of rows) {
      put(ws, `A${r}`, label);
      for (let i = 0; i < n; i++) {
        const f = fn(i);
        put(ws, `${yc(i)}${r}`, f ? { formula: na(f) } : 'NA', { fmt: fmtOf(kind), align: 'right' });
      }
      r++;
    }
  }
  r++;
  put(ws, `A${r++}`, '“(ann.)” marks a figure on an annual basis. Balance-based ratios use the average of opening and closing balances; a ratio on a zero base reads NA.', { italic: true, color: C_MUTED, size: 9 });
  return r;
}

/* ==================================================================== */
/*                          Past ratios (reported)                      */
/* ==================================================================== */

const PAST_LINES = [
  ['revenue', 'Revenue'], ['cogs', 'Cost of goods sold'], ['ebitda', 'EBITDA'], ['da', 'Depreciation & amortisation'],
  ['interest', 'Interest expense'], ['pbt', 'Profit before tax'], ['tax', 'Tax expense'], ['ni', 'Net income'],
  ['cash', 'Cash & equivalents'], ['receivables', 'Receivables'], ['inventory', 'Inventory'], ['ppe', 'Net PP&E'],
  ['totalAssets', 'Total assets'], ['payables', 'Payables'], ['totalDebt', 'Total debt'], ['equity', "Shareholders' equity"],
  ['cfo', 'Cash from operations'], ['capex', 'Capital expenditure'], ['dividends', 'Dividends paid'],
];

/**
 * Ratios over REPORTED history (computeHistoryRatios): every reported period
 * as blue inputs ("NA" where a line was not reported), then the ratio block
 * over the latest `periods` of them. Balance-based ratios average with the
 * reported period before (NA for the first one). Nothing is back-cast.
 */
export function writePastRatiosSheet(ws, a, F, o = {}) {
  const { freq = 'Y', periods = null, unitNote = '' } = o;
  const h = a.history;
  const blockKey = freq === 'Q' ? 'quarterly' : 'annual';
  const blk = h[blockKey];
  const all = blk.dates.length;
  const N = Number.isInteger(periods) && periods > 0 ? Math.min(periods, all) : all;
  const first = all - N;
  const m = freq === 'Q' ? 4 : 1;
  const days = freq === 'Q' ? 91.25 : 365;
  const col = (i) => colL(2 + i);            // B.. = every reported period, oldest first
  const span = 1 + all;

  ws.getColumn(1).width = 40;
  for (let i = 0; i < all; i++) ws.getColumn(2 + i).width = 13;
  styleSheet(ws, { freezeRow: 4, freezeCol: 1, tab: C_TAB_ANALYSIS, printTitles: '1:4' });
  put(ws, 'A1', `RATIO ANALYSIS — PAST (${freq === 'Q' ? 'quarterly' : 'annual'}, reported)`, { bold: true, size: 14 });
  put(ws, 'A2', `${h.label || 'Reported history'} · ${unitNote}`, MUTED);
  edge(ws, 2, colRun(1, span), 'bottom', 'medium', C_HDR_FILL);
  let r = 4;
  put(ws, `A${r}`, 'Period', { bold: true, fill: C_SECTION_FILL });
  blk.dates.forEach((d, i) => put(ws, `${col(i)}${r}`, freq === 'Q' ? String(d).slice(0, 7) : fyLabel(d), { bold: true, align: 'center', fill: C_SECTION_FILL }));
  r += 2;

  sectionHeader(ws, r++, 'REPORTED FIGURES', span);
  const Lr = {};
  for (const [key, label] of PAST_LINES) {
    Lr[key] = r;
    put(ws, `A${r}`, label);
    const vals = historyLine(h, key, blockKey);
    blk.dates.forEach((_, i) => put(ws, `${col(i)}${r}`, nv(vals[i]), { fmt: F.money, color: C_INPUT, fill: C_INPUT_FILL, align: 'right' }));
    r++;
  }
  r++;

  const v = (key, i) => `${col(i)}${Lr[key]}`;
  const ebit = (i) => `(${v('ebitda', i)}-${v('da', i)})`;
  const netDebt = (i) => `(${v('totalDebt', i)}-${v('cash', i)})`;
  const fcf = (i) => `(${v('cfo', i)}-${v('capex', i)})`;
  const effTax = (i) => `(${v('tax', i)}/${v('pbt', i)})`;
  const avg = (fn) => (i) => (i > 0 ? `((${fn(i - 1)}+${fn(i)})/2)` : null);
  const lineF = (key) => (i) => v(key, i);
  const avgEq = avg(lineF('equity')), avgTa = avg(lineF('totalAssets')), avgPpe = avg(lineF('ppe'));
  const avgCapEmp = avg((i) => `(${v('totalDebt', i)}+${v('equity', i)})`);
  const avgInvCap = avg((i) => `(${v('totalDebt', i)}-${v('cash', i)}+${v('equity', i)})`);
  const withAvg = (a1, f) => (i) => (a1(i) === null ? null : f(i, a1(i)));
  const yoy = (key) => (i) => (i >= m ? `${v(key, i)}/${v(key, i - m)}-1` : null);
  const ann = m > 1 ? ' (ann.)' : '';

  const sections = [
    ['Profitability & margins', [
      ['Gross margin', 'pct', (i) => `(${v('revenue', i)}-${v('cogs', i)})/${v('revenue', i)}`],
      ['EBITDA margin', 'pct', (i) => `${v('ebitda', i)}/${v('revenue', i)}`],
      ['EBIT (operating) margin', 'pct', (i) => `${ebit(i)}/${v('revenue', i)}`],
      ['Pre-tax margin', 'pct', (i) => `${v('pbt', i)}/${v('revenue', i)}`],
      ['Net profit margin', 'pct', (i) => `${v('ni', i)}/${v('revenue', i)}`],
      ['Effective tax rate', 'pct', effTax],
    ]],
    [`Returns${m > 1 ? ' (annualised)' : ''} & DuPont`, [
      ['Return on equity (ROE)', 'pct', withAvg(avgEq, (i, av) => `${v('ni', i)}*${m}/${av}`)],
      ['Return on assets (ROA)', 'pct', withAvg(avgTa, (i, av) => `${v('ni', i)}*${m}/${av}`)],
      ['Return on invested capital (ROIC)', 'pct', withAvg(avgInvCap, (i, av) => `${ebit(i)}*(1-${effTax(i)})*${m}/${av}`)],
      ['Return on capital employed (ROCE)', 'pct', withAvg(avgCapEmp, (i, av) => `${ebit(i)}*${m}/${av}`)],
      ['DuPont · net margin', 'pct', (i) => `${v('ni', i)}/${v('revenue', i)}`],
      ['DuPont · asset turnover', 'x', withAvg(avgTa, (i, av) => `${v('revenue', i)}*${m}/${av}`)],
      ['DuPont · equity multiplier', 'x', withAvg(avgTa, (i, av) => `${av}/${avgEq(i)}`)],
    ]],
    ['Leverage & solvency', [
      ['Debt / Equity', 'x', (i) => `${v('totalDebt', i)}/${v('equity', i)}`],
      ['Net debt / Equity', 'x', (i) => `${netDebt(i)}/${v('equity', i)}`],
      [`Net debt / EBITDA${ann}`, 'x', (i) => `${netDebt(i)}/(${v('ebitda', i)}*${m})`],
      [`Debt / EBITDA${ann}`, 'x', (i) => `${v('totalDebt', i)}/(${v('ebitda', i)}*${m})`],
      ['Net debt / Capital', 'pct', (i) => `${netDebt(i)}/(${netDebt(i)}+${v('equity', i)})`],
      ['Equity ratio (equity / assets)', 'pct', (i) => `${v('equity', i)}/${v('totalAssets', i)}`],
      ['Financial leverage (assets / equity)', 'x', (i) => `${v('totalAssets', i)}/${v('equity', i)}`],
    ]],
    ['Coverage', [
      ['Interest coverage (EBIT / int.)', 'x', (i) => `${ebit(i)}/${v('interest', i)}`],
      ['EBITDA / interest', 'x', (i) => `${v('ebitda', i)}/${v('interest', i)}`],
      ['(EBITDA − capex) / interest', 'x', (i) => `(${v('ebitda', i)}-${v('capex', i)})/${v('interest', i)}`],
    ]],
    ['Efficiency & liquidity', [
      [`Asset turnover${ann}`, 'x', withAvg(avgTa, (i, av) => `${v('revenue', i)}*${m}/${av}`)],
      [`Fixed-asset turnover${ann}`, 'x', withAvg(avgPpe, (i, av) => `${v('revenue', i)}*${m}/${av}`)],
      ['Receivable days', 'days', (i) => `${v('receivables', i)}/${v('revenue', i)}*${days}`],
      ['Inventory days', 'days', (i) => `${v('inventory', i)}/${v('cogs', i)}*${days}`],
      ['Payable days', 'days', (i) => `${v('payables', i)}/${v('cogs', i)}*${days}`],
      ['Trade NWC / revenue', 'pct', (i) => `(${v('receivables', i)}+${v('inventory', i)}-${v('payables', i)})/(${v('revenue', i)}*${m})`],
      ['Cash / debt', 'x', (i) => `${v('cash', i)}/${v('totalDebt', i)}`],
    ]],
    ['Cash flow & payout', [
      ['Operating cash flow (CFO)', 'num', (i) => `${v('cfo', i)}+0`],
      ['Free cash flow (CFO − capex)', 'num', fcf],
      ['FCF conversion (FCF / EBITDA)', 'pct', (i) => `${fcf(i)}/${v('ebitda', i)}`],
      ['Cash conversion (CFO / net income)', 'x', (i) => `${v('cfo', i)}/${v('ni', i)}`],
      ['Cash-flow margin (CFO / rev.)', 'pct', (i) => `${v('cfo', i)}/${v('revenue', i)}`],
      ['Capex / D&A', 'x', (i) => `${v('capex', i)}/${v('da', i)}`],
      ['Dividend payout', 'pct', (i) => `${v('dividends', i)}/${v('ni', i)}`],
    ]],
    ['Growth', [
      [`Revenue growth (${m > 1 ? 'YoY' : 'year on year'})`, 'pct', yoy('revenue')],
      ['EBITDA growth', 'pct', yoy('ebitda')],
      ['Net income growth', 'pct', yoy('ni')],
      ...(m > 1 ? [['Revenue growth (quarter on quarter)', 'pct', (i) => (i > 0 ? `${v('revenue', i)}/${v('revenue', i - 1)}-1` : null)]] : []),
    ]],
  ];

  const fmtOf = (k) => ({ pct: F.pct, x: F.x2, days: F.num, num: F.money }[k]);
  sectionHeader(ws, r++, `RATIOS — the latest ${N} ${freq === 'Q' ? 'quarter' : 'year'}${N > 1 ? 's' : ''}`, span);
  for (const [title, rows] of sections) {
    put(ws, `A${r}`, title, { bold: true, fill: C_SECTION_FILL });
    for (let c = 2; c <= span; c++) put(ws, `${colL(c)}${r}`, '', { fill: C_SECTION_FILL });
    r++;
    for (const [label, kind, fn] of rows) {
      put(ws, `A${r}`, label);
      for (let i = first; i < all; i++) {
        const f = fn(i);
        put(ws, `${col(i)}${r}`, f ? { formula: na(f) } : 'NA', { fmt: fmtOf(kind), align: 'right' });
      }
      r++;
    }
  }
  r++;
  put(ws, `A${r++}`, 'Reported figures only — nothing is back-cast. Balance-based ratios average the opening (prior reported period) and closing balances.', { italic: true, color: C_MUTED, size: 9 });
  if (first > 0) put(ws, `A${r++}`, `Earlier reported periods are shown as inputs because the averages and growth rates read them.`, { italic: true, color: C_MUTED, size: 9 });
  return { first, all, N, col, lastRow: r };
}

/* ==================================================================== */
/*                                IPO sheet                             */
/* ==================================================================== */

export function writeIpoSheet(ws, a, F, R, P, TS) {
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 52;
  styleSheet(ws, { freezeRow: 1, tab: C_TAB_ANALYSIS, printTitles: '1:1', portrait: true });
  let ir = 1;
  put(ws, `A${ir}`, 'IPO VALUATION & DILUTION', { bold: true, size: 14 });
  ir += 2;
  const I = {};
  const iVal = (key, label, formula, fmt, note = '', opts = {}) => {
    I[key] = ir;
    put(ws, `A${ir}`, label, opts);
    put(ws, `B${ir}`, { formula }, { fmt, ...opts });
    if (note) put(ws, `C${ir}`, note, MUTED);
    ir++;
  };
  const B = (k) => `B${I[k]}`;

  sectionHeader(ws, ir++, 'PRICING', 3);
  iVal('ntmNI', 'Year-1 net income (3 Statement)', TS.ni(0), F.money, 'Tax after tax losses', { color: C_LINK });
  iVal('ntmEB', 'Year-1 EBITDA', P.ref('ebitda', 0), F.money, '', { color: C_LINK });
  iVal('fairPre', 'Fair pre-money equity value',
    `IF(${R.ipoBasis}="pe",${R.offerPE}*${B('ntmNI')},IF(${R.ipoBasis}="evEbitda",${R.offerEvE}*${B('ntmEB')}-${R.netDebt},"NA"))`,
    F.money, 'Basis chosen on the Inputs sheet ("pe" or "evEbitda")', { bold: true });
  iVal('fairPxPre', 'Fair value per existing share', na(`${B('fairPre')}/${R.shares}`), F.price);
  iVal('offerEq', 'Offer pre-money equity (after the IPO discount)', na(`${B('fairPre')}*(1-${R.ipoDisc})`), F.money);
  iVal('offerPx', 'OFFER PRICE', na(`${B('offerEq')}/${R.shares}`), F.price, '', { bold: true });
  ir++;
  sectionHeader(ws, ir++, 'DEAL STRUCTURE', 3);
  iVal('primSh', 'Primary shares issued', na(`IF(${B('offerPx')}>0,${R.ipoRaise}/${B('offerPx')},"NA")`), F.num);
  iVal('secSh', 'Secondary shares sold', `${R.shares}*${R.ipoSec}`, F.num);
  iVal('baseSh', 'Base deal shares', na(`${B('primSh')}+${B('secSh')}`), F.num);
  iVal('gsSh', 'Greenshoe shares (size × % exercised)', na(`${B('baseSh')}*${R.ipoGS}*${R.ipoGSEx}`), F.num);
  iVal('gsPrim', '   of which new (primary) shares', na(`IF(${R.ipoGSType}="primary",${B('gsSh')},IF(OR(${R.ipoGSType}="secondary",${B('gsSh')}=0),0,"NA"))`), F.num, 'Greenshoe type is on the Inputs sheet');
  iVal('gsSec', '   of which existing holders\' shares', na(`IF(${R.ipoGSType}="secondary",${B('gsSh')},IF(OR(${R.ipoGSType}="primary",${B('gsSh')}=0),0,"NA"))`), F.num);
  iVal('postSh', 'Post-IPO shares outstanding', na(`${R.shares}+${B('primSh')}+${B('gsPrim')}`), F.num, '', { bold: true });
  iVal('gsProceeds', 'Greenshoe proceeds', na(`${B('gsSh')}*${B('offerPx')}`), F.money);
  iVal('grossPrim', 'Gross primary proceeds (incl. primary greenshoe)', na(`(${B('primSh')}+${B('gsPrim')})*${B('offerPx')}`), F.money);
  iVal('grossSec', 'Gross secondary proceeds (to selling holders)', na(`(${B('secSh')}+${B('gsSec')})*${B('offerPx')}`), F.money);
  iVal('fees', 'Underwriting fees & expenses', na(`${B('grossPrim')}*${R.ipoFees}`), F.money);
  iVal('netPrim', 'Net primary proceeds to the company', na(`${B('grossPrim')}-${B('fees')}`), F.money, '', { bold: true });
  iVal('debtRepaid', 'Debt repaid from proceeds', na(`MIN(${R.grossDebt},${B('netPrim')}*${R.ipoUse})`), F.money);
  iVal('cashAdded', 'Cash retained on the balance sheet', na(`${B('netPrim')}-${B('debtRepaid')}`), F.money);
  ir++;
  sectionHeader(ws, ir++, 'POST-IPO EFFECTS', 3);
  iVal('debtPost', 'Gross debt post-IPO', na(`${R.grossDebt}-${B('debtRepaid')}`), F.money);
  iVal('cashPost', 'Cash post-IPO', na(`${R.cash}+${B('cashAdded')}`), F.money);
  iVal('ndPost', 'Net debt post-IPO', na(`${B('debtPost')}-${B('cashPost')}`), F.money, 'Falls one-for-one with net primary proceeds');
  iVal('intSaved', 'Interest saved on repaid debt (pre-tax)', na(`${B('debtRepaid')}*${R.intDebt}`), F.money);
  iVal('cashInc', 'Interest earned on cash added (pre-tax)', na(`${B('cashAdded')}*${R.intCash}`), F.money);
  iVal('ebtPost', 'Pro-forma Year-1 pre-tax income', na(`${TS.ebt(0)}+${B('intSaved')}+${B('cashInc')}`), F.money);
  iVal('nolUsedPost', '   NOL used (opening Year-1 balance)', na(`IF(${B('ebtPost')}>0,MIN(${TS.nolOpen(0)},${B('ebtPost')}),0)`), F.money, '', MUTED);
  iVal('taxPost', 'Pro-forma tax (after tax losses)', na(`MAX(0,${B('ebtPost')}-${B('nolUsedPost')})*${R.tax}`), F.money);
  iVal('niPost', 'Pro-forma Year-1 net income', na(`${B('ebtPost')}-${B('taxPost')}`), F.money, '', { bold: true });
  iVal('epsPre', 'Year-1 EPS pre-IPO', na(`${B('ntmNI')}/${R.shares}`), F.price);
  iVal('epsPost', 'Year-1 EPS post-IPO', na(`${B('niPost')}/${B('postSh')}`), F.price);
  iVal('dilution', 'EPS dilution', na(`${B('epsPost')}/${B('epsPre')}-1`), F.pct2, '', { italic: true });
  iVal('mktCap', 'Market cap at the offer (post-greenshoe)', na(`${B('offerPx')}*${B('postSh')}`), F.money, '', { bold: true });
  iVal('fairEqPost', 'Fair equity value post-IPO', na(`${B('fairPre')}+${B('netPrim')}`), F.money);
  iVal('fairPost', 'Fair value per share post-IPO', na(`${B('fairEqPost')}/${B('postSh')}`), F.price);
  iVal('uplift', 'Uplift when the discount unwinds', na(`${B('fairPost')}/${B('offerPx')}-1`), F.pct2, '', { italic: true });
  iVal('rangeLo', 'Bookbuild low (offer − band)', na(`${B('offerPx')}*(1-${R.ipoBand})`), F.price);
  iVal('rangeHi', 'Bookbuild high (fair value post-IPO)', `${B('fairPost')}`, F.price);
  ir++;
  sectionHeader(ws, ir++, 'OWNERSHIP — POST-IPO', 3);
  iVal('sold', 'Shares sold in the offer', na(`${B('primSh')}+${B('secSh')}+${B('gsSh')}`), F.num);
  iVal('float', 'Free float (new investors)', na(`${B('sold')}/${B('postSh')}`), F.pct2, 'Every share sold in the offer');
  iVal('ownExist', 'Existing holders', na(`(${R.shares}-${B('secSh')}-${B('gsSec')})/${B('postSh')}`), F.pct2, 'Pre-IPO shares less those they sold');
  iVal('ownChk', 'Check (sums to 100%)', na(`${B('ownExist')}+${B('float')}`), F.pct2, '', { italic: true });

  const q = `'${ws.name}'`;
  const at = (k) => `${q}!$B$${I[k]}`;
  return { I, refs: { offerPx: at('offerPx'), rangeLo: at('rangeLo'), rangeHi: at('rangeHi'), fairPost: at('fairPost'), mktCap: at('mktCap'), niPost: at('niPost') } };
}
