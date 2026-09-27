import ExcelJS from 'exceljs';
import { CURRENCIES } from '../format.js';
import { METHOD_META } from '../../methods/labels.js';
import { projectOperations } from '../engine/drivers.js';
import { openingNol } from '../engine/tax.js';
import { otherNetAssetsOf } from '../engine/threeStatement.js';
import { hasHistory, reportedHistory } from '../historyModel.js';
import {
  put, colL, styleSheet, edge, colRun, makeFormats, nv, na,
  C_INPUT, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED, C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';
import { writeProjectionSheet } from './projectionSheet.js';
import { writeThreeStatementSheet, writePastRatiosSheet, writeIpoSheet } from './modelSheets.js';
import { buildCompsWorkbook, buildPrecedentWorkbook } from './templateWorkbooks.js';
import { buildDcfWorkbook } from './dcfWorkbook.js';
import { buildLboWorkbook } from './lboWorkbook.js';

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
  Combined: 'the chosen figure from each method, weighted into one value.',
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
  put(ws, `C${r}`, `Money in ${sym} ${a.settings.unit}. Blue cells are inputs — edit them and the file recalculates. NA = left blank.`, { italic: true, color: C_MUTED, wrap: true });
  edge(ws, r, colRun(1, 3), 'bottom', 'medium', C_HDR_FILL);
  r += 2;

  const at = () => `Inputs!$B$${r}`;
  const section = (t) => {
    for (let i = 1; i <= 3; i++) put(ws, `${colL(i)}${r}`, i === 1 ? t : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
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
  const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? x / 100 : 'NA');
  const txt = (x) => (x === null || x === undefined || x === '' ? '' : String(x));

  /* ---- company ---- */
  const c = a.company;
  section('COMPANY');
  inp('name', 'Company name', txt(c.name) || 'Company', undefined);
  inp('shares', `Diluted shares outstanding (${a.settings.unit})`, nv(c.sharesOut), F.shares, 'Same unit scale as the money figures');
  inp('curPrice', 'Current share price', nv(c.currentPrice), F.price, 'NA for a private company — the upside lines then read NA');
  inp('grossDebt', 'Gross debt', nv(c.grossDebt), F.money);
  inp('cash', 'Cash & equivalents', nv(c.cash), F.money);
  calc('netDebt', 'Net debt', na(`${R.grossDebt}-${R.cash}`), F.money, 'Gross debt less cash');
  if (PROJ.has(methodId)) {
    inp('tax', 'Tax rate', pct(c.taxRate), F.pct);
    inp('nol0', 'Opening tax-loss carryforward (NOL)', nv(openingNol(a)), F.money, 'Used against profits before any tax is paid');
  }
  r++;

  /* ---- operating forecast ---- */
  if (PROJ.has(methodId)) {
    const ops = projectOperations(a);
    const startYear = a.settings?.period?.startYear;
    section('OPERATING FORECAST');
    fixed('Projection years', a.drivers.years, F.int, 'Fixed at export — change the horizon in the app and export again');
    inp('baseYear', 'Base (LTM) fiscal year', Number.isFinite(startYear) ? startYear - 1 : 'NA', F.int, 'Year 0 — the LTM column');
    inp('rev0', 'LTM revenue', nv(ops.revenue0), F.money);
    inp('ebitda0', 'LTM EBITDA', nv(ops.ebitda0), F.money);
    inp('nwc0', 'Opening net working capital', nv(ops.nwc0), F.money, 'Year-0 NWC; the forecast years use the per-year NWC % of sales');
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
      inp('ppe0', 'Opening net PP&E', nv(a.ts.startingPPE), F.money);
      inp('equity0', "Opening shareholders' equity (reported)", Number.isFinite(ona) ? nv(equity0) : nv(a.ts.equity0), F.money);
      calc('ona', 'Other net assets / (liabilities)', na(`${R.equity0}-(${R.cash}+${R.nwc0}+${R.ppe0}-${R.grossDebt})`), F.money, 'The gap between reported equity and cash + NWC + PP&E − debt, held constant');
    }
    r++;
  }

  /* ---- IPO ---- */
  if (methodId === 'ipo') {
    const p = a.ipo;
    section('PRICING BASIS');
    inp('ipoBasis', 'Pricing basis ("pe" or "evEbitda")', p.basis === 'pe' || p.basis === 'evEbitda' ? p.basis : 'NA', undefined, 'P/E × Year-1 net income, or EV/EBITDA × Year-1 EBITDA');
    inp('offerPE', 'Offer P/E', p.basis === 'pe' ? nv(p.offerPE) : 'NA', F.x, p.basis === 'pe' ? '' : 'Not used on this basis');
    inp('offerEvE', 'Offer EV/EBITDA', p.basis === 'evEbitda' ? nv(p.offerEvEbitda) : 'NA', F.x, p.basis === 'evEbitda' ? '' : 'Not used on this basis');
    inp('ipoDisc', 'IPO discount to fair value', pct(p.ipoDiscount), F.pct);
    inp('ipoBand', 'Bookbuild band below the offer', pct(p.rangeBand), F.pct, 'Low end of the price range');
    r++;
    section('OFFER STRUCTURE');
    inp('ipoRaise', 'Primary raise (fresh capital)', nv(p.primaryRaise), F.money);
    inp('ipoSec', 'Secondary sale (% of existing shares)', pct(p.secondaryPct), F.pct, 'Proceeds go to the selling holders');
    inp('ipoGS', 'Greenshoe size (% of base deal)', pct(p.greenshoePct), F.pct);
    inp('ipoGSEx', 'Greenshoe exercised', pct(p.greenshoeExercisedPct), F.pct);
    inp('ipoGSType', 'Greenshoe shares ("primary" or "secondary")', p.greenshoeType === 'primary' || p.greenshoeType === 'secondary' ? p.greenshoeType : 'NA', undefined, 'primary = new shares; secondary = existing holders');
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
 * The Combined sheet: each included method's chosen figure with its low /
 * high (blue inputs, labelled with the source method), the weights, the
 * weighted value and the upside against the market price.
 */
function writeCombinedSheet(ws, a, F, combined) {
  const rows = combined?.rows || [];
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 44;
  for (let i = 3; i <= 7; i++) ws.getColumn(i).width = 15;
  styleSheet(ws, { freezeRow: 5, tab: C_TAB_ANALYSIS, printTitles: '1:5' });
  put(ws, 'A1', a.company?.name || 'Company', { bold: true, size: 16 });
  put(ws, 'A2', 'Combined Valuation — weighted value per share', { bold: true, size: 12 });
  put(ws, 'A3', 'Each figure is the result its method produced (blue = input: copy a new result in, or change a weight).', { italic: true, color: C_MUTED });
  edge(ws, 3, colRun(1, 7), 'bottom', 'medium', C_HDR_FILL);
  const hdr = ['Method', 'Figure', 'Low', 'Value / share', 'High', 'Weight', 'Weighted value'];
  hdr.forEach((h, i) => put(ws, `${colL(1 + i)}5`, h, { bold: true, fill: C_SECTION_FILL, align: i > 1 ? 'center' : 'left' }));
  let r = 6;
  const first = r;
  const blue = (fmt) => ({ fmt, color: C_INPUT, fill: C_INPUT_FILL, align: 'right' });
  for (const row of rows) {
    put(ws, `A${r}`, row.method);
    put(ws, `B${r}`, row.figureLabel);
    put(ws, `C${r}`, nv(row.low), blue(F.price));
    put(ws, `D${r}`, nv(row.value), { ...blue(F.price), bold: true });
    put(ws, `E${r}`, nv(row.high), blue(F.price));
    put(ws, `F${r}`, Number.isFinite(row.weight) ? row.weight / 100 : 'NA', blue(F.pct));
    put(ws, `G${r}`, { formula: na(`D${r}*F${r}`) }, { fmt: F.price, align: 'right' });
    r++;
  }
  const last = Math.max(first, r - 1);
  edge(ws, last, colRun(1, 7), 'bottom', 'thin', C_HDR_FILL);
  r++;
  const R = {};
  const kv = (key, label, value, fmt, opts = {}) => {
    put(ws, `B${r}`, label, { bold: !!opts.bold });
    put(ws, `D${r}`, value, { fmt, align: 'right', ...opts });
    R[key] = r++;
  };
  kv('wsum', 'Total weight (must be 100%)', { formula: rows.length ? `SUM(F${first}:F${last})` : '0' }, F.pct);
  kv('value', 'Weighted value per share', { formula: rows.length ? na(`IF(COUNT(D${first}:D${last},F${first}:F${last})=${2 * rows.length},SUMPRODUCT(D${first}:D${last},F${first}:F${last}),"NA")`) : '"NA"' }, F.price, { bold: true, fill: C_GRID_FILL });
  kv('px', 'Market price', nv(combined?.marketPrice), F.price, { color: C_INPUT, fill: C_INPUT_FILL });
  kv('upside', 'Upside / (downside) to the market price', { formula: na(`IF(D${r - 1}>0,D${r - 2}/D${r - 1}-1,"NA")`) }, F.pct);
  r++;
  put(ws, `A${r}`, 'Low / high are each method’s own range (grid, quartiles or ± 1 SE) — shown for the football field; the weighted value uses the chosen figures.', { italic: true, color: C_MUTED, size: 9 });
  return { value: `'${ws.name}'!$D$${R.value}` };
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
    writeCombinedSheet(ws, a, F, opts.combined);
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

/** Build and download one method's workbook in the browser. */
export async function exportToExcel(a, methodId, opts = {}) {
  const wb = buildWorkbook(a, methodId, opts);
  const buf = await wb.xlsx.writeBuffer();
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
