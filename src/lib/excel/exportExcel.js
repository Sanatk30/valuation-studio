import ExcelJS from 'exceljs';
import { CURRENCIES } from '../format.js';
import { METHOD_META } from '../../methods/labels.js';
import { projectOperations } from '../engine/drivers.js';
import { openingNol } from '../engine/tax.js';
import { otherNetAssetsOf } from '../engine/threeStatement.js';
import { hasHistory, reportedHistory } from '../historyModel.js';
import {
  put, colL, styleSheet, edge, colRun, makeFormats, nv, nb, na,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED, C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';
import { writeProjectionSheet } from './projectionSheet.js';
import { writeThreeStatementSheet, writePastRatiosSheet, writeIpoSheet } from './modelSheets.js';
import { buildCompsWorkbook, buildPrecedentWorkbook } from './templateWorkbooks.js';
import { buildDcfWorkbook } from './dcfWorkbook.js';
import { buildLboWorkbook } from './lboWorkbook.js';
import { addCharts } from './xlsxCharts.js';

/*
 * Live-formula Excel export — one file per method.
 * Each file = Cover + an Inputs sheet holding ONLY that method's inputs + its
 * calculation sheets. Conventions: blue font = input cell (edit these), black
 * = formula, green = cross-sheet link. A blank input is the text "NA", and
 * every figure built from it reads NA. The workbook recalculates on open and
 * reproduces the app's engines exactly (see the recalculation tests).
 * Comps, precedent, the DCF and the LBO follow the user's template workbooks
 * instead (their own sheet set: Instructions, Inputs, the template's sheets).
 */

export const EXPORT_METHODS = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'ts', 'ratios', 'combined'];

/** Methods whose Company step collects the tax rate and the opening NOL. */
const PROJ = new Set(['ipo', 'ts', 'ratios']);

const SHEET_NOTES = {
  Inputs: 'every input of this method (blue). Edit here and the whole file recalculates.',
  Projection: 'the operating projection every other sheet links to.',
  '3 Statement': 'linked income statement, cash flow, balance sheet and debt & cash schedule.',
  IPO: 'pricing, deal structure, proceeds, pro-forma earnings, dilution and ownership.',
  Regression: 'the peer regression solved live, with the implied share price.',
  'Past Ratios': 'ratios on the reported history.',
  Combined: "each method's chosen figure and range, weighted into one value, with a football-field chart.",
};

/**
 * Put the tabs in `order` first, everything else after, keeping relative order.
 * ExcelJS writes workbook.xml sorted by `orderNo`, so this sets the tab order.
 */
function orderSheets(wb, order) {
  const rank = new Map();
  order.filter(Boolean).forEach((n, i) => { if (!rank.has(n)) rank.set(n, i); });
  const rest = wb.worksheets.filter((w) => !rank.has(w.name));
  rest.forEach((w, i) => rank.set(w.name, rank.size + i));
  for (const ws of wb.worksheets) ws.orderNo = rank.get(ws.name);
}

const fyMonthName = (a) => new Date(Date.UTC(2000, (a.settings?.period?.fyEndMonth ?? 12) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

/* ==================================================================== */
/*                               Inputs                                 */
/* ==================================================================== */

/**
 * The Inputs sheet: only the inputs `methodId` collects, in the order of its
 * steps. Returns `R`, the absolute references every other sheet links to.
 */
/** A dropdown on an Inputs cell ("Inputs!$B$28" → B28), as the revised IPO template. */
function listCheck(ws, ref, list) {
  ws.getCell(ref.replace(/^Inputs!/, '').replace(/\$/g, '')).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
}
/** A 0–100% (0–1) decimal check on an Inputs cell. */
function rangeCheck(ws, ref) {
  ws.getCell(ref.replace(/^Inputs!/, '').replace(/\$/g, '')).dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1] };
}

