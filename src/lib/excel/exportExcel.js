import ExcelJS from 'exceljs';
import { CURRENCIES } from '../format.js';
import { METHOD_META } from '../../methods/labels.js';
import { projectOperations } from '../engine/drivers.js';
import { dcfReportedHistory } from '../engine/dcf.js';
import { openingNol } from '../engine/tax.js';
import { otherNetAssetsOf } from '../engine/threeStatement.js';
import { hasHistory } from '../historyModel.js';
import { SENS_DEFAULTS } from '../../store/methodModel.js';
import {
  put, colL, styleSheet, edge, colRun, makeFormats, nv, na,
  C_INPUT, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED, C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';
import { writeDcfSheet, writeDcfLower, writeWaccSheet } from './dcfSheets.js';
import { writeThreeStatementSheet, writePastRatiosSheet, writeLboSheet, writeIpoSheet } from './modelSheets.js';
import { buildCompsWorkbook, buildPrecedentWorkbook } from './templateWorkbooks.js';

/*
 * Live-formula Excel export — one file per method.
 * Each file = Cover + an Inputs sheet holding ONLY that method's inputs + its
 * calculation sheets. Conventions: blue font = input cell (edit these), black
 * = formula, green = cross-sheet link. A blank input is the text "NA", and
 * every figure built from it reads NA. The workbook recalculates on open and
 * reproduces the app's engines exactly (see the recalculation tests).
 */

export const EXPORT_METHODS = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'ts', 'ratios', 'combined'];

/** Fixed sheet names, reserved so a company or deal sheet can never take one. */
const RESERVED = ['Cover', 'Inputs', 'DCF', 'WACC', 'Projection', '3 Statement', 'LBO', 'IPO', 'Regression', 'Past Ratios', 'Combined'];

/** Methods whose Company step collects the tax rate and the opening NOL. */
const PROJ = new Set(['dcf', 'lbo', 'ipo', 'ts', 'ratios']);

