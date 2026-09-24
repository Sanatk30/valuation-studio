import ExcelJS from 'exceljs';
import { CURRENCIES } from '../format.js';
import { projectOperations } from '../engine/drivers.js';
import { runRegression, allVars } from '../engine/regressionModel.js';
import { compsPeerRows } from '../engine/comps.js';
import { addCompsSheets, compsSheetNames } from './compsSheets.js';
import { addPrecedentSheets, precedentSheetNames } from './precedentSheets.js';
import { computePrecedent } from '../engine/precedent.js';
import { styleSheet, edge, colRun, makeFormats, C_RULE, C_TAB_ANALYSIS } from './xlsxUtil.js';
import { writeDcfSheet, writeDcfLower, writeWaccSheet } from './dcfSheets.js';

/*
 * Live-formula Excel export.
 * Conventions: blue font = input cell (edit these), black = formula,
 * green = cross-sheet link. The workbook recalculates on open.
 * Cell layouts mirror the JS engines exactly (interest on opening balances,
 * mid-year toggle, Hamada levering, PIK accrual, sweep waterfall with a cash
 * floor, IPO mechanics, OLS regression, etc.).
 */

const C_INPUT = 'FF1F4FD8';
const C_LINK = 'FF1E7A34';
const C_HDR_FILL = 'FF173A5E';
const C_HDR_TEXT = 'FFFFFFFF';
const C_SECTION_FILL = 'FFEAF1FA';
const C_GRID_FILL = 'FFF7FAFF';