function writeInputs(ws, a, F, methodId, opts) {
  const skipped = opts.skipped || {};
  const sym = CURRENCIES[a.settings.currency]?.symbol || '';
  const R = {};
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 60;
  styleSheet(ws, { freezeRow: 2, tab: C_TAB_ANALYSIS, printTitles: '1:2', portrait: true });
  let r = 1;
  put(ws, `A${r}`, `INPUTS — ${METHOD_META[methodId].label.toUpperCase()}`, { bold: true, size: 14 });
  ws.getRow(r).height = 22;
  put(ws, `C${r}`, `Money in ${sym} ${a.settings.unit}. Blue cells are inputs — edit them and the file recalculates. Leave an input blank if not available.`, { italic: true, color: C_MUTED, wrap: true });
  edge(ws, r, colRun(1, 3), 'bottom', 'medium', C_HDR_FILL);
  r += 2;

  const at = () => `Inputs!$B$${r}`;
  const section = (t) => {
    for (let i = 1; i <= 3; i++) put(ws, `${colL(i)}${r}`, i === 1 ? t : null, { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
    ws.getRow(r).height = 18;
    r++;
  };
  const inp = (key, label, value, fmt, note = '') => {
    put(ws, `A${r}`, label);
    put(ws, `B${r}`, value, { fmt, color: C_INPUT, fill: C_INPUT_FILL, align: 'right' });
    if (note) put(ws, `C${r}`, note, { italic: true, color: C_MUTED });
    if (key) R[key] = at();
    r++;
  };
  const calc = (key, label, formula, fmt, note = '') => {
    put(ws, `A${r}`, label, { italic: true });
    put(ws, `B${r}`, { formula }, { fmt, bold: true, align: 'right' });
    if (note) put(ws, `C${r}`, note, { italic: true, color: C_MUTED });
    if (key) R[key] = at();
    r++;
  };
  const fixed = (label, value, fmt, note) => {
    put(ws, `A${r}`, label);
    put(ws, `B${r}`, value, { fmt, align: 'right' });
    if (note) put(ws, `C${r}`, note, { italic: true, color: C_MUTED });
    r++;
  };
  // a blank input stays an empty cell (the revised templates): the blank files open without #VALUE! errors
  const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? x / 100 : null);
  const txt = (x) => (x === null || x === undefined || x === '' ? '' : String(x));

  /* ---- company ---- */
  const c = a.company;
  section('COMPANY');
  inp('name', 'Company name', txt(c.name) || 'Company', undefined);
  inp('shares', `Diluted shares outstanding (${a.settings.unit})`, nb(c.sharesOut), F.shares, 'Same unit scale as the money figures');
  inp('curPrice', 'Current share price', nb(c.currentPrice), F.price, methodId === 'ipo'
    ? 'Not used in IPO pricing (pre-listing company) – leave NA'
    : methodId === 'ts' || methodId === 'ratios'
      ? 'NA for a private company – the valuation ratios at the foot of the 3 Statement sheet then read NA'
      : 'NA for a private company — the upside lines then read NA');
  inp('grossDebt', 'Gross debt', nb(c.grossDebt), F.money);
  inp('cash', 'Cash & equivalents', nb(c.cash), F.money);
  calc('netDebt', 'Net debt', na(`${R.grossDebt}-${R.cash}`), F.money, 'Gross debt less cash');
  if (PROJ.has(methodId)) {
    inp('tax', 'Tax rate', pct(c.taxRate), F.pct);
    inp('nol0', 'Opening tax-loss carryforward (NOL)', nb(openingNol(a)), F.money, 'Used against profits before any tax is paid');
  }
  r++;

  /* ---- operating forecast ---- */
  if (PROJ.has(methodId)) {
    const ops = projectOperations(a);
    const startYear = a.settings?.period?.startYear;
    section('OPERATING FORECAST');
    fixed('Projection years', a.drivers.years, F.int, 'Fixed at export — change the horizon in the app and export again');
    inp('baseYear', 'Base (LTM) fiscal year', Number.isFinite(startYear) ? startYear - 1 : null, F.int, 'Year 0 — the LTM column');
    inp('rev0', 'LTM revenue', nb(ops.revenue0), F.money);
    inp('ebitda0', 'LTM EBITDA', nb(ops.ebitda0), F.money);
    inp('nwc0', 'Opening net working capital', nb(ops.nwc0), F.money, 'Year-0 NWC; the forecast years use the per-year NWC % of sales');
    put(ws, `A${r}`, 'Growth, margin, D&A, capex and NWC by year', { italic: true });
    put(ws, `C${r}`, 'The blue per-year rows at the foot of the Projection sheet', { italic: true, color: C_MUTED });
    r += 2;
  }

  /* ---- financing (3-statement, ratios, IPO) ---- */
  if (methodId === 'ts' || methodId === 'ratios' || methodId === 'ipo') {
    section(methodId === 'ipo' ? 'FINANCING RATES' : 'FINANCING & BALANCE SHEET');
    inp('intDebt', 'Interest rate on debt', pct(a.ts.interestRateDebt), F.pct, 'On opening debt — no circular references');
    inp('intCash', 'Interest earned on cash', pct(a.ts.interestRateCash), F.pct, 'On opening cash');
    inp('repayPct', 'Mandatory debt repayment (% of opening)', pct(a.ts.debtRepayPct), F.pct);
    inp('payout', 'Dividend payout (% of net income)', pct(a.ts.dividendPayout), F.pct);
    if (methodId !== 'ipo') {
      const ops = projectOperations(a);
      const ona = otherNetAssetsOf(a, ops.nwc0);
      const equity0 = a.ts.equity0 === undefined ? c.cash + ops.nwc0 + a.ts.startingPPE - c.grossDebt : a.ts.equity0;
      inp('ppe0', 'Opening net PP&E', nb(a.ts.startingPPE), F.money);
      inp('equity0', "Opening shareholders' equity (reported)", Number.isFinite(ona) ? nb(equity0) : nb(a.ts.equity0), F.money);
      calc('ona', 'Other net assets / (liabilities)', na(`${R.equity0}-(${R.cash}+${R.nwc0}+${R.ppe0}-${R.grossDebt})`), F.money, 'The gap between reported equity and cash + NWC + PP&E − debt, held constant');
    }
    r++;
  }

  /* ---- IPO ---- */
  if (methodId === 'ipo') {
    const p = a.ipo;
    section('PRICING BASIS');
    inp('ipoBasis', 'Pricing basis ("pe" or "evEbitda")', p.basis === 'pe' || p.basis === 'evEbitda' ? p.basis : null, undefined, 'P/E × Year-1 net income, or EV/EBITDA × Year-1 EBITDA');
    listCheck(ws, R.ipoBasis, '"pe,evEbitda"');
    // fair-value (peer) multiples: the IPO discount is applied afterwards
    inp('offerPE', 'Fair-value P/E (peer multiple, before the IPO discount)', nb(p.offerPE), F.x, 'P/E basis: fair equity = P/E × Year-1 net income. Take it from trading comps. Ignored on the EV/EBITDA basis.');
    inp('offerEvE', 'Fair-value EV/EBITDA (peer multiple, before the IPO discount)', nb(p.offerEvEbitda), F.x, 'EV/EBITDA basis: fair equity = EV/EBITDA × Year-1 EBITDA − net debt. Ignored on the P/E basis.');
    inp('ipoDisc', 'IPO discount to fair value', pct(p.ipoDiscount), F.pct, 'Offer price = fair value × (1 − discount); typically 10–15% to leave money on the table for new investors');
    inp('ipoBand', 'Bookbuild band below the offer', pct(p.rangeBand), F.pct, 'Low end of the price range');
    r++;
    section('OFFER STRUCTURE');
    inp('ipoRaise', 'Primary raise (fresh capital)', nb(p.primaryRaise), F.money);
    inp('ipoSec', 'Secondary sale (% of existing shares)', pct(p.secondaryPct), F.pct, 'Proceeds go to the selling holders');
    inp('ipoGS', 'Greenshoe size (% of base deal)', pct(p.greenshoePct), F.pct);
    inp('ipoGSEx', 'Greenshoe exercised (share of the option, 0–100%)', pct(p.greenshoeExercisedPct), F.pct);
    inp('ipoGSType', 'Greenshoe shares ("primary" or "secondary")', p.greenshoeType === 'primary' || p.greenshoeType === 'secondary' ? p.greenshoeType : null, undefined, 'primary = new shares; secondary = existing holders');
    listCheck(ws, R.ipoGSType, '"primary,secondary"');
    rangeCheck(ws, R.ipoGSEx);   // after the list check: the template stores them in this order
    inp('ipoFees', 'Underwriting fees + expenses (% of gross primary)', pct(p.feesPct), F.pct);
    inp('ipoUse', 'Net proceeds used to repay debt', pct(p.useProceedsDebtPct), F.pct, 'The rest stays as cash');
    r++;
  }

  return R;
}

/* ==================================================================== */
/*                               Combined                               */
/* ==================================================================== */

/**
 * The Combined template's six rows (key → method label, default figure label).
 * DCF goes in the FCFF row, or the FCFE / DDM row, by its cash-flow basis.
 */
export const COMBINED_ROWS = [
  { key: 'dcfFcff', method: 'DCF – FCFF', figure: 'Value per share (base case)' },
  { key: 'dcfFcfe', method: 'DCF – FCFE / DDM', figure: 'Value per share (base case)' },
  { key: 'comps', method: 'Comparable Companies', figure: 'EV / EBITDA – peer median' },
  { key: 'prec', method: 'Precedent Transactions', figure: 'EV / EBITDA – deal median' },
  { key: 'lbo', method: 'LBO (sponsor ability to pay)', figure: 'Price at target IRR' },
  { key: 'range52', method: '52-week trading range', figure: 'Current price' },
];

/**
 * The Combined sheet, as the revised template: the six method rows (blue
 * inputs: figure, low, value, high, weight), the weighted value, a weights
 * check, the weighted value per share, upside to the market price, and a
 * football-field chart (a stacked bar: an invisible "low" bar, then the
 * low → high range). `combined.rows` = [{ key, figureLabel, low, value, high, weight }].
 */
function writeCombinedSheet(ws, a, F, combined) {
  const byKey = Object.fromEntries((combined?.rows || []).map((r) => [r.key, r]));
  const sym = CURRENCIES[a.settings?.currency]?.symbol || '';
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 34;
  for (let i = 3; i <= 9; i++) ws.getColumn(i).width = 14;
  styleSheet(ws, { freezeRow: 5, tab: C_TAB_ANALYSIS, printTitles: '1:5' });
  put(ws, 'A1', { formula: 'Cover!B3' }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'A2', 'Combined Valuation — weighted value per share and football field', { bold: true, size: 12 });
  put(ws, 'A3', 'Copy each method\'s result in (blue = input). Weights must total 100%; leave a method blank with 0% weight to drop it.', { italic: true, color: C_MUTED });
  edge(ws, 3, colRun(1, 9), 'bottom', 'medium', C_HDR_FILL);
  ['Method', 'Figure used', 'Low', 'Value / share', 'High', 'Weight', 'Weighted value', 'Chart: low', 'Chart: range']
    .forEach((h, i) => put(ws, `${colL(1 + i)}5`, h, { bold: true, fill: C_SECTION_FILL, align: i > 1 ? 'center' : 'left' }));
  const blue = (fmt, extra = {}) => ({ fmt, color: C_INPUT, fill: C_INPUT_FILL, align: 'right', ...extra });
  COMBINED_ROWS.forEach((row, k) => {
    const r = 6 + k;
    const x = byKey[row.key];
    put(ws, `A${r}`, row.method);
    put(ws, `B${r}`, x?.figureLabel || row.figure, { color: C_INPUT, fill: C_INPUT_FILL });
    put(ws, `C${r}`, x ? nb(x.low) : null, blue(F.price));
    put(ws, `D${r}`, x ? nb(x.value) : null, blue(F.price, { bold: true }));
    put(ws, `E${r}`, x ? nb(x.high) : null, blue(F.price));
    put(ws, `F${r}`, x && Number.isFinite(x.weight) ? x.weight / 100 : null, blue(F.pct));
    put(ws, `G${r}`, { formula: `IF(AND(ISNUMBER(D${r}),ISNUMBER(F${r})),D${r}*F${r},"")` }, { fmt: F.price, align: 'right' });
    put(ws, `H${r}`, { formula: `IF(AND(ISNUMBER(C${r}),ISNUMBER(E${r})),MIN(C${r},E${r}),IF(ISNUMBER(D${r}),D${r},0))` }, { fmt: F.price, align: 'right', color: C_MUTED });
    put(ws, `I${r}`, { formula: `IF(AND(ISNUMBER(C${r}),ISNUMBER(E${r})),ABS(E${r}-C${r}),0)` }, { fmt: F.price, align: 'right', color: C_MUTED });
  });
  edge(ws, 11, colRun(1, 9), 'bottom', 'thin', C_HDR_FILL);
  put(ws, 'B13', 'Total weight (must be 100%)');
  put(ws, 'D13', { formula: 'SUM(F6:F11)' }, { fmt: F.pct, align: 'right' });
  put(ws, 'B14', 'Check');
  put(ws, 'D14', { formula: 'IF(ABS(D13-1)>0.0001,"Weights do not total 100%",IF(SUMPRODUCT((F6:F11>0)*NOT(ISNUMBER(D6:D11)))>0,"A weighted method has no value","OK"))' }, { align: 'right', italic: true });
  put(ws, 'B15', 'Weighted value per share', { bold: true });
  put(ws, 'D15', { formula: 'IF(D14="OK",SUM(G6:G11),"NA")' }, { fmt: F.price, align: 'right', bold: true, fill: C_GRID_FILL });
  put(ws, 'B16', 'Market price');
  put(ws, 'D16', nb(combined?.marketPrice), blue(F.price));
  put(ws, 'B17', 'Upside / (downside) to the market price');
  put(ws, 'D17', { formula: 'IFERROR(IF(D16>0,D15/D16-1,"NA"),"NA")' }, { fmt: F.pct, align: 'right' });
  put(ws, 'A19', 'Low / high are each method\'s own range (sensitivity grid, peer quartiles or ± 1 SE) – they drive the football field; the weighted value uses the chosen figures. Bank practice: weight the intrinsic (DCF) and market (comps) views most, precedents for control situations, and show the 52-week range and LBO for context.', { italic: true, color: C_MUTED, size: 9 });
  // the chart is added to the saved file (ExcelJS cannot draw charts): see xlsxCharts.js
  const q = `'${ws.name}'`;
  const chart = ({
    sheet: ws.name, row: 22, col: 0, cx: 6480000, cy: 2880000,
    title: `Football field – value per share (${sym})`, axisTitle: `${sym} per share`,
    cat: `${q}!$A$6:$A$11`,
    series: [
      { name: `${q}!H5`, val: `${q}!$H$6:$H$11`, fill: null },
      { name: `${q}!I5`, val: `${q}!$I$6:$I$11`, fill: '1F4FD8' },
    ],
  });
  return { value: `'${ws.name}'!$D$15`, chart };
}

/* ==================================================================== */
/*                               Builder                                */
/* ==================================================================== */

/**
 * Build one method's workbook.
 * methodId ∈ EXPORT_METHODS; opts = { skipped: { regression?, history? },
 * combined?: { rows: [{ method, figureLabel, value, low, high, weight }], marketPrice } }.
 */
export function buildWorkbook(a, methodId, opts = {}) {
  if (!EXPORT_METHODS.includes(methodId)) throw new Error(`Unknown method "${methodId}"`);
  const skipped = opts.skipped || {};
  // comps, precedent, the DCF and the LBO follow the user's template workbooks (their own sheet set, no cover)
  if (methodId === 'comps') return buildCompsWorkbook(a, { skipped });
  if (methodId === 'precedent') return buildPrecedentWorkbook(a);
  if (methodId === 'dcf') return buildDcfWorkbook(a);
  if (methodId === 'lbo') return buildLboWorkbook(a);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quant Value';
  wb.calcProperties = { fullCalcOnLoad: true };

  const sym = CURRENCIES[a.settings?.currency]?.symbol || '';
  const F = makeFormats(sym);
  const unit = a.settings?.unit || '';
  const meta = METHOD_META[methodId];

  /* ---- cover ---- */
  const cover = wb.addWorksheet('Cover');
  cover.getColumn(1).width = 3;
  cover.getColumn(2).width = 24;
  cover.getColumn(3).width = 80;
  styleSheet(cover, { tab: C_TAB_ANALYSIS, portrait: true });
  cover.getRow(3).height = 30;
  put(cover, 'B3', a.company?.name || 'Company', { bold: true, size: 20 });
  put(cover, 'B4', meta.label, { size: 14, color: C_INPUT });
  const horizon = PROJ.has(methodId) ? `, ${a.drivers.years}-year projection` : '';
  put(cover, 'B5', `(${sym} in ${unit}${horizon}${PROJ.has(methodId) ? `, fiscal year ending ${fyMonthName(a)}` : ''})`, { italic: true, color: C_MUTED });
  edge(cover, 6, colRun(2, 3), 'bottom', 'medium', C_HDR_FILL);
  put(cover, 'B7', `Prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Quant Value`, { color: C_MUTED });

  const unitNote = `(${sym} in ${unit}, except per share data)`;
  const projNote = `(${sym} in ${unit}, fiscal year ending ${fyMonthName(a)})`;
  let R = {};
  let order = ['Cover'];
  const contents = [];

  if (methodId === 'combined') {
    const ws = wb.addWorksheet('Combined');
    const { chart } = writeCombinedSheet(ws, a, F, opts.combined);
    wb.qvCharts = [chart];
    order.push('Combined');
    contents.push(['Combined', SHEET_NOTES.Combined]);
  } else {
    const inputs = wb.addWorksheet('Inputs');
    R = writeInputs(inputs, a, F, methodId, opts);
    order.push('Inputs');
    contents.push(['Inputs', SHEET_NOTES.Inputs]);
  }

  const ops = PROJ.has(methodId) ? projectOperations(a) : null;
  const histFor = (m) => (!skipped.history && (m === 'ts' || m === 'ratios') ? reportedHistory(a) : null);

  if (methodId === 'ipo' || methodId === 'ts' || methodId === 'ratios') {
    const projWs = wb.addWorksheet('Projection');
    const mode = methodId === 'ts' || methodId === 'ratios' ? 'fcff' : 'ops';
    const P = writeProjectionSheet(projWs, a, F, R, { unitNote: projNote, mode, ops, hist: histFor(methodId) });
    order.push('Projection');
    {
      const tsWs = wb.addWorksheet('3 Statement');
      const TS = writeThreeStatementSheet(tsWs, a, F, R, P, {
        balanceSheet: methodId !== 'ipo',
        ratios: methodId !== 'ipo',
        title: methodId === 'ratios' ? 'RATIO ANALYSIS — LINKED THREE-STATEMENT MODEL' : 'THREE-STATEMENT MODEL',
      });
      order.push('3 Statement');
      if (methodId === 'ipo') {
        writeIpoSheet(wb.addWorksheet('IPO'), a, F, R, P, TS);
        order.push('IPO');
      }
      if (methodId === 'ratios' && !skipped.history && hasHistory(a.history)) {
        const freq = a.ratio?.freq === 'Q' && a.history?.quarterly?.dates?.length ? 'Q' : 'Y';
        const periods = Number.isInteger(a.ratio?.histYears) ? a.ratio.histYears * (freq === 'Q' ? 4 : 1) : null;
        writePastRatiosSheet(wb.addWorksheet('Past Ratios'), a, F, { freq, periods, unitNote: `${sym} in ${unit}` });
        order.push('Past Ratios');
      }
    }
  }

  for (const name of order) if (SHEET_NOTES[name] && name !== 'Inputs' && name !== 'Combined') contents.push([name, SHEET_NOTES[name]]);

  /* ---- cover contents ---- */
  put(cover, 'B9', 'Contents', { bold: true });
  let cr = 10;
  for (const [name, note] of contents) {
    put(cover, `B${cr}`, name, { bold: true });
    put(cover, `C${cr}`, note, { color: 'FF555555', wrap: true });
    cr++;
  }
  cr++;
  put(cover, `B${cr++}`, 'Conventions: blue = input · black = formula · green = cross-sheet link · NA = not available (a blank input) · NM = not meaningful.', { italic: true, color: C_MUTED });
  cover.mergeCells(`B${cr - 1}:C${cr - 1}`);

  orderSheets(wb, order);
  return wb;
}

/** A built workbook as .xlsx bytes, with its charts (ExcelJS writes none: xlsxCharts.js adds them). */
export async function workbookBuffer(wb) {
  const buf = await wb.xlsx.writeBuffer();
  return wb.qvCharts?.length ? addCharts(buf, wb.qvCharts) : buf;
}

/** Build and download one method's workbook in the browser. */
export async function exportToExcel(a, methodId, opts = {}) {
  const wb = buildWorkbook(a, methodId, opts);
  const buf = await workbookBuffer(wb);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const aTag = document.createElement('a');
  aTag.href = url;
  const safeName = (a.company?.name || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'model';
  const suffix = METHOD_META[methodId].label.replace(/[^\w]+/g, '_');
  aTag.download = `${safeName}_${suffix}.xlsx`;
  document.body.appendChild(aTag);
  aTag.click();
  document.body.removeChild(aTag);
  URL.revokeObjectURL(url);
}