const SHEET_NOTES = {
  Inputs: 'every input of this method (blue). Edit here and the whole file recalculates.',
  DCF: 'reported history, LTM and the projection; unlevered free cash flow, the valuation blocks, FCFE and sensitivity grids.',
  WACC: 'the CAPM + Hamada build, the peer beta reference table and the WACC surface.',
  Projection: 'the operating projection every other sheet links to.',
  '3 Statement': 'linked income statement, cash flow, balance sheet and debt & cash schedule.',
  LBO: 'sources & uses, the debt schedule and sweep, returns, the floor price and IRR grids.',
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
  const bool = (x) => (x === true ? true : x === false ? false : 'NA');
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
    put(ws, `C${r}`, `The blue per-year rows at the foot of the ${methodId === 'dcf' ? 'DCF' : 'Projection'} sheet`, { italic: true, color: C_MUTED });
    r += 2;
  }

  /* ---- cost of capital & DCF ---- */
  if (methodId === 'dcf') {
    const w = a.wacc;
    section('COST OF CAPITAL (CAPM + HAMADA)');
    inp('rf', 'Risk-free rate', pct(w.riskFree), F.pct);
    inp('erp', 'Equity risk premium', pct(w.erp), F.pct);
    inp('wd', 'Target debt weight D/(D+E)', pct(w.debtWeight), F.pct);
    calc('de', 'Target D/E', na(`${R.wd}/(1-${R.wd})`), F.num3);
    if (w.betaMode === 'direct') {
      inp('beta', 'Levered beta βL', nv(w.beta), F.num3, 'Entered directly');
      calc('bu', 'Unlevered (asset) beta βU', na(`${R.beta}/(1+(1-${R.tax})*${R.de})`), F.num3, 'Hamada inverse');
    } else {
      inp('bu', 'Unlevered (asset) beta βU', w.betaMode === 'hamada' ? nv(w.unleveredBeta) : 'NA', F.num3, 'Relevered below at the target D/E');
      calc('beta', 'Levered beta βL (Hamada)', na(`${R.bu}*(1+(1-${R.tax})*${R.de})`), F.num3, 'βL = βU × (1 + (1 − t) × D/E)');
    }
    inp('sizePrem', 'Size / company-specific premium', pct(w.sizePremium), F.pct);
    calc('coe', 'Cost of equity (CAPM)', na(`${R.rf}+${R.beta}*${R.erp}+${R.sizePrem}`), F.pct2, 'rf + βL × ERP + premium');
    inp('kd', 'Pre-tax cost of debt', pct(w.costDebt), F.pct);
    calc('katd', 'After-tax cost of debt', na(`${R.kd}*(1-${R.tax})`), F.pct2);
    calc('wacc', 'WACC', na(`(1-${R.wd})*${R.coe}+${R.wd}*${R.katd}`), F.pct2);
    r++;
    section('TERMINAL VALUE & DISCOUNTING');
    inp('tg', 'Terminal growth rate', pct(a.dcf.terminalGrowth), F.pct, 'Gordon growth — must be below the WACC (and the cost of equity for FCFE)');
    inp('dcfExitX', 'Exit EV/EBITDA multiple', nv(a.dcf.exitMultiple), F.x);
    inp('midYear', 'Mid-year convention (TRUE / FALSE)', bool(a.dcf.midYear), undefined, 'TRUE discounts each year at t − 0.5');
    inp(null, 'Headline terminal-value method', a.dcf.primaryTV === 'exit' ? 'Exit multiple' : a.dcf.primaryTV === 'gordon' ? 'Perpetuity growth' : 'NA', undefined, 'Display only — both methods are on the DCF sheet');
    r++;
    if (!skipped.fcfe) {
      section('FCFE FINANCING');
      inp('intDebt', 'Interest rate on debt', pct(a.ts.interestRateDebt), F.pct, 'On opening debt');
      inp('intCash', 'Interest earned on cash', pct(a.ts.interestRateCash), F.pct, 'On opening cash (3-statement net income for the exit P/E)');
      inp('repayPct', 'Mandatory debt repayment (% of opening)', pct(a.ts.debtRepayPct), F.pct, 'Negative net borrowing in FCFE');
      inp('payout', 'Dividend payout (% of net income)', pct(a.ts.dividendPayout), F.pct);
      inp('dcfExitPE', 'Exit P/E multiple (FCFE)', nv(a.dcf.exitPE), F.x);
      r++;
    }
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

  /* ---- LBO ---- */
  if (methodId === 'lbo') {
    const l = a.lbo;
    const n = a.drivers.years;
    const hasMezz = Number.isFinite(l.mezzX) && l.mezzX > 0;
    section('ENTRY & EXIT');
    inp('entryX', 'Entry EV / LTM EBITDA', nv(l.entryMultiple), F.x);
    inp('lboExitX', 'Exit EV / EBITDA', nv(l.exitMultiple), F.x);
    inp('exitYear', 'Exit year', Number.isFinite(l.exitYear) ? Math.min(Math.max(1, Math.round(l.exitYear)), n) : 'NA', F.int, `1 to ${n}`);
    inp('feesPct', 'Transaction fees (% of entry EV)', pct(l.feesPctEV), F.pct);
    inp('finFeesPct', 'Financing fees (% of new debt)', pct(l.finFeesPct), F.pct, 'Capitalised; amortised over the hold (non-cash, tax-deductible)');
    inp('cashAtClose', 'Cash left on the balance sheet at close', nv(l.cashAtClose === undefined ? 0 : l.cashAtClose), F.money, 'Funded at close as part of the uses');
    r++;
    section('DEBT STRUCTURE');
    inp('seniorX', 'Senior debt (x LTM EBITDA)', nv(l.seniorX), F.x);
    inp('seniorRate', 'Senior interest rate', pct(l.seniorRate), F.pct);
    inp('seniorAmort', 'Senior amortisation p.a. (% of original)', pct(l.seniorAmort), F.pct);
    inp('mezzX', 'Mezzanine debt (x LTM EBITDA)', nv(l.mezzX), F.x);
    inp('mezzRate', 'Mezzanine interest rate', hasMezz ? pct(l.mezzRate) : 'NA', F.pct, hasMezz ? '' : 'No mezzanine — not used');
    inp('mezzPIK', 'Mezzanine PIK (TRUE / FALSE)', hasMezz ? bool(l.mezzPIK) : false, undefined, hasMezz ? 'PIK interest accrues to the balance' : 'No mezzanine — not used');
    r++;
    section('CASH SWEEP & HURDLE');
    inp('sweepPct', 'Cash sweep (% of FCF after amortisation)', pct(l.sweepPct), F.pct, 'Senior first, then cash-pay mezzanine');
    inp('minCash', 'Minimum operating cash', nv(l.minCash), F.money, 'The sweep never takes cash below this');
    inp('hurdle', 'Sponsor IRR hurdle', pct(l.hurdleRate), F.pct, 'Sets the floor price');
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

  /* ---- sensitivity steps ---- */
  const step = (group, key) => {
    const g = a.sens?.[group];
    const v = g && g[key] !== undefined ? g[key] : SENS_DEFAULTS[group][key];
    return nv(v);
  };
  if (methodId === 'dcf') {
    section('SENSITIVITY GRID STEPS (each grid is base ± 1 and ± 2 steps)');
    inp('sWacc', 'WACC step (% points)', step('dcf', 'waccStep'), F.num);
    inp('sG', 'Terminal growth step (% points)', step('dcf', 'gStep'), F.num);
    inp('sMult', 'Exit multiple step (turns)', step('dcf', 'multStep'), F.num);
    if (!skipped.fcfe) inp('sCoe', 'Cost of equity step (% points)', step('dcf', 'coeStep'), F.num);
    inp('sWd', 'Debt weight step (% points, WACC surface)', step('wacc', 'wdStep'), F.num, 'Rows clamped to 0–90 %');
    inp('sKd', 'Cost of debt step (% points, WACC surface)', step('wacc', 'kdStep'), F.num);
  }
  if (methodId === 'lbo') {
    section('SENSITIVITY STEPS');
    inp('sEntry', 'Entry multiple step (turns)', step('lbo', 'entryStep'), F.num);
    inp('sExit', 'Exit multiple step (turns)', step('lbo', 'exitStep'), F.num);
    inp('sHurdle', 'Hurdle step for the floor range (% points)', step('lbo', 'hurdleStep'), F.num, 'Floor low / high = the price at hurdle ± this step');
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
 * methodId ∈ EXPORT_METHODS; opts = { skipped: { fcfe?, regression?, history? },
 * combined?: { rows: [{ method, figureLabel, value, low, high, weight }], marketPrice } }.
 */
export function buildWorkbook(a, methodId, opts = {}) {
  if (!EXPORT_METHODS.includes(methodId)) throw new Error(`Unknown method "${methodId}"`);
  const skipped = opts.skipped || {};
  // comps and precedent follow the user's template workbooks (their own sheet set, no cover)
  if (methodId === 'comps') return buildCompsWorkbook(a, { skipped });
  if (methodId === 'precedent') return buildPrecedentWorkbook(a);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quant Value';
  wb.calcProperties = { fullCalcOnLoad: true };

  const sym = CURRENCIES[a.settings?.currency]?.symbol || '';
  const F = makeFormats(sym);
  const unit = a.settings?.unit || '';
  const taken = new Set(RESERVED);
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
  const histFor = (m) => (!skipped.history && (m === 'dcf' || m === 'ts' || m === 'ratios') ? dcfReportedHistory(a) : null);

  if (methodId === 'dcf') {
    const dcfWs = wb.addWorksheet('DCF');
    const waccWs = wb.addWorksheet('WACC');
    const P = writeDcfSheet(dcfWs, a, F, R, { unitNote: projNote, mode: 'dcf', ops, hist: histFor('dcf') });
    writeDcfLower(dcfWs, a, F, R, P, { fcfe: !skipped.fcfe });
    writeWaccSheet(waccWs, a, F, R, { unitNote: `(${sym} in ${unit})` });
    order.push('DCF', 'WACC');
  }

  if (methodId === 'lbo' || methodId === 'ipo' || methodId === 'ts' || methodId === 'ratios') {
    const projWs = wb.addWorksheet('Projection');
    const mode = methodId === 'ts' || methodId === 'ratios' ? 'fcff' : 'ops';
    const P = writeDcfSheet(projWs, a, F, R, { unitNote: projNote, mode, ops, hist: histFor(methodId) });
    order.push('Projection');
    if (methodId === 'lbo') {
      writeLboSheet(wb.addWorksheet('LBO'), a, F, R, P);
      order.push('LBO');
    } else {
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