function colL(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function put(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  c.value = value;
  if (o.fmt) c.numFmt = o.fmt;
  const font = { name: 'Calibri', size: o.size || 11 };
  if (o.bold) font.bold = true;
  if (o.italic) font.italic = true;
  if (o.color) font.color = { argb: o.color };
  c.font = font;
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  c.alignment = { vertical: 'middle', ...(o.align ? { horizontal: o.align } : {}) };
  if (o.wrap) c.alignment = { ...c.alignment, wrapText: true, vertical: 'top' };
  if (o.top || o.bottom) {
    c.border = { ...(c.border || {}) };
    if (o.top) c.border.top = { style: 'thin' };
    if (o.bottom) c.border.bottom = { style: o.bottom === 'double' ? 'double' : 'thin' };
  }
  return c;
}

/** A banner across `span` columns. Merged, so the title is never clipped by
 *  the filled (but non-empty) cells beside it. */
function sectionHeader(ws, row, text, span = 3) {
  for (let i = 1; i <= span; i++) put(ws, `${colL(i)}${row}`, i === 1 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
  if (span > 1) ws.mergeCells(`A${row}:${colL(span)}${row}`);
  ws.getRow(row).height = 18;
}

/** Sheets shipped per export method. Every method keeps Assumptions + the DCF
 *  sheet (it hosts the shared operating projection the others link to), plus
 *  the full 3-Statement model so each file is a complete standalone package.
 *  `main` names the method's own sheet (for the Cover contents line). */
export const EXPORT_METHODS = {
  full: { label: 'Valuation Model — All Methods', sheets: null },
  // Every method file carries ONLY the sheets its formulas truly reference:
  // Cover + Assumptions (the inputs) + DCF (it hosts the shared operating
  // projection) + the method sheet, and '3 Statement' only where a formula
  // links to it (NTM net income). `sheets` may be a function of the model.
  dcf: { label: 'DCF Analysis', main: 'DCF', sheets: ['Cover', 'Assumptions', 'DCF', 'WACC'] },
  ts: { label: '3-Statement Model', main: '3 Statement', sheets: ['Cover', 'Assumptions', 'DCF', '3 Statement'] },
  lbo: { label: 'LBO Analysis', main: 'LBO', sheets: ['Cover', 'Assumptions', 'DCF', 'LBO'] },
  comps: { label: 'Comparable Companies Analysis', main: 'Benchmarking 1', sheets: ['__comps__', 'Cover', 'Assumptions', 'DCF', '3 Statement'] },
  reg: {
    label: 'Regression Analysis', main: 'Regression',
    // the price bridge links to 3 Statement only when y = P/E (NTM net income)
    sheets: (a) => ['Cover', 'Assumptions', 'DCF', ...((a.regression?.yVar || 'evEbitda') === 'pe' ? ['3 Statement'] : []), 'Regression'],
  },
  precedent: { label: 'Precedent Transactions Analysis', main: 'Precedent', sheets: ['Cover', 'Assumptions', 'DCF', '__precedent__'] },
  ipo: { label: 'IPO Valuation', main: 'IPO', sheets: ['Cover', 'Assumptions', 'DCF', '3 Statement', 'IPO'] },
};

/** Fixed sheet names, reserved so a company sheet can never collide with one. */
export const RESERVED_SHEETS = ['Cover', 'Assumptions', 'DCF', 'WACC', '3 Statement', 'LBO', 'Precedent', 'Deal List', 'IPO', 'Regression', 'Summary'];

/** Resolve a method's sheet list, expanding the comps package to its real names. */
export const resolveSheets = (methodDef, a) => {
  const list = typeof methodDef.sheets === 'function' ? methodDef.sheets(a) : methodDef.sheets;
  return list && list.flatMap((s) => {
    if (s === '__comps__') return compsSheetNames(a, RESERVED_SHEETS);
    if (s === '__precedent__') return precedentSheetNames(a, computePrecedent(a), RESERVED_SHEETS);
    return [s];
  });
};

/**
 * Put the tabs in `order` first, everything else after, keeping relative order.
 * ExcelJS writes workbook.xml sorted by `orderNo`, so this sets the tab order
 * the file opens with — the benchmarking pages lead the comps package.
 */
function orderSheets(wb, order) {
  const rank = new Map();
  order.forEach((n, i) => { if (!rank.has(n)) rank.set(n, i); });
  const rest = wb.worksheets.filter((w) => !rank.has(w.name));
  rest.forEach((w, i) => rank.set(w.name, order.length + i));
  for (const ws of wb.worksheets) ws.orderNo = rank.get(ws.name);
}

export function buildWorkbook(a, method = 'full') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Valuation Studio';
  wb.calcProperties = { fullCalcOnLoad: true };

  const sym = CURRENCIES[a.settings.currency].symbol;
  const unit = a.settings.unit;
  const methodDef = EXPORT_METHODS[method] || EXPORT_METHODS.full;

  /* ================= Cover ================= */
  // Peer sheets are named after the companies, so reserve the fixed names first.
  const sheetNames = new Set(RESERVED_SHEETS);
  const cover = wb.addWorksheet('Cover');
  cover.getColumn(1).width = 3;
  cover.getColumn(2).width = 56;
  cover.getColumn(3).width = 40;
  styleSheet(cover, { tab: C_TAB_ANALYSIS, portrait: true });
  cover.getRow(3).height = 30;
  cover.getRow(4).height = 20;
  put(cover, 'B3', a.company.name || 'Company', { bold: true, size: 20 });
  put(cover, 'B4', methodDef.label, { size: 14, color: 'FF1F4FD8' });
  put(cover, 'B5', `(${sym} in ${unit}, ${a.drivers.years}-year projection)`, { italic: true, color: 'FF777777' });
  edge(cover, 6, colRun(2, 3), 'bottom', 'medium', C_HDR_FILL);
  put(cover, 'B7', `Prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Valuation Studio`, { color: 'FF999999' });
  put(cover, 'B9', 'Contents', { bold: true });
  put(cover, 'B10', 'Assumptions — every input (blue). Edit there and the whole file recalculates.', { color: 'FF555555' });
  put(cover, 'B11', 'DCF — the shared operating projection and free-cash-flow build all sheets link to.', { color: 'FF555555' });
  if (method === 'full') {
    put(cover, 'B12', '3 Statement · LBO · Comps · Regression · Precedent · IPO · Summary — one sheet per method.', { color: 'FF555555' });
  } else {
    const extras = resolveSheets(methodDef, a).filter((s) => !['Cover', 'Assumptions', 'DCF', methodDef.main].includes(s));
    // the comps package lists a sheet per company, so this line wraps rather
    // than running off the page
    put(cover, 'B12', `${methodDef.main} — the ${methodDef.label.toLowerCase()}, in full detail${extras.length ? `; ${extras.join(' · ')} — supporting linked statements` : ''}.`, { color: 'FF555555', wrap: true });
    cover.mergeCells('B12:C12');
    cover.getRow(12).height = Math.min(90, 15 * Math.ceil((60 + extras.join(' · ').length) / 92));
  }
  put(cover, 'B14', 'Conventions: blue = input · black = formula · green = cross-sheet link.', { italic: true, color: 'FF999999' });
  // One shared format table for the whole workbook — the comps pages need the
  // date / share / plain formats too, and a missing one exports as a raw
  // serial number (a date reading "45747") or an unformatted share count.
  const F = makeFormats(sym);

  const n = a.drivers.years;
  // derived per-year percentages — identical for fade, custom-array, and
  // per-year grid inputs (absolute entries become the equivalent %s)
  const opsX = projectOperations(a);
  const growth = opsX.growth;
  const margin = opsX.margin;
  const daPctArr = opsX.da.map((v, i) => v / opsX.revenue[i]);
  const capexPctArr = opsX.capex.map((v, i) => v / opsX.revenue[i]);
  const nwcPctArr = opsX.nwcBalance.map((v, i) => v / opsX.revenue[i]);
  const exitYearClamped = Math.min(Math.max(1, Math.round(a.lbo.exitYear)), n);
  // Year 0 (the LTM column on the DCF page) is the year before the projection starts
  const baseYear = (Number.isFinite(a.settings.period?.startYear) ? a.settings.period.startYear : new Date().getFullYear()) - 1;
  const R = {}; // absolute refs into the Assumptions sheet

  /* ================= Assumptions ================= */
  const asum = wb.addWorksheet('Assumptions');
  asum.getColumn(1).width = 38;
  asum.getColumn(2).width = 17;
  asum.getColumn(3).width = 52;
  styleSheet(asum, { freezeRow: 2, tab: C_TAB_ANALYSIS, printTitles: '1:2' });
  let r = 1;
  put(asum, `A${r}`, 'VALUATION STUDIO — ASSUMPTIONS', { bold: true, size: 14 });
  asum.getRow(r).height = 22;
  edge(asum, r, colRun(1, 3), 'bottom', 'medium', C_HDR_FILL);
  put(asum, `C${r}`, `All money figures in ${sym} ${unit}. Blue cells are inputs — edit them and the whole workbook recalculates.`, { italic: true, color: 'FF777777' });
  r += 2;

  const inp = (label, value, fmt, note = '', key = null) => {
    put(asum, `A${r}`, label);
    put(asum, `B${r}`, value, { fmt, color: C_INPUT, fill: 'FFF5F9FF' });
    if (note) put(asum, `C${r}`, note, { italic: true, color: 'FF999999' });
    if (key) R[key] = `Assumptions!$B$${r}`;
    r++;
  };
  const calc = (label, formula, fmt, note = '', key = null) => {
    put(asum, `A${r}`, label, { italic: true });
    put(asum, `B${r}`, { formula }, { fmt, bold: true });
    if (note) put(asum, `C${r}`, note, { italic: true, color: 'FF999999' });
    if (key) R[key] = `Assumptions!$B$${r}`;
    r++;
  };

  sectionHeader(asum, r++, 'COMPANY & MARKET');
  inp('Company name', a.company.name, undefined, '', 'name');
  inp(`Shares outstanding (${unit})`, a.company.sharesOut, F.num, 'Same unit scale as money figures', 'shares');
  inp('Current share price', a.company.currentPrice, F.price, 'Used for upside & premia analysis', 'curPrice');
  inp('Gross debt', a.company.grossDebt, F.money, '', 'grossDebt');
  inp('Cash & equivalents', a.company.cash, F.money, '', 'cash');
  calc('Net debt', `${R.grossDebt}-${R.cash}`, F.money, 'Gross debt less cash', 'netDebt');
  inp('Tax rate', a.company.taxRate / 100, F.pct, '', 'tax');
  r++;

  sectionHeader(asum, r++, 'OPERATING DRIVERS');
  inp('Base-year (LTM) revenue', a.drivers.revenue0, F.money, 'Year 0 revenue', 'rev0');
  put(asum, `A${r}`, 'Projection years'); put(asum, `B${r}`, n, { fmt: F.int }); put(asum, `C${r}`, 'Fixed at export — re-export from the app to change', { italic: true, color: 'FF999999' }); r++;
  inp('Base (LTM) year', baseYear, F.int, 'Year 0 — the LTM column on the DCF page', 'baseYear');
  inp('Year-0 NWC (% of base revenue)', a.drivers.nwcPct / 100, F.pct, 'Anchors Year-1 change in NWC', 'nwcPct');
  put(asum, `A${r}`, 'Growth, margin, D&A, capex, NWC by year', { italic: true }); put(asum, `C${r}`, 'Per-year inputs on the DCF sheet (blue rows)', { italic: true, color: 'FF999999' }); r += 2;

  sectionHeader(asum, r++, 'COST OF CAPITAL (CAPM + HAMADA)');
  inp('Risk-free rate', a.wacc.riskFree / 100, F.pct, '10Y government yield', 'rf');
  inp('Equity risk premium', a.wacc.erp / 100, F.pct, '', 'erp');
  inp('Debt weight D/(D+E)', a.wacc.debtWeight / 100, F.pct, 'Target capital structure', 'wd');
  calc('Target D/E', `${R.wd}/(1-${R.wd})`, F.num3, '', 'de');
  if (a.wacc.betaMode === 'hamada') {
    inp('Unlevered (asset) beta βU', a.wacc.unleveredBeta, F.num3, 'Input — relevered below', 'bu');
    calc('Levered beta βL (Hamada)', `${R.bu}*(1+(1-${R.tax})*${R.de})`, F.num3, 'βL = βU × (1 + (1−t) × D/E)', 'beta');
  } else {
    inp('Levered beta βL', a.wacc.beta, F.num3, 'Direct input', 'beta');
    calc('Unlevered (asset) beta βU', `${R.beta}/(1+(1-${R.tax})*${R.de})`, F.num3, 'Hamada inverse', 'bu');
  }
  inp('Size / alpha premium', a.wacc.sizePremium / 100, F.pct, '', 'sizePrem');
  calc('Cost of equity (CAPM)', `${R.rf}+${R.beta}*${R.erp}+${R.sizePrem}`, F.pct2, 'rf + βL × ERP + premium', 'coe');
  inp('Pre-tax cost of debt', a.wacc.costDebt / 100, F.pct, '', 'kd');
  calc('After-tax cost of debt', `${R.kd}*(1-${R.tax})`, F.pct2, '', 'katd');
  calc('WACC', `(1-${R.wd})*${R.coe}+${R.wd}*${R.katd}`, F.pct2, '', 'wacc');
  r++;

  sectionHeader(asum, r++, 'DCF');
  inp('Terminal growth rate', a.dcf.terminalGrowth / 100, F.pct, 'Gordon growth, must be < WACC and CoE', 'tg');
  inp('Exit EV/EBITDA multiple (FCFF)', a.dcf.exitMultiple, F.x, '', 'dcfExitX');
  inp('Exit P/E multiple (FCFE)', a.dcf.exitPE, F.x, '', 'dcfExitPE');
  inp('Mid-year convention (TRUE/FALSE)', a.dcf.midYear, undefined, 'Discount at t-0.5 when TRUE', 'midYear');
  r++;

  sectionHeader(asum, r++, 'THREE-STATEMENT / FCFE FINANCING');
  inp('Interest rate on debt', a.ts.interestRateDebt / 100, F.pct, 'On opening balance (no circularity); also the FCFE schedule', 'intDebt');
  inp('Interest earned on cash', a.ts.interestRateCash / 100, F.pct, 'On opening balance', 'intCash');
  inp('Mandatory debt repayment (% opening)', a.ts.debtRepayPct / 100, F.pct, 'Negative net borrowing in FCFE', 'repayPct');
  inp('Dividend payout (% of net income)', a.ts.dividendPayout / 100, F.pct, '', 'payout');
  inp('Opening net PP&E', a.ts.startingPPE, F.money, '', 'ppe0');
  r++;

  sectionHeader(asum, r++, 'LBO');
  inp('Entry EV/EBITDA', a.lbo.entryMultiple, F.x, 'On LTM EBITDA', 'entryX');
  inp('Exit EV/EBITDA', a.lbo.exitMultiple, F.x, '', 'lboExitX');
  inp('Exit year', exitYearClamped, F.int, `1 to ${n}`, 'exitYear');
  inp('Senior debt (x LTM EBITDA)', a.lbo.seniorX, F.x, '', 'seniorX');
  inp('Senior interest rate', a.lbo.seniorRate / 100, F.pct, '', 'seniorRate');
  inp('Senior amortization (% of original p.a.)', a.lbo.seniorAmort / 100, F.pct, '', 'seniorAmort');
  inp('Mezzanine debt (x LTM EBITDA)', a.lbo.mezzX, F.x, '', 'mezzX');
  inp('Mezzanine interest rate', a.lbo.mezzRate / 100, F.pct, '', 'mezzRate');
  inp('Mezzanine PIK (TRUE/FALSE)', a.lbo.mezzPIK, undefined, 'PIK interest accretes to the balance', 'mezzPIK');
  inp('Transaction fees (% of EV)', a.lbo.feesPctEV / 100, F.pct, 'Added to uses', 'feesPct');
  inp('Financing fees (% of total debt)', a.lbo.finFeesPct / 100, F.pct, 'Capitalized; amortized over the hold', 'finFeesPct');
  inp('Minimum operating cash', a.lbo.minCash, F.money, 'Sweep never drains below this floor', 'minCash');
  inp('Cash sweep (% of FCF after amortization)', a.lbo.sweepPct / 100, F.pct, 'Senior first, then cash-pay mezz', 'sweepPct');
  inp('IRR hurdle (LBO floor pricing)', a.lbo.hurdleRate / 100, F.pct, 'Max affordable price valuation', 'hurdle');
  r++;

  sectionHeader(asum, r++, 'IPO');
  inp('Pricing basis ("pe" or "evEbitda")', a.ipo.basis, undefined, 'P/E on NTM NI, or EV/EBITDA on NTM EBITDA', 'ipoBasis');
  inp('Offer P/E', a.ipo.offerPE, F.x, '', 'offerPE');
  inp('Offer EV/EBITDA', a.ipo.offerEvEbitda, F.x, '', 'offerEvE');
  inp('IPO discount to fair value', a.ipo.ipoDiscount / 100, F.pct, 'Left on the table for the bookbuild', 'ipoDisc');
  inp('Primary raise (fresh capital)', a.ipo.primaryRaise, F.money, '', 'ipoRaise');
  inp('Secondary sale (% of existing shares)', a.ipo.secondaryPct / 100, F.pct, 'No company proceeds', 'ipoSec');
  inp('Greenshoe (% of base deal)', a.ipo.greenshoePct / 100, F.pct, 'Assumed primary & exercised', 'ipoGS');
  inp('Underwriting fees (% of gross primary)', a.ipo.feesPct / 100, F.pct, '', 'ipoFees');
  inp('Proceeds to debt repayment', a.ipo.useProceedsDebtPct / 100, F.pct, 'Rest builds cash', 'ipoUse');
  inp('Bookbuild band below offer', a.ipo.rangeBand / 100, F.pct, 'Low end of the range', 'ipoBand');

  /* ================= DCF & WACC sheets =================
     Both pages are written by excel/dcfSheets.js in the 3E layout: historical
     back-cast + LTM + projection with CAGR columns, the unlevered FCF build,
     side-by-side output blocks, the assumptions block the model reads from,
     2-up sensitivity grids, and the levered (FCFE) build beneath. */
  const dcfWs = wb.addWorksheet('DCF');
  const waccWs = wb.addWorksheet('WACC');
  const dcfNote = `(${sym} in ${unit}, fiscal year ending ${new Date(Date.UTC(2000, (a.settings.period?.fyEndMonth ?? 12) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })})`;
  const P = writeDcfSheet(dcfWs, a, F, R, { unitNote: dcfNote, waccRef: R.wacc, coeRef: R.coe, ops: opsX });
  const D = P.D;
  const dyc = P.yc;                                    // DCF page projection columns
  const ltmC = P.ltm;                                  // DCF page LTM (Year 0) column
  // The 3-Statement, LBO and Returns sheets keep their own C.. year grid; only
  // the DCF page carries the historical / LTM columns in front of the projection.
  const yc = (i) => colL(3 + i);
  const lastC = yc(n - 1);
  const lower = writeDcfLower(dcfWs, a, F, R, P, { waccRef: R.wacc, coeRef: R.coe });
  const LF = lower.L;                                  // levered (FCFE) row map
  writeWaccSheet(waccWs, a, F, R, { unitNote: `(${sym} in ${unit})` });

  const dcfRefs = { ...P.dcfRefs, ...lower.fcfeRefs };
  const gridGordonRange = lower.grids.gordon;
  const gridExitRange = lower.grids.exit;
  const gridFcfeRange = lower.grids.fcfe;

  /** Banner over a sensitivity grid (used by the LBO sheet). */
  const gridStart = (ws, row, title, span = 6) => {
    put(ws, `A${row}`, title, { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
    for (let i = 1; i < span; i++) put(ws, `${colL(1 + i)}${row}`, '', { fill: C_HDR_FILL });
    ws.mergeCells(`A${row}:${colL(span)}${row}`);
    ws.getRow(row).height = 18;
    return row + 1;
  };

  /* ================= 3 Statement sheet ================= */
  const ts = wb.addWorksheet('3 Statement');
  ts.getColumn(1).width = 34;
  ts.getColumn(2).width = 14;
  for (let i = 0; i < n; i++) ts.getColumn(3 + i).width = 14;
  styleSheet(ts, { freezeRow: 3, freezeCol: 2, tab: C_TAB_ANALYSIS, printTitles: '1:3' });
  let tr = 1;
  put(ts, `A${tr}`, 'THREE-STATEMENT MODEL', { bold: true, size: 14 });
  put(ts, `D${tr}`, 'Interest on opening balances — no circular references', { italic: true, color: 'FF777777' });
  ts.getRow(tr).height = 22;
  edge(ts, tr, colRun(1, 2 + n), 'bottom', 'medium', C_HDR_FILL);
  tr += 2;
  put(ts, `B${tr}`, 0, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  for (let i = 0; i < n; i++) put(ts, `${yc(i)}${tr}`, i + 1, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  edge(ts, tr, colRun(1, 2 + n), 'bottom', 'thin', C_RULE);
  tr++;

  const T = {};
  const tLine = (key, label, opts = {}) => { T[key] = tr; put(ts, `A${tr}`, label, opts); tr++; };
  const fillYears = (key, fmla, fmt, opts = {}) => {
    for (let i = 0; i < n; i++) put(ts, `${yc(i)}${T[key]}`, { formula: fmla(i) }, { fmt, ...opts });
  };

  sectionHeader(ts, tr++, 'INCOME STATEMENT', 2 + n);
  tLine('rev', 'Revenue', { bold: true });
  fillYears('rev', (i) => `DCF!${dyc(i)}${D.sales}`, F.money, { color: C_LINK, bold: true });
  tLine('ebitda', 'EBITDA');
  fillYears('ebitda', (i) => `DCF!${dyc(i)}${D.ebitda}`, F.money, { color: C_LINK });
  tLine('da', 'Less: D&A');
  fillYears('da', (i) => `-DCF!${dyc(i)}${D.da}`, F.money, { color: C_LINK });
  tLine('ebit', 'EBIT', { bold: true });
  fillYears('ebit', (i) => `${yc(i)}${T.ebitda}+${yc(i)}${T.da}`, F.money, { bold: true });
  tLine('intExp', 'Less: Interest expense');
  tLine('intInc', 'Add: Interest income');
  tLine('ebt', 'Pre-tax income');
  tLine('tax', 'Less: Tax');
  tLine('ni', 'Net income', { bold: true });
  tr++;

  sectionHeader(ts, tr++, 'CASH FLOW STATEMENT', 2 + n);
  tLine('cfo', 'Cash from operations (NI + D&A - dNWC)');
  tLine('cfi', 'Cash from investing (capex)');
  tLine('div', 'Less: Dividends');
  tLine('repay', 'Less: Debt repayment');
  tLine('cff', 'Cash from financing');
  tLine('dCash', 'Net change in cash', { bold: true });
  tr++;

  sectionHeader(ts, tr++, 'BALANCE SHEET', 2 + n);
  tLine('cash', 'Cash & equivalents');
  tLine('nwc', 'Net working capital');
  tLine('ppe', 'Net PP&E');
  tLine('assets', 'Total assets', { bold: true });
  tLine('debt', 'Total debt');
  tLine('equity', "Shareholders' equity");
  tLine('liabEq', 'Total debt + equity', { bold: true });
  tLine('check', 'Balance check (must be 0)', { italic: true });
  tr++;

  sectionHeader(ts, tr++, 'DEBT & CASH SCHEDULE', 2 + n);
  tLine('schedRepay', 'Mandatory repayment');
  tLine('schedDebt', 'Closing debt');
  tLine('schedCash', 'Closing cash');

  put(ts, `B${T.schedDebt}`, { formula: R.grossDebt }, { fmt: F.money, color: C_LINK });
  put(ts, `B${T.schedCash}`, { formula: R.cash }, { fmt: F.money, color: C_LINK });
  for (let i = 0; i < n; i++) {
    const pD = i === 0 ? `B${T.schedDebt}` : `${yc(i - 1)}${T.schedDebt}`;
    const pC = i === 0 ? `B${T.schedCash}` : `${yc(i - 1)}${T.schedCash}`;
    put(ts, `${yc(i)}${T.schedRepay}`, { formula: `${pD}*${R.repayPct}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.schedDebt}`, { formula: `${pD}-${yc(i)}${T.schedRepay}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.schedCash}`, { formula: `${pC}+${yc(i)}${T.dCash}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.intExp}`, { formula: `-${pD}*${R.intDebt}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.intInc}`, { formula: `${pC}*${R.intCash}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.ebt}`, { formula: `${yc(i)}${T.ebit}+${yc(i)}${T.intExp}+${yc(i)}${T.intInc}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.tax}`, { formula: `-MAX(0,${yc(i)}${T.ebt})*${R.tax}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.ni}`, { formula: `${yc(i)}${T.ebt}+${yc(i)}${T.tax}` }, { fmt: F.money, bold: true, top: true });
    put(ts, `${yc(i)}${T.cfo}`, { formula: `${yc(i)}${T.ni}+DCF!${dyc(i)}${D.da}+DCF!${dyc(i)}${D.dnwc}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.cfi}`, { formula: `DCF!${dyc(i)}${D.capex}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.div}`, { formula: `-MAX(0,${yc(i)}${T.ni})*${R.payout}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.repay}`, { formula: `-${yc(i)}${T.schedRepay}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.cff}`, { formula: `${yc(i)}${T.div}+${yc(i)}${T.repay}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.dCash}`, { formula: `${yc(i)}${T.cfo}+${yc(i)}${T.cfi}+${yc(i)}${T.cff}` }, { fmt: F.money, bold: true, top: true });
    put(ts, `${yc(i)}${T.cash}`, { formula: `${yc(i)}${T.schedCash}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.nwc}`, { formula: `DCF!${dyc(i)}${D.nwc}` }, { fmt: F.money, color: C_LINK });
    put(ts, `${yc(i)}${T.debt}`, { formula: `${yc(i)}${T.schedDebt}` }, { fmt: F.money });
  }
  put(ts, `B${T.cash}`, { formula: R.cash }, { fmt: F.money, color: C_LINK });
  put(ts, `B${T.nwc}`, { formula: `DCF!${ltmC}${D.nwc}` }, { fmt: F.money, color: C_LINK });
  put(ts, `B${T.ppe}`, { formula: R.ppe0 }, { fmt: F.money, color: C_LINK });
  put(ts, `B${T.debt}`, { formula: R.grossDebt }, { fmt: F.money, color: C_LINK });
  put(ts, `B${T.equity}`, { formula: `B${T.cash}+B${T.nwc}+B${T.ppe}-B${T.debt}` }, { fmt: F.money });
  put(ts, `B${T.assets}`, { formula: `B${T.cash}+B${T.nwc}+B${T.ppe}` }, { fmt: F.money, bold: true, top: true });
  put(ts, `B${T.liabEq}`, { formula: `B${T.debt}+B${T.equity}` }, { fmt: F.money, bold: true, top: true });
  put(ts, `B${T.check}`, { formula: `B${T.assets}-B${T.liabEq}` }, { fmt: F.num, italic: true });
  for (let i = 0; i < n; i++) {
    const pE = i === 0 ? `B${T.equity}` : `${yc(i - 1)}${T.equity}`;
    const pP = i === 0 ? `B${T.ppe}` : `${yc(i - 1)}${T.ppe}`;
    put(ts, `${yc(i)}${T.ppe}`, { formula: `${pP}-DCF!${dyc(i)}${D.capex}-DCF!${dyc(i)}${D.da}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.equity}`, { formula: `${pE}+${yc(i)}${T.ni}+${yc(i)}${T.div}` }, { fmt: F.money });
    put(ts, `${yc(i)}${T.assets}`, { formula: `${yc(i)}${T.cash}+${yc(i)}${T.nwc}+${yc(i)}${T.ppe}` }, { fmt: F.money, bold: true, top: true });
    put(ts, `${yc(i)}${T.liabEq}`, { formula: `${yc(i)}${T.debt}+${yc(i)}${T.equity}` }, { fmt: F.money, bold: true, top: true });
    put(ts, `${yc(i)}${T.check}`, { formula: `${yc(i)}${T.assets}-${yc(i)}${T.liabEq}` }, { fmt: F.num, italic: true });
  }
  tr++;
  sectionHeader(ts, tr++, 'RATIO ANALYSIS', 2 + n);
  const prevCol = (i, key) => (i === 0 ? `B${T[key]}` : `${yc(i - 1)}${T[key]}`);
  tLine('rGrow', 'Revenue growth %');
  fillYears('rGrow', (i) => `${yc(i)}${T.rev}/${prevCol(i, 'rev')}-1`, F.pct);
  put(ts, `B${T.rev}`, { formula: R.rev0 }, { fmt: F.money, color: C_LINK }); // year-0 revenue anchors growth & the ratios below
  tLine('rEbM', 'EBITDA margin');
  fillYears('rEbM', (i) => `${yc(i)}${T.ebitda}/${yc(i)}${T.rev}`, F.pct);
  tLine('rNetM', 'Net margin');
  fillYears('rNetM', (i) => `${yc(i)}${T.ni}/${yc(i)}${T.rev}`, F.pct);
  tLine('rRoe', 'Return on avg equity (ROE)');
  fillYears('rRoe', (i) => `${yc(i)}${T.ni}/AVERAGE(${prevCol(i, 'equity')},${yc(i)}${T.equity})`, F.pct);
  tLine('rRoa', 'Return on avg assets (ROA)');
  fillYears('rRoa', (i) => `${yc(i)}${T.ni}/AVERAGE(${prevCol(i, 'assets')},${yc(i)}${T.assets})`, F.pct);
  tLine('rNdE', 'Net debt / EBITDA');
  fillYears('rNdE', (i) => `(${yc(i)}${T.debt}-${yc(i)}${T.cash})/${yc(i)}${T.ebitda}`, F.x2);
  tLine('rCov', 'Interest coverage (EBIT / interest)');
  fillYears('rCov', (i) => `IF(${yc(i)}${T.intExp}=0,0,${yc(i)}${T.ebit}/-${yc(i)}${T.intExp})`, F.x2);
  tLine('rFcf', 'FCFF / EBITDA (cash conversion)');
  fillYears('rFcf', (i) => `DCF!${dyc(i)}${D.fcff}/${yc(i)}${T.ebitda}`, F.pct);
  tLine('rPay', 'Dividend payout');
  fillYears('rPay', (i) => `IF(${yc(i)}${T.ni}=0,0,-${yc(i)}${T.div}/${yc(i)}${T.ni})`, F.pct);

  const tsRefs = { ni1: `'3 Statement'!$${yc(0)}$${T.ni}` };

  /* ================= LBO sheet ================= */
  const lbo = wb.addWorksheet('LBO');
  lbo.getColumn(1).width = 36;
  lbo.getColumn(2).width = 14;
  for (let i = 0; i < n; i++) lbo.getColumn(3 + i).width = 13;
  styleSheet(lbo, { freezeRow: 1, freezeCol: 2, tab: C_TAB_ANALYSIS, printTitles: '1:1' });
  let lr = 1;
  put(lbo, `A${lr}`, 'LEVERAGED BUYOUT', { bold: true, size: 14 });
  lr += 2;

  sectionHeader(lbo, lr++, 'SOURCES & USES');
  const L = {};
  const lVal = (key, label, formula, fmt, opts = {}) => {
    L[key] = lr;
    put(lbo, `A${lr}`, label, opts);
    put(lbo, `B${lr}`, { formula }, { fmt, ...opts });
    lr++;
  };
  lVal('ebitda0', 'LTM EBITDA', `DCF!${ltmC}${D.ebitda}`, F.money, { color: C_LINK });
  lVal('entryEV', 'Entry enterprise value', `${R.entryX}*B${L.ebitda0}`, F.money, { bold: true });
  lVal('feesTxn', 'Transaction fees', `B${L.entryEV}*${R.feesPct}`, F.money);
  lVal('senior0', 'Senior debt', `${R.seniorX}*B${L.ebitda0}`, F.money);
  lVal('mezz0', 'Mezzanine debt', `${R.mezzX}*B${L.ebitda0}`, F.money);
  lVal('debt0', 'Total debt', `B${L.senior0}+B${L.mezz0}`, F.money, { bold: true });
  lVal('feesFin', 'Financing fees', `B${L.debt0}*${R.finFeesPct}`, F.money);
  lVal('uses', 'Total uses', `B${L.entryEV}+B${L.feesTxn}+B${L.feesFin}`, F.money, { bold: true, top: true });
  lVal('equity0', 'Sponsor equity (plug)', `B${L.uses}-B${L.debt0}`, F.money, { bold: true, top: true });
  lVal('levX', 'Leverage (Debt / LTM EBITDA)', `B${L.debt0}/B${L.ebitda0}`, F.x2, { italic: true });
  lVal('feeAmort', 'Financing-fee amortization p.a.', `B${L.feesFin}/${R.exitYear}`, F.money, { italic: true });
  lr++;

  sectionHeader(lbo, lr++, 'DEBT SCHEDULE & FREE CASH FLOW', 2 + n);
  const lHdr = lr;
  put(lbo, `B${lr}`, 0, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  for (let i = 0; i < n; i++) put(lbo, `${yc(i)}${lr}`, i + 1, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  lr++;
  const lLine = (key, label, opts = {}) => { L[key] = lr; put(lbo, `A${lr}`, label, opts); lr++; };
  lLine('ebitda', 'EBITDA', { bold: true });
  lLine('da', 'Less: D&A');
  lLine('cashInt', 'Less: Cash interest');
  lLine('pik', 'Less: PIK accrual (non-cash)');
  lLine('amort', 'Less: Financing-fee amortization (non-cash)');
  lLine('ebt', 'Pre-tax income');
  lLine('tax', 'Less: Tax');
  lLine('ni', 'Net income');
  lLine('capex', 'Less: Capex');
  lLine('dnwc', 'Less: Increase in NWC');
  lLine('fcf', 'Free cash flow', { bold: true });
  lLine('mand', 'Mandatory senior amortization');
  lLine('sweepCap', 'Sweep capacity (after cash floor)', { italic: true });
  lLine('sweepS', 'Cash sweep — to senior');
  lLine('sweepM', 'Cash sweep — to mezzanine');
  lLine('closeS', 'Closing senior debt');
  lLine('closeM', 'Closing mezzanine debt');
  lLine('cashB', 'Cash balance');
  lLine('netDebt', 'Net debt', { bold: true });
  lLine('levG', 'Gross leverage (Debt/EBITDA)', { italic: true });
  lLine('cov', 'Cash interest coverage', { italic: true });

  put(lbo, `B${L.closeS}`, { formula: `B${L.senior0}` }, { fmt: F.money });
  put(lbo, `B${L.closeM}`, { formula: `B${L.mezz0}` }, { fmt: F.money });
  put(lbo, `B${L.cashB}`, 0, { fmt: F.money });
  put(lbo, `B${L.netDebt}`, { formula: `B${L.closeS}+B${L.closeM}-B${L.cashB}` }, { fmt: F.money, bold: true });
  for (let i = 0; i < n; i++) {
    const c = yc(i);
    const pS = i === 0 ? `B${L.closeS}` : `${yc(i - 1)}${L.closeS}`;
    const pM = i === 0 ? `B${L.closeM}` : `${yc(i - 1)}${L.closeM}`;
    const pC = i === 0 ? `B${L.cashB}` : `${yc(i - 1)}${L.cashB}`;
    put(lbo, `${c}${L.ebitda}`, { formula: `DCF!${dyc(i)}${D.ebitda}` }, { fmt: F.money, color: C_LINK, bold: true });
    put(lbo, `${c}${L.da}`, { formula: `-DCF!${dyc(i)}${D.da}` }, { fmt: F.money, color: C_LINK });
    put(lbo, `${c}${L.cashInt}`, { formula: `-(${pS}*${R.seniorRate}+IF(${R.mezzPIK},0,${pM}*${R.mezzRate}))` }, { fmt: F.money });
    put(lbo, `${c}${L.pik}`, { formula: `-IF(${R.mezzPIK},${pM}*${R.mezzRate},0)` }, { fmt: F.money });
    put(lbo, `${c}${L.amort}`, { formula: `-IF(${c}$${lHdr}<=${R.exitYear},$B$${L.feeAmort},0)` }, { fmt: F.money });
    put(lbo, `${c}${L.ebt}`, { formula: `${c}${L.ebitda}+${c}${L.da}+${c}${L.cashInt}+${c}${L.pik}+${c}${L.amort}` }, { fmt: F.money });
    put(lbo, `${c}${L.tax}`, { formula: `-MAX(0,${c}${L.ebt})*${R.tax}` }, { fmt: F.money });
    put(lbo, `${c}${L.ni}`, { formula: `${c}${L.ebt}+${c}${L.tax}` }, { fmt: F.money });
    put(lbo, `${c}${L.capex}`, { formula: `DCF!${dyc(i)}${D.capex}` }, { fmt: F.money, color: C_LINK });
    put(lbo, `${c}${L.dnwc}`, { formula: `DCF!${dyc(i)}${D.dnwc}` }, { fmt: F.money, color: C_LINK });
    // add back the non-cash charges (da/pik/amort rows hold negatives)
    put(lbo, `${c}${L.fcf}`, { formula: `${c}${L.ni}-${c}${L.da}-${c}${L.pik}-${c}${L.amort}+${c}${L.capex}+${c}${L.dnwc}` }, { fmt: F.money, bold: true, top: true });
    put(lbo, `${c}${L.mand}`, { formula: `MIN(${pS},$B$${L.senior0}*${R.seniorAmort})` }, { fmt: F.money });
    put(lbo, `${c}${L.sweepCap}`, { formula: `MIN(MAX(0,${c}${L.fcf}-${c}${L.mand})*${R.sweepPct},MAX(0,${pC}+${c}${L.fcf}-${c}${L.mand}-${R.minCash}))` }, { fmt: F.money, italic: true });
    put(lbo, `${c}${L.sweepS}`, { formula: `MIN(${pS}-${c}${L.mand},${c}${L.sweepCap})` }, { fmt: F.money });
    put(lbo, `${c}${L.sweepM}`, { formula: `IF(${R.mezzPIK},0,MIN(${pM},${c}${L.sweepCap}-${c}${L.sweepS}))` }, { fmt: F.money });
    put(lbo, `${c}${L.closeS}`, { formula: `${pS}-${c}${L.mand}-${c}${L.sweepS}` }, { fmt: F.money });
    put(lbo, `${c}${L.closeM}`, { formula: `${pM}-${c}${L.pik}-${c}${L.sweepM}` }, { fmt: F.money });
    put(lbo, `${c}${L.cashB}`, { formula: `${pC}+${c}${L.fcf}-${c}${L.mand}-${c}${L.sweepS}-${c}${L.sweepM}` }, { fmt: F.money });
    put(lbo, `${c}${L.netDebt}`, { formula: `${c}${L.closeS}+${c}${L.closeM}-${c}${L.cashB}` }, { fmt: F.money, bold: true, top: true });
    put(lbo, `${c}${L.levG}`, { formula: `(${c}${L.closeS}+${c}${L.closeM})/${c}${L.ebitda}` }, { fmt: F.x2, italic: true });
    put(lbo, `${c}${L.cov}`, { formula: `IF(${c}${L.cashInt}=0,"n/m",${c}${L.ebitda}/-${c}${L.cashInt})` }, { fmt: F.x2, italic: true });
  }
  lr++;

  sectionHeader(lbo, lr++, 'EXIT & RETURNS');
  const ebRange = `${yc(0)}${L.ebitda}:${lastC}${L.ebitda}`;
  const ndRange = `${yc(0)}${L.netDebt}:${lastC}${L.netDebt}`;
  lVal('exitEbitda', 'Exit-year EBITDA', `INDEX(${ebRange},1,${R.exitYear})`, F.money);
  lVal('exitEV', 'Exit enterprise value', `${R.lboExitX}*B${L.exitEbitda}`, F.money, { bold: true });
  lVal('exitND', 'Net debt at exit', `INDEX(${ndRange},1,${R.exitYear})`, F.money);
  lVal('exitEq', 'Exit equity value', `B${L.exitEV}-B${L.exitND}`, F.money, { bold: true, top: true });
  lVal('moic', 'MOIC', `B${L.exitEq}/B${L.equity0}`, F.x2, { bold: true });
  lVal('irrAlg', 'IRR (no interim distributions)', `B${L.moic}^(1/${R.exitYear})-1`, F.pct2, { bold: true });
  L.eqCf = lr;
  put(lbo, `A${lr}`, 'Sponsor equity cash flow', { italic: true });
  put(lbo, `B${lr}`, { formula: `-B${L.equity0}` }, { fmt: F.money, italic: true });
  for (let i = 0; i < n; i++) put(lbo, `${yc(i)}${lr}`, { formula: `IF(${yc(i)}$${lHdr}=${R.exitYear},$B$${L.exitEq},0)` }, { fmt: F.money, italic: true });
  lr++;
  lVal('irrXl', 'IRR (Excel IRR on equity CF)', `IRR(B${L.eqCf}:${lastC}${L.eqCf})`, F.pct2, { italic: true });
  lr++;

  sectionHeader(lbo, lr++, 'VALUE CREATION BRIDGE');
  lVal('vcEntry', 'Entry equity', `B${L.equity0}`, F.money, { bold: true });
  lVal('vcFees', 'Less: Fees (txn + financing)', `-(B${L.feesTxn}+B${L.feesFin})`, F.money);
  lVal('vcGrowth', 'EBITDA growth x entry multiple', `(B${L.exitEbitda}-B${L.ebitda0})*${R.entryX}`, F.money);
  lVal('vcMult', 'Multiple change x exit EBITDA', `(${R.lboExitX}-${R.entryX})*B${L.exitEbitda}`, F.money);
  lVal('vcDelev', 'Deleveraging (entry debt - exit net debt)', `B${L.debt0}-B${L.exitND}`, F.money);
  lVal('vcExit', 'Exit equity (check)', `B${L.vcEntry}+B${L.vcFees}+B${L.vcGrowth}+B${L.vcMult}+B${L.vcDelev}`, F.money, { bold: true, top: true });
  lr++;

  sectionHeader(lbo, lr++, 'LBO FLOOR — MAX PRICE AT THE HURDLE IRR');
  lVal('eq0Req', 'Required entry equity (= exit eq / (1+h)^n)', `B${L.exitEq}/(1+${R.hurdle})^${R.exitYear}`, F.money);
  lVal('evMax', 'Max entry enterprise value', `(B${L.eq0Req}+B${L.debt0}-B${L.feesFin})/(1+${R.feesPct})`, F.money, { bold: true });
  lVal('floorX', 'Implied max entry multiple', `B${L.evMax}/B${L.ebitda0}`, F.x2, { italic: true });
  lVal('floorPx', 'Implied max offer price per share', `(B${L.evMax}-${R.netDebt})/${R.shares}`, F.price, { bold: true });
  lr++;

  // Returns analysis: exit the base schedule at ANY year
  sectionHeader(lbo, lr++, 'RETURNS ANALYSIS — IF EXITED EACH YEAR', 2 + n);
  const retHdr = lr;
  put(lbo, `B${lr}`, '', { fill: C_SECTION_FILL });
  for (let i = 0; i < n; i++) put(lbo, `${yc(i)}${lr}`, i + 1, { fmt: F.year, bold: true, align: 'center', fill: C_SECTION_FILL });
  lr++;
  lLine('retEV', 'Exit EV (exit multiple x EBITDA)');
  lLine('retEq', 'Exit equity (EV - net debt)', { bold: true });
  lLine('retMoic', 'MOIC', { bold: true });
  lLine('retIrr', 'IRR (no interim distributions)', { bold: true });
  for (let i = 0; i < n; i++) {
    const c = yc(i);
    put(lbo, `${c}${L.retEV}`, { formula: `${R.lboExitX}*${c}${L.ebitda}` }, { fmt: F.money });
    put(lbo, `${c}${L.retEq}`, { formula: `${c}${L.retEV}-${c}${L.netDebt}` }, { fmt: F.money, bold: true });
    put(lbo, `${c}${L.retMoic}`, { formula: `${c}${L.retEq}/$B$${L.equity0}` }, { fmt: F.x2, bold: true });
    put(lbo, `${c}${L.retIrr}`, { formula: `IF(${c}${L.retMoic}<=0,0,${c}${L.retMoic}^(1/${c}$${retHdr})-1)` }, { fmt: F.pct, bold: true });
  }
  lr++;

  // Sensitivity 1: entry x exit
  lr = gridStart(lbo, lr, 'SENSITIVITY — IRR: ENTRY (rows) x EXIT MULTIPLE (cols)');
  let lTop = lr;
  const xOff = [-1, -0.5, 0, 0.5, 1];
  put(lbo, `A${lTop}`, 'Entry \\ Exit', { italic: true, align: 'center', fill: C_SECTION_FILL });
  xOff.forEach((o, j) => put(lbo, `${colL(2 + j)}${lTop}`, { formula: `${R.lboExitX}+${o}` }, { fmt: F.x, bold: true, align: 'center', fill: C_SECTION_FILL }));
  xOff.forEach((o, i) => {
    const rr = lTop + 1 + i;
    put(lbo, `A${rr}`, { formula: `${R.entryX}+${o}` }, { fmt: F.x, bold: true, fill: C_SECTION_FILL });
    xOff.forEach((_, j) => {
      const enRef = `$A${rr}`, exRef = `${colL(2 + j)}$${lTop}`;
      put(lbo, `${colL(2 + j)}${rr}`, {
        formula: `((${exRef}*$B$${L.exitEbitda}-$B$${L.exitND})/(${enRef}*$B$${L.ebitda0}*(1+${R.feesPct})+$B$${L.feesFin}-$B$${L.debt0}))^(1/${R.exitYear})-1`,
      }, { fmt: F.pct, fill: C_GRID_FILL });
    });
  });
  lr = lTop + 7;

  // Sensitivity 2: holding period x exit (exits the base schedule at year y)
  lr = gridStart(lbo, lr, 'SENSITIVITY — IRR: HOLDING PERIOD (rows) x EXIT MULTIPLE (cols)');
  lTop = lr;
  put(lbo, `A${lTop}`, 'Hold \\ Exit', { italic: true, align: 'center', fill: C_SECTION_FILL });
  xOff.forEach((o, j) => put(lbo, `${colL(2 + j)}${lTop}`, { formula: `${R.lboExitX}+${o}` }, { fmt: F.x, bold: true, align: 'center', fill: C_SECTION_FILL }));
  const holdYears = [];
  for (let y = Math.max(1, exitYearClamped - 2); y <= Math.min(n, exitYearClamped + 2) && holdYears.length < 5; y++) holdYears.push(y);
  holdYears.forEach((y, i) => {
    const rr = lTop + 1 + i;
    put(lbo, `A${rr}`, y, { fmt: '0"y"', bold: true, fill: C_SECTION_FILL });
    xOff.forEach((_, j) => {
      const exRef = `${colL(2 + j)}$${lTop}`;
      put(lbo, `${colL(2 + j)}${rr}`, {
        formula: `((${exRef}*INDEX($${yc(0)}$${L.ebitda}:$${lastC}$${L.ebitda},1,$A${rr})-INDEX($${yc(0)}$${L.netDebt}:$${lastC}$${L.netDebt},1,$A${rr}))/$B$${L.equity0})^(1/$A${rr})-1`,
      }, { fmt: F.pct, fill: C_GRID_FILL });
    });
  });
  const lboRefs = { irr: `LBO!$B$${L.irrAlg}`, moic: `LBO!$B$${L.moic}`, equity0: `LBO!$B$${L.equity0}`, floorPx: `LBO!$B$${L.floorPx}`, exitEq: `LBO!$B$${L.exitEq}`, debt0: `LBO!$B$${L.debt0}`, feesFin: `LBO!$B$${L.feesFin}`, evMax: `LBO!$B$${L.evMax}` };

  /* ================= Comparable companies package =================
     Benchmarking 1 / Benchmarking 2 / Comps Analysis / List, plus one full
     input page per company (see excel/compsSheets.js). Every analysis cell is
     a live link into an input page. */
  const compsPkg = addCompsSheets(wb, a, F, `(${sym} in ${unit}, except per share data)`, sheetNames, {
    ntmRevenue: `DCF!${dyc(0)}${D.sales}`,
    ntmEbitda: `DCF!${dyc(0)}${D.ebitda}`,
    ntmNetIncome: tsRefs.ni1,
    netDebt: R.netDebt,
    shares: R.shares,
  });
  const compsRefs = compsPkg.implied;
  const precEng = computePrecedent(a);

  /* ================= Precedent transactions package =================
     Output + Deal List + one full input page per transaction, written by
     excel/precedentSheets.js. A deal page is the comparable-company page with
     the target's financials priced at the offer, plus the deal-terms block. */
  const precPkg = addPrecedentSheets(wb, a, precEng, F, `(${sym} in ${unit}, except per share data)`, sheetNames, a.company.name || 'Company', {
    ltmSales: `DCF!$${ltmC}$${D.sales}`,
    ltmEbitda: `DCF!$${ltmC}$${D.ebitda}`,
    netDebt: R.netDebt,
    shares: R.shares,
    curPrice: R.curPrice,
  });
  const precRefs = precPkg.refs;

  /* ================= IPO sheet ================= */
  const ip = wb.addWorksheet('IPO');
  ip.getColumn(1).width = 40;
  ip.getColumn(2).width = 16;
  ip.getColumn(3).width = 48;
  styleSheet(ip, { freezeRow: 1, tab: C_TAB_ANALYSIS, printTitles: '1:1', portrait: true });
  let ir = 1;
  put(ip, `A${ir}`, 'IPO VALUATION & DILUTION', { bold: true, size: 14 });
  ir += 2;
  const I = {};
  const iVal = (key, label, formula, fmt, note = '', opts = {}) => {
    I[key] = ir;
    put(ip, `A${ir}`, label, opts);
    put(ip, `B${ir}`, { formula }, { fmt, ...opts });
    if (note) put(ip, `C${ir}`, note, { italic: true, color: 'FF999999' });
    ir++;
  };
  sectionHeader(ip, ir++, 'PRICING');
  iVal('ntmNI', 'NTM net income', tsRefs.ni1, F.money, '', { color: C_LINK });
  iVal('ntmEB', 'NTM EBITDA', `DCF!${dyc(0)}${D.ebitda}`, F.money, '', { color: C_LINK });
  iVal('fairPre', 'Fair pre-money equity value', `IF(${R.ipoBasis}="pe",${R.offerPE}*B${I.ntmNI},${R.offerEvE}*B${I.ntmEB}-${R.netDebt})`, F.money, 'Basis chosen on the Assumptions sheet', { bold: true });
  iVal('fairPxPre', 'Fair value per (existing) share', `B${I.fairPre}/${R.shares}`, F.price);
  iVal('offerEq', 'Offer pre-money equity (after IPO discount)', `B${I.fairPre}*(1-${R.ipoDisc})`, F.money);
  iVal('offerPx', 'OFFER PRICE', `B${I.offerEq}/${R.shares}`, F.price, '', { bold: true });
  ir++;
  sectionHeader(ip, ir++, 'DEAL STRUCTURE');
  iVal('primSh', 'Primary shares issued', `${R.ipoRaise}/B${I.offerPx}`, F.num);
  iVal('secSh', 'Secondary shares sold', `${R.shares}*${R.ipoSec}`, F.num);
  iVal('gsSh', 'Greenshoe shares (primary)', `(B${I.primSh}+B${I.secSh})*${R.ipoGS}`, F.num);
  iVal('postSh', 'Post-IPO shares outstanding', `${R.shares}+B${I.primSh}+B${I.gsSh}`, F.num, '', { bold: true });
  iVal('grossPrim', 'Gross primary proceeds (incl. greenshoe)', `(B${I.primSh}+B${I.gsSh})*B${I.offerPx}`, F.money);
  iVal('fees', 'Underwriting fees & expenses', `B${I.grossPrim}*${R.ipoFees}`, F.money);
  iVal('netPrim', 'Net primary proceeds to company', `B${I.grossPrim}-B${I.fees}`, F.money, '', { bold: true });
  iVal('debtRepaid', 'Debt repaid from proceeds', `MIN(${R.grossDebt},B${I.netPrim}*${R.ipoUse})`, F.money);
  iVal('cashAdded', 'Cash retained on balance sheet', `B${I.netPrim}-B${I.debtRepaid}`, F.money);
  ir++;
  sectionHeader(ip, ir++, 'POST-IPO EFFECTS');
  iVal('ndPost', 'Net debt post-IPO', `${R.netDebt}-B${I.netPrim}`, F.money, 'Falls one-for-one with net primary');
  iVal('intSaved', 'After-tax interest saved + cash income', `B${I.debtRepaid}*${R.intDebt}*(1-${R.tax})+B${I.cashAdded}*${R.intCash}*(1-${R.tax})`, F.money);
  iVal('niPost', 'Pro-forma NTM net income', `B${I.ntmNI}+B${I.intSaved}`, F.money);
  iVal('epsPre', 'NTM EPS pre-IPO', `B${I.ntmNI}/${R.shares}`, F.price);
  iVal('epsPost', 'NTM EPS post-IPO', `B${I.niPost}/B${I.postSh}`, F.price);
  iVal('dilution', 'EPS dilution', `B${I.epsPost}/B${I.epsPre}-1`, F.pct2, '', { italic: true });
  iVal('mktCap', 'Market cap at offer (post-greenshoe)', `B${I.offerPx}*B${I.postSh}`, F.money, '', { bold: true });
  iVal('fairPost', 'Fair value per share post-IPO', `(B${I.fairPre}+B${I.netPrim})/B${I.postSh}`, F.price);
  iVal('uplift', 'Uplift when the discount unwinds', `B${I.fairPost}/B${I.offerPx}-1`, F.pct2, '', { italic: true });
  iVal('float', 'Free float', `(B${I.primSh}+B${I.secSh}+B${I.gsSh})/B${I.postSh}`, F.pct2);
  iVal('rangeLo', 'Bookbuild low (offer - band)', `B${I.offerPx}*(1-${R.ipoBand})`, F.price);
  ir++;
  sectionHeader(ip, ir++, 'OWNERSHIP — POST-IPO');
  iVal('ownExist', 'Existing holders', `(${R.shares}-B${I.secSh})/B${I.postSh}`, F.pct2, 'Pre-IPO shares less secondary sold');
  iVal('ownNew', 'New investors (free float)', `(B${I.primSh}+B${I.secSh}+B${I.gsSh})/B${I.postSh}`, F.pct2, 'Primary + secondary + greenshoe');
  iVal('ownChk', 'Check (sums to 100%)', `B${I.ownExist}+B${I.ownNew}`, F.pct2, '', { italic: true });
  const ipoRefs = { offerPx: `IPO!$B$${I.offerPx}`, rangeLo: `IPO!$B$${I.rangeLo}`, fairPost: `IPO!$B$${I.fairPost}`, mktCap: `IPO!$B$${I.mktCap}` };

  /* ================= Regression sheet =================
   * The full workbench as LIVE formulas: raw peer data (blue) → transformed
   * design matrix → normal equations X'X / X'y → Gauss-Jordan elimination on
   * [X'X | X'y | I] (pure arithmetic — no MINVERSE, so it recalculates in any
   * engine) → coefficients, classical SEs (t via TDIST), fit diagnostics,
   * the target prediction with its ±1 SE band, and the implied-price bridge.
   */
  let regRefs = null;
  {
    const regRun = runRegression(a);
    const fitR = regRun.fit;
    const rs = wb.addWorksheet('Regression');
    rs.getColumn(1).width = 26;
    for (let i = 2; i <= 24; i++) rs.getColumn(i).width = 13;
    styleSheet(rs, { freezeRow: 1, freezeCol: 1, tab: C_TAB_ANALYSIS, printTitles: '1:1' });
    let rr = 1;
    put(rs, `A${rr}`, 'REGRESSION ANALYSIS', { bold: true, size: 14 }); rr++;
    const yLabel = (regRun.yDef || {}).label || regRun.yVar;
    if (!fitR?.ok) {
      put(rs, `A${rr + 1}`, `Model not estimable in the app: ${fitR?.reason || 'insufficient data'}.`, { italic: true, color: 'FF999999' });
      put(rs, `A${rr + 2}`, 'Add peers / variables in the Regression Lab and re-export.', { italic: true, color: 'FF999999' });
    } else {
      const terms = fitR.cols;                    // design columns (after the intercept)
      const dim = terms.length + 1;
      const usedX = [...new Set(terms.map((t) => t.key))];
      const varsAll = allVars(a);
      const varLabel = (k) => (varsAll.find((v) => v.key === k) || { label: k }).label;
      put(rs, `A${rr}`, `${regRun.spec.yLog ? `ln(${yLabel})` : yLabel}  ~  β₀ + ${terms.map((t, i) => `β${i + 1}·${t.label}`).join(' + ')}`, { italic: true, color: 'FF777777' });
      rr += 2;

      /* ---- peer data (only rows the fit uses — complete on every used variable) ---- */
      sectionHeader(rs, rr++, 'PEER DATA', 2 + usedX.length);
      const pdHead = rr;
      put(rs, `A${pdHead}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
      usedX.forEach((k, i) => put(rs, `${colL(2 + i)}${pdHead}`, varLabel(k), { bold: true, fill: C_SECTION_FILL, align: 'center' }));
      put(rs, `${colL(2 + usedX.length)}${pdHead}`, `${yLabel} (y)`, { bold: true, fill: C_SECTION_FILL, align: 'center' });
      rr++;
      const pd0 = rr;
      const computedPeers = compsPeerRows(a);
      const peerRows = fitR.rows.map((r) => computedPeers.find((p) => p.name === r.name)).filter(Boolean);
      for (const p of peerRows) {
        put(rs, `A${rr}`, p.name, { color: C_INPUT });
        usedX.forEach((k, i) => put(rs, `${colL(2 + i)}${rr}`, Number(p[k]), { fmt: F.num, color: C_INPUT, align: 'center' }));
        put(rs, `${colL(2 + usedX.length)}${rr}`, Number(p[regRun.yVar]), { fmt: F.num, color: C_INPUT, align: 'center' });
        rr++;
      }
      const nObs = peerRows.length;
      const rawCell = (k, i) => `${colL(2 + usedX.indexOf(k))}${pd0 + i}`;
      const rawYCell = (i) => `${colL(2 + usedX.length)}${pd0 + i}`;
      if (fitR.dropped.length) { put(rs, `A${rr}`, `Excluded (incomplete): ${fitR.dropped.join(', ')}`, { italic: true, color: 'FF999999' }); rr++; }
      rr++;

      /* ---- transformed design matrix ---- */
      sectionHeader(rs, rr++, 'DESIGN MATRIX (transformed)', 3 + dim);
      const dmHead = rr;
      put(rs, `A${dmHead}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
      put(rs, `B${dmHead}`, 'const', { bold: true, fill: C_SECTION_FILL, align: 'center' });
      terms.forEach((t, i) => put(rs, `${colL(3 + i)}${dmHead}`, t.label, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
      const yStarCol = colL(3 + terms.length);
      put(rs, `${yStarCol}${dmHead}`, regRun.spec.yLog ? 'ln(y)' : 'y', { bold: true, fill: C_SECTION_FILL, align: 'center' });
      rr++;
      const dm0 = rr;
      const termFormula = (t, rc) => {
        const base = t.transform === 'ln' ? `LN(${rc})` : rc;
        return t.power > 1 ? `(${base})^${t.power}` : base;
      };
      for (let i = 0; i < nObs; i++) {
        put(rs, `A${dm0 + i}`, { formula: `A${pd0 + i}` });
        put(rs, `B${dm0 + i}`, 1, { align: 'center' });
        terms.forEach((t, j) => put(rs, `${colL(3 + j)}${dm0 + i}`, { formula: termFormula(t, rawCell(t.key, i)) }, { fmt: F.num3, align: 'center' }));
        put(rs, `${yStarCol}${dm0 + i}`, { formula: regRun.spec.yLog ? `LN(${rawYCell(i)})` : `${rawYCell(i)}` }, { fmt: F.num3, align: 'center' });
        rr++;
      }
      const dCol = (j) => colL(2 + j); // design col j (0 = const)
      const dRange = (j) => `${dCol(j)}${dm0}:${dCol(j)}${dm0 + nObs - 1}`;
      const yRange = `${yStarCol}${dm0}:${yStarCol}${dm0 + nObs - 1}`;
      rr++;

      /* ---- normal equations ---- */
      sectionHeader(rs, rr++, "NORMAL EQUATIONS — X'X and X'y", 3 + dim);
      const neHead = rr;
      for (let j = 0; j < dim; j++) put(rs, `${colL(2 + j)}${neHead}`, j === 0 ? 'const' : terms[j - 1].label, { bold: true, fill: C_SECTION_FILL, align: 'center' });
      put(rs, `${colL(2 + dim)}${neHead}`, "X'y", { bold: true, fill: C_SECTION_FILL, align: 'center' });
      rr++;
      const ne0 = rr;
      for (let i = 0; i < dim; i++) {
        put(rs, `A${ne0 + i}`, i === 0 ? 'const' : terms[i - 1].label, { bold: true });
        for (let j = 0; j < dim; j++) put(rs, `${colL(2 + j)}${ne0 + i}`, { formula: `SUMPRODUCT(${dRange(i)},${dRange(j)})` }, { fmt: F.num, align: 'center' });
        put(rs, `${colL(2 + dim)}${ne0 + i}`, { formula: `SUMPRODUCT(${dRange(i)},${yRange})` }, { fmt: F.num, align: 'center' });
        rr++;
      }
      rr++;

      /* ---- Gauss-Jordan elimination on [X'X | X'y | I] ---- */
      sectionHeader(rs, rr++, "SOLVE — GAUSS-JORDAN ON [X'X | X'y | I]  (final block: β and (X'X)⁻¹)", 2 + 2 * dim + 1);
      const gjHead = rr;
      for (let j = 0; j < dim; j++) put(rs, `${colL(2 + j)}${gjHead}`, `a${j + 1}`, { bold: true, fill: C_SECTION_FILL, align: 'center' });
      put(rs, `${colL(2 + dim)}${gjHead}`, 'b', { bold: true, fill: C_SECTION_FILL, align: 'center' });
      for (let j = 0; j < dim; j++) put(rs, `${colL(3 + dim + j)}${gjHead}`, `e${j + 1}`, { bold: true, fill: C_SECTION_FILL, align: 'center' });
      rr++;
      const width = 2 * dim + 1;
      const blocks = []; // start row of each block
      // block 0: copy of the augmented system
      blocks[0] = rr;
      for (let i = 0; i < dim; i++) {
        put(rs, `A${rr}`, i === 0 ? 'augmented' : '', { italic: true, color: 'FF999999' });
        for (let c = 0; c < width; c++) {
          const src = c < dim + 1 ? `${colL(2 + c)}${ne0 + i}` : null;
          if (src) put(rs, `${colL(2 + c)}${rr}`, { formula: src }, { fmt: F.num3, align: 'center' });
          else put(rs, `${colL(2 + c)}${rr}`, c - (dim + 1) === i ? 1 : 0, { align: 'center' });
        }
        rr++;
      }
      // elimination stages: stage p pivots on row p / column p
      for (let p = 0; p < dim; p++) {
        const prev = blocks[p];
        blocks[p + 1] = rr;
        for (let i = 0; i < dim; i++) {
          put(rs, `A${rr}`, i === 0 ? `eliminate col ${p + 1}` : '', { italic: true, color: 'FF999999' });
          for (let c = 0; c < width; c++) {
            const cc = colL(2 + c);
            const prevCell = `${cc}${prev + i}`;
            const pivCell = `${colL(2 + p)}${prev + p}`;
            let f;
            if (i === p) f = `${prevCell}/${pivCell}`;                                      // normalise the pivot row
            else f = `${prevCell}-${colL(2 + p)}${prev + i}*${cc}${blocks[p + 1] + p}`;     // subtract its multiple
            put(rs, `${cc}${rr}`, { formula: f }, { fmt: F.num3, align: 'center' });
          }
          rr++;
        }
      }
      const fin = blocks[dim];
      const betaCell = (i) => `${colL(2 + dim)}${fin + i}`;
      const invCell = (i, j) => `${colL(3 + dim + j)}${fin + i}`;
      rr++;

      /* ---- fit per peer ---- */
      sectionHeader(rs, rr++, 'FIT — fitted values & residuals', 5);
      put(rs, `A${rr}`, 'Peer', { bold: true, fill: C_SECTION_FILL });
      ['Actual y*', 'Fitted', 'Residual'].forEach((h, i) => put(rs, `${colL(2 + i)}${rr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
      rr++;
      const ft0 = rr;
      const fittedExpr = (i) => `${betaCell(0)}+${terms.map((_, j) => `${betaCell(j + 1)}*${dCol(j + 1)}${dm0 + i}`).join('+')}`;
      for (let i = 0; i < nObs; i++) {
        put(rs, `A${ft0 + i}`, { formula: `A${pd0 + i}` });
        put(rs, `B${ft0 + i}`, { formula: `${yStarCol}${dm0 + i}` }, { fmt: F.num3, align: 'center' });
        put(rs, `C${ft0 + i}`, { formula: fittedExpr(i) }, { fmt: F.num3, align: 'center' });
        put(rs, `D${ft0 + i}`, { formula: `B${ft0 + i}-C${ft0 + i}` }, { fmt: F.num3, align: 'center' });
        rr++;
      }
      const residRange = `D${ft0}:D${ft0 + nObs - 1}`;
      rr++;

      /* ---- model statistics ---- */
      sectionHeader(rs, rr++, 'MODEL STATISTICS', 4);
      const S = {};
      const sVal = (key, label, formula, fmt, note = '') => {
        put(rs, `A${rr}`, label);
        put(rs, `B${rr}`, { formula }, { fmt, align: 'center' });
        if (note) put(rs, `D${rr}`, note, { italic: true, color: 'FF999999' });
        S[key] = rr;
        return rr++;
      };
      sVal('n', 'Observations (n)', `${nObs}`, F.int);
      sVal('k', 'Terms (k)', `${terms.length}`, F.int);
      sVal('df', 'Degrees of freedom', `B${S.n}-B${S.k}-1`, F.int);
      sVal('sse', 'SSE (residual sum of squares)', `SUMPRODUCT(${residRange},${residRange})`, F.num3);
      sVal('sst', 'SST (total sum of squares)', `SUMPRODUCT(${yRange}-AVERAGE(${yRange}),${yRange}-AVERAGE(${yRange}))`, F.num3);
      sVal('r2', 'R²', `1-B${S.sse}/B${S.sst}`, F.pct2);
      sVal('adjr2', 'Adjusted R²', `1-(B${S.sse}/B${S.df})/(B${S.sst}/(B${S.n}-1))`, F.pct2);
      sVal('mse', 'MSE (SSE / df)', `B${S.sse}/B${S.df}`, F.num3);
      sVal('se', 'SE of regression', `SQRT(B${S.mse})`, F.num3, regRun.spec.yLog ? 'in ln(y) units' : '');
      sVal('f', 'F-statistic', `((B${S.sst}-B${S.sse})/B${S.k})/B${S.mse}`, F.num);
      rr++;

      /* ---- coefficient table ---- */
      sectionHeader(rs, rr++, 'COEFFICIENTS', 5);
      put(rs, `A${rr}`, 'Term', { bold: true, fill: C_SECTION_FILL });
      ['β', 'Std error', 't-stat', 'p-value'].forEach((h, i) => put(rs, `${colL(2 + i)}${rr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center' }));
      rr++;
      const co0 = rr;
      for (let i = 0; i < dim; i++) {
        put(rs, `A${rr}`, i === 0 ? 'Intercept' : terms[i - 1].label, { bold: i === 0 });
        put(rs, `B${rr}`, { formula: betaCell(i) }, { fmt: F.num3, align: 'center', bold: true });
        put(rs, `C${rr}`, { formula: `SQRT(B${S.mse}*${invCell(i, i)})` }, { fmt: F.num3, align: 'center' });
        put(rs, `D${rr}`, { formula: `B${rr}/C${rr}` }, { fmt: F.num, align: 'center' });
        put(rs, `E${rr}`, { formula: `TDIST(ABS(D${rr}),B${S.df},2)` }, { fmt: '0.0000', align: 'center' });
        rr++;
      }
      rr++;

      /* ---- prediction for the target ---- */
      sectionHeader(rs, rr++, `PREDICTION — ${a.company.name || 'target'}`, 4 + terms.length);
      put(rs, `A${rr}`, 'Target x (blue = editable)', { bold: true, fill: C_SECTION_FILL });
      usedX.forEach((k, i) => put(rs, `${colL(2 + i)}${rr}`, varLabel(k), { bold: true, fill: C_SECTION_FILL, align: 'center' }));
      rr++;
      const tg = rr;
      put(rs, `A${tg}`, 'value');
      usedX.forEach((k, i) => put(rs, `${colL(2 + i)}${tg}`, Number(regRun.target[k]), { fmt: F.num, color: C_INPUT, align: 'center' }));
      rr += 2;
      const tRaw = (k) => `${colL(2 + usedX.indexOf(k))}${tg}`;
      // transformed z row
      put(rs, `A${rr}`, 'z (transformed)', { bold: true });
      put(rs, `B${rr}`, 1, { align: 'center' });
      terms.forEach((t, j) => put(rs, `${colL(3 + j)}${rr}`, { formula: termFormula(t, tRaw(t.key)) }, { fmt: F.num3, align: 'center' }));
      const z0 = rr;
      const zCell = (i) => (i === 0 ? `B${z0}` : `${colL(2 + i)}${z0}`);
      rr += 2;
      const P = {};
      const pVal = (key, label, formula, fmt, note = '', opts = {}) => {
        put(rs, `A${rr}`, label, opts);
        put(rs, `B${rr}`, { formula }, { fmt, align: 'center', ...opts });
        if (note) put(rs, `D${rr}`, note, { italic: true, color: 'FF999999' });
        P[key] = rr;
        return rr++;
      };
      pVal('yhatT', regRun.spec.yLog ? 'ŷ (ln scale)' : 'ŷ (predicted y)', `${betaCell(0)}+${terms.map((_, j) => `${betaCell(j + 1)}*${zCell(j + 1)}`).join('+')}`, F.num3);
      // q = z' (X'X)⁻¹ z, expanded term-by-term (pure arithmetic — no array formulas)
      const qTerms = [];
      for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) qTerms.push(`${zCell(i)}*${invCell(i, j)}*${zCell(j)}`);
      pVal('q', "z'(X'X)⁻¹z", qTerms.join('+'), F.num3);
      pVal('seP', 'SE of mean prediction', `SQRT(B${S.mse}*B${P.q})`, F.num3);
      const back = (expr) => (regRun.spec.yLog ? `EXP(${expr})` : expr);
      pVal('pred', `Predicted ${yLabel}`, back(`B${P.yhatT}`), F.x2, '', { bold: true });
      pVal('predLo', '−1 SE', back(`B${P.yhatT}-B${P.seP}`), F.x2);
      pVal('predHi', '+1 SE', back(`B${P.yhatT}+B${P.seP}`), F.x2);
      rr++;

      /* ---- implied price bridge (y must be a valuation multiple) ---- */
      if (regRun.yDef?.multiple) {
        sectionHeader(rs, rr++, 'IMPLIED SHARE PRICE', 4);
        const metricRef = regRun.yVar === 'evSales' ? `DCF!${dyc(0)}${D.sales}`
          : regRun.yVar === 'evEbitda' ? `DCF!${dyc(0)}${D.ebitda}` : tsRefs.ni1;
        const metricLabel = regRun.yVar === 'evSales' ? 'NTM Revenue' : regRun.yVar === 'evEbitda' ? 'NTM EBITDA' : 'NTM Net income';
        pVal('metric', metricLabel, metricRef, F.money, 'Year 1 of the shared projection', { color: C_LINK });
        const toPrice = (mult) => (regRun.yDef.multiple === 'ev'
          ? `(${mult}*B${P.metric}-${R.netDebt})/${R.shares}`
          : `${mult}*B${P.metric}/${R.shares}`);
        pVal('px', 'Implied share price', toPrice(`B${P.pred}`), F.price, regRun.yDef.multiple === 'ev' ? 'EV less net debt, over shares' : 'Equity value over shares', { bold: true });
        pVal('pxLo', '−1 SE', toPrice(`B${P.predLo}`), F.price);
        pVal('pxHi', '+1 SE', toPrice(`B${P.predHi}`), F.price);
        regRefs = { px: `Regression!$B$${P.px}`, lo: `Regression!$B$${P.pxLo}`, hi: `Regression!$B$${P.pxHi}` };
      }
      rr++;
      put(rs, `A${rr}`, 'Everything above recalculates live: edit any blue cell (peer data or target x) and the elimination, coefficients and prediction re-solve.', { italic: true, color: 'FF999999' });
    }
  }

  /* ================= Summary sheet ================= */
  const sm = wb.addWorksheet('Summary');
  sm.getColumn(1).width = 32;
  for (let i = 2; i <= 5; i++) sm.getColumn(i).width = 16;
  styleSheet(sm, { freezeRow: 1, tab: C_TAB_ANALYSIS, printTitles: '1:1', portrait: true });
  let sr2 = 1;
  put(sm, `A${sr2}`, 'VALUATION SUMMARY', { bold: true, size: 14 });
  sr2++;
  put(sm, `A${sr2}`, { formula: R.name }, { bold: true, size: 12, color: C_LINK });
  sr2 += 2;

  sectionHeader(sm, sr2++, 'FOOTBALL FIELD — IMPLIED SHARE PRICE', 4);
  ['Method', 'Low', 'Mid', 'High'].forEach((h, i) => put(sm, `${colL(1 + i)}${sr2}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left' }));
  sr2++;
  const ffRow = (label, low, mid, high) => {
    put(sm, `A${sr2}`, label);
    put(sm, `B${sr2}`, { formula: low }, { fmt: F.price, align: 'center' });
    put(sm, `C${sr2}`, { formula: mid }, { fmt: F.price, align: 'center', bold: true });
    put(sm, `D${sr2}`, { formula: high }, { fmt: F.price, align: 'center' });
    sr2++;
  };
  ffRow('DCF — FCFF Gordon', `MIN(${gridGordonRange})`, dcfRefs.priceGordon, `MAX(${gridGordonRange})`);
  ffRow('DCF — FCFF exit multiple', `MIN(${gridExitRange})`, dcfRefs.priceExit, `MAX(${gridExitRange})`);
  ffRow('DCF — FCFE @ CoE', `MIN(${gridFcfeRange})`, dcfRefs.priceFcfe, `MAX(${gridFcfeRange})`);
  for (const [label, k] of [['Comps — EV/Sales', 'evSales'], ['Comps — EV/EBITDA', 'evEbitda'], ['Comps — P/E', 'pe']]) {
    if (compsRefs[k]) ffRow(label, compsRefs[k].lo, compsRefs[k].mid, compsRefs[k].hi);
  }
  if (regRefs) ffRow('Regression (±1 SE)', regRefs.lo, regRefs.px, regRefs.hi);
  if (precRefs.evEbitda) ffRow('Precedent — EV/EBITDA', precRefs.evEbitda.lo, precRefs.evEbitda.mid, precRefs.evEbitda.hi);
  if (precRefs.premia) ffRow('Precedent — premia', precRefs.premia.lo, precRefs.premia.mid, precRefs.premia.hi);
  ffRow('IPO — offer → fair', ipoRefs.rangeLo, ipoRefs.offerPx, ipoRefs.fairPost);
  ffRow(
    'LBO floor (hurdle ±2.5%)',
    `((${lboRefs.exitEq}/(1+${R.hurdle}+0.025)^${R.exitYear}+${lboRefs.debt0}-${lboRefs.feesFin})/(1+${R.feesPct})-${R.netDebt})/${R.shares}`,
    lboRefs.floorPx,
    `((${lboRefs.exitEq}/(1+${R.hurdle}-0.025)^${R.exitYear}+${lboRefs.debt0}-${lboRefs.feesFin})/(1+${R.feesPct})-${R.netDebt})/${R.shares}`
  );
  put(sm, `A${sr2}`, 'Current market price', { italic: true });
  put(sm, `C${sr2}`, { formula: R.curPrice }, { fmt: F.price, italic: true, align: 'center', color: C_LINK });
  sr2 += 2;

  sectionHeader(sm, sr2++, 'KEY OUTPUTS', 4);
  const kv = (label, formula, fmt) => {
    put(sm, `A${sr2}`, label);
    put(sm, `B${sr2}`, { formula }, { fmt, bold: true });
    sr2++;
  };
  kv('WACC', R.wacc, F.pct2);
  kv(`Cost of equity (${a.wacc.betaMode === 'hamada' ? 'Hamada βL' : 'direct βL'})`, R.coe, F.pct2);
  kv('Levered beta', R.beta, F.num3);
  kv('Enterprise value (DCF, Gordon)', dcfRefs.evGordon, F.money);
  kv('Implied price — FCFF Gordon', dcfRefs.priceGordon, F.price);
  kv('Implied price — FCFE Gordon', dcfRefs.priceFcfe, F.price);
  if (regRefs) kv('Regression-implied price', regRefs.px, F.price);
  kv('LBO sponsor equity', lboRefs.equity0, F.money);
  kv('LBO IRR', lboRefs.irr, F.pct2);
  kv('LBO MOIC', lboRefs.moic, F.x2);
  kv('LBO floor price @ hurdle', lboRefs.floorPx, F.price);
  kv('IPO offer price', ipoRefs.offerPx, F.price);
  kv('IPO market cap at offer', ipoRefs.mktCap, F.money);
  sr2++;
  put(sm, `A${sr2}`, 'Blue = input · Black = formula · Green = cross-sheet link. Edit any blue cell and the workbook recalculates.', { italic: true, color: 'FF999999' });

  // single-method export: drop the sheets that aren't part of this file.
  // Kept sheets only ever reference sheets that are also kept, so formulas stay live.
  if (methodDef.sheets) {
    const keep = resolveSheets(methodDef, a);
    for (const ws of [...wb.worksheets]) {
      if (!keep.includes(ws.name)) wb.removeWorksheet(ws.id);
    }
    orderSheets(wb, keep);
  } else {
    // Full model: the benchmarking pages lead, then the rest in build order.
    orderSheets(wb, [...compsPkg.order, ...wb.worksheets.map((w) => w.name)]);
  }

  return wb;
}

export async function exportToExcel(a, method = 'full') {
  const wb = buildWorkbook(a, method);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const aTag = document.createElement('a');
  aTag.href = url;
  const safeName = (a.company.name || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  const suffix = method === 'full' ? 'valuation_model' : (EXPORT_METHODS[method] || EXPORT_METHODS.full).label.replace(/[^\w]+/g, '_');
  aTag.download = `${safeName}_${suffix}.xlsx`;
  document.body.appendChild(aTag);
  aTag.click();
  document.body.removeChild(aTag);
  URL.revokeObjectURL(url);
}
