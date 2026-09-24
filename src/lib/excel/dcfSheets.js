/**
 * Discounted cash flow and cost-of-capital pages, in the layout of the
 * Rosenbaum & Pearl (Investment Banking, 3E) "DCF" and "WACC" sheets:
 *
 *   DCF   — historical period + LTM + projection with CAGR columns, the
 *           unlevered free-cash-flow build, side-by-side output blocks
 *           (enterprise value / implied equity value & share price / terminal
 *           value cross-checks), the assumptions block the model reads from,
 *           2-up sensitivity grids, and the levered (FCFE) build beneath.
 *   WACC  — the CAPM + Hamada build, a comparable-companies unlevered beta
 *           table with mean / median and the relevered cross-check, and a
 *           capital-structure × cost-of-debt sensitivity grid.
 *
 * Deviations from the 3E template, all deliberate:
 *   - No COGS / SG&A split. The driver set carries an EBITDA margin, not a
 *     gross margin, so the walk shows one "operating costs" line rather than
 *     inventing a split (the same choice the comps pages make for gross profit).
 *   - Historical columns are BACK-CAST from the driver set, not reported; the
 *     period banner says so. The LTM column is the model's own Year 0, so LTM
 *     EBITDA agrees with the LBO entry multiple and the comps target.
 *   - Both terminal-value methods run side by side (perpetuity growth and exit
 *     multiple); 3E runs the exit multiple with an implied-growth cross-check.
 *   - The peer beta table is a blue input snapshot, so the standalone DCF file
 *     does not have to ship the comps company pages.
 *   - 3E's implied perpetuity growth ignores its own mid-year switch in one
 *     branch; here the terminal flow is grossed up by (1+WACC)^0.5 whenever
 *     mid-year is on, so the cross-check is consistent with the discounting.
 */
import {
  put, colL, colRun, na, styleSheet, edge,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED,
  C_RULE, C_TAB_ANALYSIS,
} from './xlsxUtil.js';
import { computeCompany } from '../engine/compsCo.js';
import { HIST_CLAMP } from '../engine/dcf.js';

/** Historical columns the DCF page carries, matching the 3E template. */
export const HIST_YEARS = 3;

/* ------------------------------------------------------------- primitives */

/** A navy banner across `span` columns starting at column index `c0`. */
function banner(ws, row, c0, span, text) {
  for (let i = 0; i < span; i++) {
    put(ws, `${colL(c0 + i)}${row}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: span > 1 ? 'center' : 'left' });
  }
  if (span > 1) ws.mergeCells(`${colL(c0)}${row}:${colL(c0 + span - 1)}${row}`);
  ws.getRow(row).height = 18;
}

/* ==================================================================== */
/*                              DCF sheet                               */
/* ==================================================================== */

/**
 * Write the DCF page. `R` holds the Assumptions-sheet references.
 * Returns the row map, column helpers and refs the other sheets link through.
 */
export function writeDcfSheet(ws, a, F, R, o) {
  const { unitNote, waccRef, coeRef } = o;
  const n = a.drivers.years;
  const H = HIST_YEARS;

  /* ---------------- column plan ----------------
     A gutter | B labels | historical × H | hist CAGR | LTM | projection × n | proj CAGR */
  const cHist = (i) => 3 + i;
  const cHCagr = 3 + H;
  const cLtm = 4 + H;
  const cProj = (i) => 5 + H + i;
  const cPCagr = 5 + H + n;
  const lastCol = cPCagr;

  const hc = (i) => colL(cHist(i));
  const hCagr = colL(cHCagr);
  const ltm = colL(cLtm);
  const yc = (i) => colL(cProj(i));
  const pCagr = colL(cPCagr);
  const allCols = colRun(2, lastCol);
  /** Every period column, oldest first: historicals, LTM, then the projection. */
  const periodCols = [...Array(H)].map((_, i) => hc(i)).concat([ltm], [...Array(n)].map((_, i) => yc(i)));
  /** The column immediately to the left of a period column (null for the oldest). */
  const priorCol = (c) => {
    const i = periodCols.indexOf(c);
    return i > 0 ? periodCols[i - 1] : null;
  };

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 42;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 13.5;
  ws.getColumn(cHCagr).width = 11;
  ws.getColumn(cPCagr).width = 11;
  styleSheet(ws, { freezeRow: 8, freezeCol: 2, tab: C_TAB_ANALYSIS, printTitles: '1:8' });

  /* ================= header ================= */
  put(ws, 'B1', { formula: R.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'Discounted Cash Flow Analysis', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  const R_BAND = 6, R_YEAR = 7, R_RULE = 8;
  banner(ws, R_BAND, 3, H, 'Historical Period — back-cast from the drivers');
  put(ws, `${hCagr}${R_BAND}`, 'CAGR', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
  put(ws, `${ltm}${R_BAND}`, 'LTM', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
  banner(ws, R_BAND, cProj(0), n, 'Projection Period');
  put(ws, `${pCagr}${R_BAND}`, 'CAGR', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });

  for (const c of allCols) put(ws, `${c}${R_YEAR}`, '', { fill: C_SECTION_FILL });
  for (let i = 0; i < H; i++) {
    put(ws, `${hc(i)}${R_YEAR}`, { formula: `${R.baseYear}-${H - i}` }, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL });
  }
  put(ws, `${hCagr}${R_YEAR}`, `'${String(H)}-yr`, { italic: true, align: 'center', fill: C_SECTION_FILL, size: 10 });
  put(ws, `${ltm}${R_YEAR}`, { formula: `${R.baseYear}` }, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL });
  for (let i = 0; i < n; i++) {
    put(ws, `${yc(i)}${R_YEAR}`, { formula: `${R.baseYear}+${i + 1}` }, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL });
  }
  put(ws, `${pCagr}${R_YEAR}`, `'${String(n)}-yr`, { italic: true, align: 'center', fill: C_SECTION_FILL, size: 10 });
  ws.getRow(R_YEAR).height = 16;
  ws.getRow(R_RULE).height = 4;
  edge(ws, R_RULE, allCols, 'bottom', 'medium', C_HDR_FILL);

  /* ================= pass 1: lay out every row ================= */
  const D = {};
  let r = 10;
  const row = (key) => (D[key] = r++);
  const skip = (k = 1) => { r += k; };

  row('sales'); row('growth'); row('opex'); row('ebitda'); row('margin');
  row('da'); row('ebit'); row('ebitMargin'); row('taxes'); row('ebiat');
  skip();
  row('daBack'); row('capex'); row('nwc'); row('dnwc');
  skip();
  row('fcff'); row('wacc'); row('period'); row('df'); row('pv'); row('cumPv');
  skip(2);

  // two side-by-side output blocks: enterprise value | implied equity value
  const OUT = r;
  const outRow = (i) => OUT + i;
  skip(13);
  skip(1);
  // two side-by-side cross-check blocks
  const CHK = r;
  const chkRow = (i) => CHK + i;
  skip(8);
  skip(1);

  // assumptions — the blue projection inputs the whole model reads
  row('asmHdr');
  row('aGrowth'); row('aMargin'); row('aDa'); row('aCapex'); row('aNwc'); row('aTax');
  skip(2);

  /* ================= pass 2: labels ================= */
  const LABELS = [
    ['sales', 'Sales', { bold: true }],
    ['growth', '   % growth', { italic: true, color: C_MUTED }],
    ['opex', 'Less: Operating costs (COGS + SG&A)'],
    ['ebitda', 'EBITDA', { bold: true }],
    ['margin', '   % margin', { italic: true, color: C_MUTED }],
    ['da', 'Less: Depreciation & Amortization'],
    ['ebit', 'EBIT', { bold: true }],
    ['ebitMargin', '   % margin', { italic: true, color: C_MUTED }],
    ['taxes', 'Less: Taxes'],
    ['ebiat', 'EBIAT', { bold: true }],
    ['daBack', 'Plus: Depreciation & Amortization'],
    ['capex', 'Less: Capital Expenditures'],
    ['nwc', 'Memo: Net working capital', { italic: true, color: C_MUTED }],
    ['dnwc', 'Less: Inc./(Dec.) in Net Working Capital'],
    ['fcff', 'Unlevered Free Cash Flow', { bold: true }],
    ['wacc', '   WACC', { italic: true }],
    ['period', '   Discount Period', { italic: true }],
    ['df', '   Discount Factor', { italic: true }],
    ['pv', '   Present Value of Free Cash Flow', { bold: true }],
    ['cumPv', '   Cumulative Present Value of FCF', { italic: true, color: C_MUTED }],
  ];
  for (const [key, label, opts = {}] of LABELS) put(ws, `B${D[key]}`, label, opts);

  /* ================= pass 2: income statement ================= */
  // Sales — LTM is the base year; historicals chain backwards off each year's
  // own growth; the projection compounds forward off the assumption row.
  put(ws, `${ltm}${D.sales}`, { formula: R.rev0 }, { fmt: F.aTotal, bold: true, color: C_LINK });
  for (let i = H - 1; i >= 0; i--) {
    const next = i === H - 1 ? ltm : hc(i + 1);
    put(ws, `${hc(i)}${D.sales}`, { formula: `${next}${D.sales}/(1+${next}${D.aGrowth})` }, { fmt: F.aTotal, bold: true });
  }
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? ltm : yc(i - 1);
    put(ws, `${yc(i)}${D.sales}`, { formula: `${prev}${D.sales}*(1+${yc(i)}${D.aGrowth})` }, { fmt: F.aTotal, bold: true });
  }

  // derived % growth under the sales line
  for (const c of periodCols) {
    const p = priorCol(c);
    if (!p) continue;
    put(ws, `${c}${D.growth}`, { formula: na(`${c}${D.sales}/${p}${D.sales}-1`) }, { fmt: F.aPct, italic: true, color: C_MUTED });
  }

  const each = (key, f, fmt, opts = {}) => {
    for (const c of periodCols) {
      const fml = f(c);
      if (fml) put(ws, `${c}${D[key]}`, { formula: fml }, { fmt, ...opts });
    }
  };

  each('opex', (c) => `${c}${D.sales}-${c}${D.ebitda}`, F.aItem);
  each('ebitda', (c) => `${c}${D.sales}*${c}${D.aMargin}`, F.aTotal, { bold: true, top: true });
  each('margin', (c) => na(`${c}${D.ebitda}/${c}${D.sales}`), F.aPct, { italic: true, color: C_MUTED });
  each('da', (c) => `${c}${D.sales}*${c}${D.aDa}`, F.aItem);
  each('ebit', (c) => `${c}${D.ebitda}-${c}${D.da}`, F.aTotal, { bold: true, top: true });
  each('ebitMargin', (c) => na(`${c}${D.ebit}/${c}${D.sales}`), F.aPct, { italic: true, color: C_MUTED });
  each('taxes', (c) => `${c}${D.ebit}*${c}${D.aTax}`, F.aItem);
  each('ebiat', (c) => `${c}${D.ebit}-${c}${D.taxes}`, F.aTotal, { bold: true, top: true });

  // CAGR columns on the headline lines
  for (const key of ['sales', 'ebitda', 'ebit', 'ebiat']) {
    put(ws, `${hCagr}${D[key]}`, { formula: na(`(${ltm}${D[key]}/${hc(0)}${D[key]})^(1/${H})-1`) }, { fmt: F.aPct, italic: true, color: C_MUTED });
    put(ws, `${pCagr}${D[key]}`, { formula: na(`(${yc(n - 1)}${D[key]}/${ltm}${D[key]})^(1/${n})-1`) }, { fmt: F.aPct, italic: true, color: C_MUTED });
  }

  /* ================= free cash flow ================= */
  // 3E convention: outflows carry their sign, so the build reads as a sum.
  each('daBack', (c) => `${c}${D.da}`, F.aItem);
  each('capex', (c) => `-(${c}${D.sales}*${c}${D.aCapex})`, F.aItem);
  each('nwc', (c) => `${c}${D.sales}*${c}${D.aNwc}`, F.aItem, { italic: true, color: C_MUTED });
  for (const c of periodCols) {
    const p = priorCol(c);
    if (!p) continue;
    put(ws, `${c}${D.dnwc}`, { formula: `-(${c}${D.nwc}-${p}${D.nwc})` }, { fmt: F.aItem });
  }

  for (let i = 0; i < n; i++) {
    const c = yc(i);
    put(ws, `${c}${D.fcff}`, { formula: `${c}${D.ebiat}+${c}${D.daBack}+${c}${D.capex}+${c}${D.dnwc}` }, { fmt: F.aTotal, bold: true, top: true });
    put(ws, `${c}${D.period}`, { formula: `${c}$${R_YEAR}-${ltm}$${R_YEAR}-IF(${R.midYear},0.5,0)` }, { fmt: F.aFactor, italic: true });
    put(ws, `${c}${D.df}`, { formula: `1/((1+${waccRef})^${c}${D.period})` }, { fmt: F.aFactor, italic: true });
    put(ws, `${c}${D.pv}`, { formula: `${c}${D.fcff}*${c}${D.df}` }, { fmt: F.aTotal, bold: true });
    put(ws, `${c}${D.cumPv}`, { formula: i === 0 ? `${c}${D.pv}` : `${yc(i - 1)}${D.cumPv}+${c}${D.pv}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
  }
  put(ws, `${ltm}${D.wacc}`, { formula: waccRef }, { fmt: F.aPct2, italic: true, color: C_LINK });
  put(ws, `${pCagr}${D.fcff}`, { formula: na(`(${yc(n - 1)}${D.fcff}/${yc(0)}${D.fcff})^(1/${n - 1})-1`) }, { fmt: F.aPct, italic: true, color: C_MUTED });

  /* ================= assumptions block ================= */
  banner(ws, D.asmHdr, 2, 2, 'Assumptions');
  const clampF = (expr, lo, hi) => `MIN(${hi},MAX(${lo},${expr}))`;
  const g1 = `${yc(0)}${D.aGrowth}`;
  const gSlope = n > 1 ? `(${yc(0)}${D.aGrowth}-${yc(1)}${D.aGrowth})` : '0';
  const m1 = `${yc(0)}${D.aMargin}`;
  const mSlope = n > 1 ? `(${yc(0)}${D.aMargin}-${yc(1)}${D.aMargin})` : '0';

  const asm = [
    ['aGrowth', 'Sales (% growth)'],
    ['aMargin', 'EBITDA margin (% sales)'],
    ['aDa', 'Depreciation & amortization (% sales)'],
    ['aCapex', 'Capital expenditures (% sales)'],
    ['aNwc', 'Net working capital (% sales)'],
    ['aTax', 'Tax rate'],
  ];
  for (const [key, label] of asm) put(ws, `B${D[key]}`, label);

  // historical + LTM cells are derived; projection cells are the blue inputs
  for (let i = 0; i < H; i++) {
    const d = H - i;   // distance back from the LTM year
    put(ws, `${hc(i)}${D.aGrowth}`, { formula: clampF(`${g1}+${gSlope}*${d + 1}`, HIST_CLAMP.growthLo / 100, HIST_CLAMP.growthHi / 100) }, { fmt: F.aPct });
    put(ws, `${hc(i)}${D.aMargin}`, { formula: clampF(`${m1}+${mSlope}*${d + 1}`, HIST_CLAMP.marginLo / 100, HIST_CLAMP.marginHi / 100) }, { fmt: F.aPct });
  }
  put(ws, `${ltm}${D.aGrowth}`, { formula: clampF(`${g1}+${gSlope}*1`, HIST_CLAMP.growthLo / 100, HIST_CLAMP.growthHi / 100) }, { fmt: F.aPct });
  put(ws, `${ltm}${D.aMargin}`, { formula: m1 }, { fmt: F.aPct });
  for (const c of [...[...Array(H)].map((_, i) => hc(i)), ltm]) {
    put(ws, `${c}${D.aDa}`, { formula: `${yc(0)}${D.aDa}` }, { fmt: F.aPct });
    put(ws, `${c}${D.aCapex}`, { formula: `${yc(0)}${D.aCapex}` }, { fmt: F.aPct });
    put(ws, `${c}${D.aNwc}`, { formula: R.nwcPct }, { fmt: F.aPct });
  }
  for (const c of periodCols) put(ws, `${c}${D.aTax}`, { formula: R.tax }, { fmt: F.aPct });

  const opsX = o.ops;
  for (let i = 0; i < n; i++) {
    const c = yc(i);
    const blue = { fmt: F.aPct, color: C_INPUT, fill: 'FFF5F9FF' };
    put(ws, `${c}${D.aGrowth}`, opsX.growth[i] / 100, blue);
    put(ws, `${c}${D.aMargin}`, opsX.margin[i] / 100, blue);
    put(ws, `${c}${D.aDa}`, opsX.da[i] / opsX.revenue[i], blue);
    put(ws, `${c}${D.aCapex}`, opsX.capex[i] / opsX.revenue[i], blue);
    put(ws, `${c}${D.aNwc}`, opsX.nwcBalance[i] / opsX.revenue[i], blue);
  }
  put(ws, `B${D.asmHdr + 7}`, 'Blue cells are the model inputs. Historical and LTM columns are derived: growth and margin are the Year-1 rates extended backwards, D&A / capex / NWC hold their Year-1 revenue rates.', { italic: true, color: C_MUTED, size: 9 });

  /* ================= output blocks ================= */
  const evCol = colL(4), exCol = colL(5);        // D, E — perpetuity growth | exit multiple
  const eqLbl = 7, eqA = colL(9), eqB = colL(10);  // G labels, I / J values

  banner(ws, OUT, 2, 4, 'Enterprise Value');
  banner(ws, OUT, eqLbl, 4, 'Implied Equity Value and Share Price');
  put(ws, `${evCol}${outRow(1)}`, 'Perpetuity Growth', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  put(ws, `${exCol}${outRow(1)}`, 'Exit Multiple', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  put(ws, `${eqA}${outRow(1)}`, 'Perpetuity Growth', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  put(ws, `${eqB}${outRow(1)}`, 'Exit Multiple', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  ws.getRow(outRow(1)).height = 26;

  const evL = (i, text, opts = {}) => put(ws, `B${outRow(i)}`, text, opts);
  const evV = (i, fa, fb, fmt, opts = {}) => {
    if (fa) put(ws, `${evCol}${outRow(i)}`, { formula: fa }, { fmt, ...opts });
    if (fb) put(ws, `${exCol}${outRow(i)}`, { formula: fb }, { fmt, ...opts });
  };
  const cumPvN = `$${yc(n - 1)}$${D.cumPv}`;
  const fcffN = `$${yc(n - 1)}$${D.fcff}`;
  const ebitdaN = `$${yc(n - 1)}$${D.ebitda}`;
  const periodN = `$${yc(n - 1)}$${D.period}`;
  const yearsN = `(${yc(n - 1)}$${R_YEAR}-${ltm}$${R_YEAR})`;

  evL(2, 'Cumulative Present Value of FCF');
  evV(2, cumPvN, cumPvN, F.aItem);
  evL(3, 'Terminal-Year Free Cash Flow', { italic: true, color: C_MUTED });
  evV(3, fcffN, null, F.aItem, { italic: true, color: C_MUTED });
  evL(4, 'Perpetuity Growth Rate', { italic: true, color: C_MUTED });
  evV(4, R.tg, null, F.aPct, { italic: true, color: C_MUTED });
  evL(5, 'Terminal-Year EBITDA', { italic: true, color: C_MUTED });
  evV(5, null, ebitdaN, F.aItem, { italic: true, color: C_MUTED });
  evL(6, 'Exit Multiple', { italic: true, color: C_MUTED });
  evV(6, null, R.dcfExitX, F.aX, { italic: true, color: C_MUTED });
  evL(7, 'Terminal Value', { bold: true });
  evV(7, `${fcffN}*(1+${R.tg})/(${waccRef}-${R.tg})`, `${R.dcfExitX}*${ebitdaN}`, F.aTotal, { bold: true, top: true });
  evL(8, 'Discount Factor');
  evV(8, `1/((1+${waccRef})^${periodN})`, `1/((1+${waccRef})^${yearsN})`, F.aFactor);
  evL(9, 'Present Value of Terminal Value', { bold: true });
  evV(9, `${evCol}${outRow(7)}*${evCol}${outRow(8)}`, `${exCol}${outRow(7)}*${exCol}${outRow(8)}`, F.aTotal, { bold: true });
  evL(10, '   % of Enterprise Value', { italic: true, color: C_MUTED });
  evV(10, na(`${evCol}${outRow(9)}/${evCol}${outRow(11)}`), na(`${exCol}${outRow(9)}/${exCol}${outRow(11)}`), F.aPct, { italic: true, color: C_MUTED });
  evL(11, 'Enterprise Value', { bold: true });
  evV(11, `${evCol}${outRow(2)}+${evCol}${outRow(9)}`, `${exCol}${outRow(2)}+${exCol}${outRow(9)}`, F.aTotal, { bold: true, top: true, bottom: 'double' });

  const eqL = (i, text, opts = {}) => put(ws, `${colL(eqLbl)}${outRow(i)}`, text, opts);
  const eqV = (i, f, fmt, opts = {}) => {
    put(ws, `${eqA}${outRow(i)}`, { formula: f(evCol) }, { fmt, ...opts });
    put(ws, `${eqB}${outRow(i)}`, { formula: f(exCol) }, { fmt, ...opts });
  };
  eqL(2, 'Enterprise Value');
  eqV(2, (c) => `${c}${outRow(11)}`, F.aItem);
  eqL(3, 'Less: Total Debt');
  eqV(3, () => `-${R.grossDebt}`, F.aItem);
  eqL(4, 'Less: Preferred Stock');
  put(ws, `${eqA}${outRow(4)}`, 0, { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF' });
  put(ws, `${eqB}${outRow(4)}`, 0, { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF' });
  eqL(5, 'Less: Noncontrolling Interest');
  put(ws, `${eqA}${outRow(5)}`, 0, { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF' });
  put(ws, `${eqB}${outRow(5)}`, 0, { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF' });
  eqL(6, 'Plus: Cash and Cash Equivalents');
  eqV(6, () => R.cash, F.aItem);
  eqL(7, 'Implied Equity Value', { bold: true });
  eqV(7, (c) => `SUM(${c === evCol ? eqA : eqB}${outRow(2)}:${c === evCol ? eqA : eqB}${outRow(6)})`, F.aTotal, { bold: true, top: true });
  eqL(8, 'Fully Diluted Shares Outstanding');
  eqV(8, () => R.shares, F.aShares);
  eqL(9, 'Implied Share Price', { bold: true });
  eqV(9, (c) => na(`${c === evCol ? eqA : eqB}${outRow(7)}/${c === evCol ? eqA : eqB}${outRow(8)}`), F.aPrice, { bold: true, top: true, bottom: 'double' });
  eqL(10, 'Premium / (Discount) to Current Price', { italic: true, color: C_MUTED });
  eqV(10, (c) => na(`${c === evCol ? eqA : eqB}${outRow(9)}/${R.curPrice}-1`), F.aPct, { italic: true, color: C_MUTED });
  eqL(11, 'Current Share Price', { italic: true, color: C_MUTED });
  eqV(11, () => R.curPrice, F.aPrice, { italic: true, color: C_MUTED });

  /* ================= cross-checks ================= */
  banner(ws, CHK, 2, 4, 'Terminal Value Cross-Checks');
  banner(ws, CHK, eqLbl, 4, 'Implied Valuation Multiples');
  const ckL = (i, t, opts = {}) => put(ws, `B${chkRow(i)}`, t, opts);
  const ckV = (i, f, fmt, opts = {}) => put(ws, `${exCol}${chkRow(i)}`, { formula: f }, { fmt, ...opts });
  // mid-year: the terminal flow is grossed up before it is capitalised
  const fcffTerm = `(${fcffN}*(1+${waccRef})^IF(${R.midYear},0.5,0))`;
  ckL(1, 'Perpetuity growth TV → implied exit EV/EBITDA');
  ckV(1, na(`${evCol}${outRow(7)}/${ebitdaN}`), F.aX2, { bold: true });
  ckL(2, '   vs the exit-multiple assumption', { italic: true, color: C_MUTED });
  ckV(2, R.dcfExitX, F.aX2, { italic: true, color: C_MUTED });
  ckL(3, 'Exit-multiple TV → implied perpetuity growth');
  ckV(3, na(`(${exCol}${outRow(7)}*${waccRef}-${fcffTerm})/(${exCol}${outRow(7)}+${fcffTerm})`), F.aPct2, { bold: true });
  ckL(4, '   vs the terminal-growth assumption', { italic: true, color: C_MUTED });
  ckV(4, R.tg, F.aPct2, { italic: true, color: C_MUTED });
  ckL(5, 'The two terminal values should roughly agree.', { italic: true, color: C_MUTED, size: 9 });

  const mL = (i, t, opts = {}) => put(ws, `${colL(eqLbl)}${chkRow(i)}`, t, opts);
  const mV = (i, f, fmt, opts = {}) => put(ws, `${eqB}${chkRow(i)}`, { formula: f }, { fmt, ...opts });
  mL(1, 'Enterprise Value (exit multiple)');
  mV(1, `${exCol}${outRow(11)}`, F.aItem);
  mL(2, 'LTM EBITDA');
  mV(2, `${ltm}${D.ebitda}`, F.aItem);
  mL(3, 'Implied EV / LTM EBITDA', { bold: true });
  mV(3, na(`${eqB}${chkRow(1)}/${eqB}${chkRow(2)}`), F.aX2, { bold: true });
  mL(4, 'LTM Sales');
  mV(4, `${ltm}${D.sales}`, F.aItem);
  mL(5, 'Implied EV / LTM Sales', { bold: true });
  mV(5, na(`${eqB}${chkRow(1)}/${eqB}${chkRow(4)}`), F.aX2, { bold: true });

  const dcfRefs = {
    priceGordon: `'DCF'!$${eqA}$${outRow(9)}`,
    priceExit: `'DCF'!$${eqB}$${outRow(9)}`,
    evGordon: `'DCF'!$${evCol}$${outRow(11)}`,
    evExit: `'DCF'!$${exCol}$${outRow(11)}`,
    ebitda0: `'DCF'!$${ltm}$${D.ebitda}`,
    sales0: `'DCF'!$${ltm}$${D.sales}`,
  };

  return {
    D, yc, hc, ltm, hCagr, pCagr, lastCol, allCols, periodCols, priorCol,
    H, n, R_YEAR, nextRow: r, dcfRefs, evCol, exCol, eqA, eqB, outRow, chkRow,
  };
}

/* ==================================================================== */
/*                DCF sheet — levered build & sensitivities             */
/* ==================================================================== */

/**
 * The second half of the DCF page: the levered (FCFE) build and its valuation,
 * then the sensitivity grids laid out two across.
 * Returns the FCFE refs and the grid ranges the Summary football field spans.
 */
export function writeDcfLower(ws, a, F, R, P, o) {
  const { waccRef, coeRef } = o;
  const { D, yc, ltm, n, R_YEAR, allCols } = P;
  let r = P.nextRow;

  /* ================= levered free cash flow ================= */
  banner(ws, r, 2, P.lastCol - 1, 'Levered Free Cash Flow (FCFE) — discounted at the cost of equity');
  r += 2;

  const L = {};
  const line = (key, label, opts = {}) => { L[key] = r; put(ws, `B${r}`, label, opts); r++; };
  line('openDebt', 'Opening debt', { italic: true, color: C_MUTED });
  line('interest', 'Interest expense (on opening debt)');
  line('repay', 'Mandatory repayment (= − net borrowing)');
  line('openCash', 'Opening cash', { italic: true, color: C_MUTED });
  line('intInc', 'Interest income (on opening cash)', { italic: true, color: C_MUTED });
  line('ni', 'Net income (3-statement basis — for the exit P/E)', { italic: true, color: C_MUTED });
  line('div', 'Memo: dividends (payout × net income)', { italic: true, color: C_MUTED });
  line('closeCash', 'Closing cash (retained)', { italic: true, color: C_MUTED });
  line('fcfe', 'Free Cash Flow to Equity', { bold: true, top: true });
  line('dfE', '   Discount Factor @ cost of equity', { italic: true });
  line('pvE', '   Present Value of FCFE', { bold: true });

  for (let i = 0; i < n; i++) {
    const c = yc(i);
    const pd = i === 0 ? null : yc(i - 1);
    put(ws, `${c}${L.openDebt}`, { formula: i === 0 ? R.grossDebt : `${pd}${L.openDebt}*(1-${R.repayPct})` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    put(ws, `${c}${L.interest}`, { formula: `${c}${L.openDebt}*${R.intDebt}` }, { fmt: F.aItem });
    put(ws, `${c}${L.repay}`, { formula: `${c}${L.openDebt}*${R.repayPct}` }, { fmt: F.aItem });
    put(ws, `${c}${L.openCash}`, { formula: i === 0 ? R.cash : `${pd}${L.closeCash}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    put(ws, `${c}${L.intInc}`, { formula: `${c}${L.openCash}*${R.intCash}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    const ebt = `(${c}${D.ebit}-${c}${L.interest}+${c}${L.intInc})`;
    put(ws, `${c}${L.ni}`, { formula: `${ebt}-MAX(0,${ebt})*${R.tax}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    put(ws, `${c}${L.div}`, { formula: `MAX(0,${c}${L.ni})*${R.payout}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    put(ws, `${c}${L.closeCash}`, { formula: `${c}${L.openCash}+${c}${L.ni}+${c}${D.da}+${c}${D.dnwc}+${c}${D.capex}-${c}${L.repay}-${c}${L.div}` }, { fmt: F.aItem, italic: true, color: C_MUTED });
    put(ws, `${c}${L.fcfe}`, { formula: `${c}${D.fcff}-${c}${L.interest}*(1-${R.tax})-${c}${L.repay}` }, { fmt: F.aTotal, bold: true, top: true });
    put(ws, `${c}${L.dfE}`, { formula: `1/((1+${coeRef})^${c}${D.period})` }, { fmt: F.aFactor, italic: true });
    put(ws, `${c}${L.pvE}`, { formula: `${c}${L.fcfe}*${c}${L.dfE}` }, { fmt: F.aTotal, bold: true });
  }
  r += 1;

  /* ---- FCFE valuation, two methods side by side ---- */
  const gCol = colL(4), pCol = colL(5);
  const OUT = r;
  banner(ws, OUT, 2, 4, 'Implied Equity Value — Levered');
  put(ws, `${gCol}${OUT + 1}`, 'Perpetuity Growth', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  put(ws, `${pCol}${OUT + 1}`, 'Exit P / E', { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  ws.getRow(OUT + 1).height = 26;
  const fL = (i, t, opts = {}) => put(ws, `B${OUT + i}`, t, opts);
  const fV = (i, fa, fb, fmt, opts = {}) => {
    if (fa) put(ws, `${gCol}${OUT + i}`, { formula: fa }, { fmt, ...opts });
    if (fb) put(ws, `${pCol}${OUT + i}`, { formula: fb }, { fmt, ...opts });
  };
  const sumPvE = `SUM(${yc(0)}${L.pvE}:${yc(n - 1)}${L.pvE})`;
  const fcfeN = `$${yc(n - 1)}$${L.fcfe}`;
  const niN = `$${yc(n - 1)}$${L.ni}`;
  const periodN = `$${yc(n - 1)}$${D.period}`;
  const yearsN = `(${yc(n - 1)}$${R_YEAR}-${ltm}$${R_YEAR})`;

  fL(2, 'Sum of Present Value of FCFE');
  fV(2, sumPvE, sumPvE, F.aItem);
  fL(3, 'Terminal Value');
  fV(3, `${fcfeN}*(1+${R.tg})/(${coeRef}-${R.tg})`, `${R.dcfExitPE}*${niN}`, F.aItem);
  fL(4, 'Discount Factor');
  fV(4, `1/((1+${coeRef})^${periodN})`, `1/((1+${coeRef})^${yearsN})`, F.aFactor);
  fL(5, 'Present Value of Terminal Value');
  fV(5, `${gCol}${OUT + 3}*${gCol}${OUT + 4}`, `${pCol}${OUT + 3}*${pCol}${OUT + 4}`, F.aItem);
  fL(6, 'Implied Equity Value', { bold: true });
  fV(6, `${gCol}${OUT + 2}+${gCol}${OUT + 5}`, `${pCol}${OUT + 2}+${pCol}${OUT + 5}`, F.aTotal, { bold: true, top: true });
  fL(7, 'Fully Diluted Shares Outstanding');
  fV(7, R.shares, R.shares, F.aShares);
  fL(8, 'Implied Share Price', { bold: true });
  fV(8, na(`${gCol}${OUT + 6}/${gCol}${OUT + 7}`), na(`${pCol}${OUT + 6}/${pCol}${OUT + 7}`), F.aPrice, { bold: true, top: true, bottom: 'double' });
  const fcfeRefs = {
    priceFcfe: `'DCF'!$${gCol}$${OUT + 8}`,
    priceFcfePE: `'DCF'!$${pCol}$${OUT + 8}`,
  };
  r = OUT + 10;

  /* ================= sensitivity grids, two across ================= */
  const OFF_W = [-0.01, -0.005, 0, 0.005, 0.01];
  const OFF_X = [-2, -1, 0, 1, 2];
  const OFF_G = [-0.01, -0.005, 0, 0.005, 0.01];

  /**
   * One 5×5 grid. `left` picks the column block: labels at B (values C..G) or
   * labels at I (values J..N), so two grids sit side by side on the page.
   */
  const grid = (row, left, title, corner, rowRef, rowOffs, rowFmt, colOffs, colFmt, colRef, cell) => {
    const c0 = left ? 2 : 9;
    banner(ws, row, c0, 6, title);
    const top = row + 1;
    put(ws, `${colL(c0)}${top}`, corner, { italic: true, align: 'center', fill: C_SECTION_FILL });
    colOffs.forEach((off, j) => put(ws, `${colL(c0 + 1 + j)}${top}`, { formula: `${colRef}+${off}` },
      { fmt: colFmt, bold: true, align: 'center', fill: C_SECTION_FILL }));
    rowOffs.forEach((off, i) => {
      const rr = top + 1 + i;
      put(ws, `${colL(c0)}${rr}`, { formula: `${rowRef}+${off}` }, { fmt: rowFmt, bold: true, fill: C_SECTION_FILL });
      colOffs.forEach((_, j) => {
        const rRef = `$${colL(c0)}${rr}`, cRef = `${colL(c0 + 1 + j)}$${top}`;
        put(ws, `${colL(c0 + 1 + j)}${rr}`, { formula: cell(rRef, cRef) }, { fmt: colFmt === F.aX ? F.aPrice : F.aPrice, fill: C_GRID_FILL });
      });
    });
    return { top, range: `'DCF'!$${colL(c0 + 1)}$${top + 1}:$${colL(c0 + 5)}$${top + 5}` };
  };

  const fcffRange = `$${yc(0)}$${D.fcff}:$${yc(n - 1)}$${D.fcff}`;
  const fcfeRange = `$${yc(0)}$${L.fcfe}:$${yc(n - 1)}$${L.fcfe}`;
  const periodRange = `$${yc(0)}$${D.period}:$${yc(n - 1)}$${D.period}`;
  const fcffN = `$${yc(n - 1)}$${D.fcff}`;
  const ebitdaN = `$${yc(n - 1)}$${D.ebitda}`;
  const pvOf = (w) => `SUMPRODUCT(${fcffRange},(1+${w})^-(${periodRange}))`;
  const eqAdj = `-${R.grossDebt}+${R.cash}`;

  const gGordon = grid(r, true, 'SENSITIVITY — IMPLIED SHARE PRICE: WACC × PERPETUITY GROWTH', 'WACC \\ g',
    waccRef, OFF_W, F.aPct2, OFF_G, F.aPct2, R.tg,
    (w, g) => `(${pvOf(w)}+${fcffN}*(1+${g})/(${w}-${g})*(1+${w})^-${`$${yc(n - 1)}$${D.period}`}${eqAdj})/${R.shares}`);
  const gExit = grid(r, false, 'SENSITIVITY — IMPLIED SHARE PRICE: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    waccRef, OFF_W, F.aPct2, OFF_X, F.aX, R.dcfExitX,
    (w, x) => `(${pvOf(w)}+${x}*${ebitdaN}*(1+${w})^-${yearsN}${eqAdj})/${R.shares}`);
  r = gGordon.top + 7;

  const gPerp = grid(r, true, 'SENSITIVITY — IMPLIED PERPETUITY GROWTH: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    waccRef, OFF_W, F.aPct2, OFF_X, F.aX, R.dcfExitX,
    (w, x) => {
      const tv = `(${x}*${ebitdaN})`;
      const ft = `(${fcffN}*(1+${w})^IF(${R.midYear},0.5,0))`;
      return na(`(${tv}*${w}-${ft})/(${tv}+${ft})`);
    });
  const gMult = grid(r, false, 'SENSITIVITY — IMPLIED EV / LTM EBITDA: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    waccRef, OFF_W, F.aPct2, OFF_X, F.aX, R.dcfExitX,
    (w, x) => na(`(${pvOf(w)}+${x}*${ebitdaN}*(1+${w})^-${yearsN})/${ltm}${D.ebitda}`));
  // these two report a rate and a multiple, not a price
  for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
    ws.getCell(`${colL(2 + j)}${gPerp.top + i}`).numFmt = F.aPct2;
    ws.getCell(`${colL(9 + j)}${gMult.top + i}`).numFmt = F.aX2;
  }
  r = gPerp.top + 7;

  const gFcfe = grid(r, true, 'SENSITIVITY — FCFE SHARE PRICE: COST OF EQUITY × PERPETUITY GROWTH', 'CoE \\ g',
    coeRef, OFF_W, F.aPct2, OFF_G, F.aPct2, R.tg,
    (c, g) => `(SUMPRODUCT(${fcfeRange},(1+${c})^-(${periodRange}))+${fcfeN}*(1+${g})/(${c}-${g})*(1+${c})^-${periodN})/${R.shares}`);
  r = gFcfe.top + 7;

  put(ws, `B${r}`, 'Every grid cell is a complete, self-contained valuation — edit any blue input and all five re-solve.', { italic: true, color: C_MUTED, size: 9 });

  return {
    L, fcfeRefs,
    grids: { gordon: gGordon.range, exit: gExit.range, fcfe: gFcfe.range },
    lastRow: r,
  };
}

/* ==================================================================== */
/*                             WACC sheet                               */
/* ==================================================================== */

/**
 * Cost-of-capital page. The WACC the model discounts at is the CAPM + Hamada
 * build off the Assumptions inputs — this page shows that build in full.
 * Beside it sits the comparable-companies unlevered beta table: the peers'
 * levered betas unlevered at their own capital structures, averaged, and
 * relevered at the target's. That is a REFERENCE — it shows whether the beta
 * you typed is defensible; it does not drive the discount rate, so the workbook
 * still matches the app exactly.
 */
export function writeWaccSheet(ws, a, F, R, o) {
  const { unitNote } = o;
  const peers = (a.comps?.peers || []).map((co) => computeCompany(co));

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 36;
  ws.getColumn('C').width = 3;
  ws.getColumn('D').width = 14;
  ws.getColumn('E').width = 3;
  ws.getColumn('F').width = 26;
  for (let c = 7; c <= 12; c++) ws.getColumn(c).width = 14.5;
  const allCols = colRun(2, 12);
  styleSheet(ws, { freezeRow: 4, tab: C_TAB_ANALYSIS, printTitles: '1:4' });

  put(ws, 'B1', { formula: R.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'Weighted Average Cost of Capital Analysis', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  /* ---------------- left: the WACC build ---------------- */
  banner(ws, 6, 2, 3, 'WACC Calculation');
  const W = {};
  let r = 7;
  const wLine = (key, label, formula, fmt, opts = {}) => {
    W[key] = r;
    put(ws, `B${r}`, label, opts);
    put(ws, `D${r}`, typeof formula === 'string' ? { formula } : formula, { fmt, align: 'right', ...opts });
    r++;
  };
  const wHead = (t) => { put(ws, `B${r}`, t, { bold: true, italic: true }); r++; };

  wHead('Target Capital Structure');
  wLine('wd', 'Debt-to-Total Capitalization', R.wd, F.aPct, { color: C_LINK });
  wLine('we', 'Equity-to-Total Capitalization', `1-D${W.wd}`, F.aPct);
  wLine('de', '   Debt / Equity', `IFERROR(D${W.wd}/D${W.we},0)`, F.aPct, { italic: true, color: C_MUTED });
  r++;
  wHead('Cost of Debt');
  wLine('kd', 'Pre-tax Cost of Debt', R.kd, F.aPct, { color: C_LINK });
  wLine('tax', 'Marginal Tax Rate', R.tax, F.aPct, { color: C_LINK });
  wLine('katd', '   After-tax Cost of Debt', `D${W.kd}*(1-D${W.tax})`, F.aPct2, { bold: true, top: true });
  r++;
  wHead('Cost of Equity');
  wLine('rf', 'Risk-free Rate', R.rf, F.aPct, { color: C_LINK });
  wLine('erp', 'Market Risk Premium', R.erp, F.aPct, { color: C_LINK });
  wLine('beta', 'Levered Beta', R.beta, F.aBeta, { color: C_LINK });
  wLine('size', 'Size / Alpha Premium', R.sizePrem, F.aPct, { color: C_LINK });
  wLine('coe', '   Cost of Equity (CAPM)', `D${W.rf}+(D${W.beta}*D${W.erp})+D${W.size}`, F.aPct2, { bold: true, top: true });
  r++;
  wLine('wacc', '   WACC', `(D${W.wd}*D${W.katd})+(D${W.we}*D${W.coe})`, F.aPct2, { bold: true, top: true, bottom: 'double' });
  r++;
  put(ws, `B${r}`, 'This is the build behind the WACC on the Assumptions sheet — the rate the DCF discounts at.', { italic: true, color: C_MUTED, size: 9 });
  const buildEnd = r;

  /* ---------------- right: peer unlevered beta ---------------- */
  banner(ws, 6, 6, 7, 'Comparable Companies Unlevered Beta');
  const hdr = ['Company', 'Predicted Levered Beta', 'Market Value of Debt', 'Market Value of Equity', 'Debt / Equity', 'Marginal Tax Rate', 'Unlevered Beta'];
  hdr.forEach((h, i) => put(ws, `${colL(6 + i)}8`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left', wrap: true }));
  ws.getRow(8).height = 30;
  edge(ws, 8, colRun(6, 12), 'bottom', 'thin', C_RULE);

  const first = 9;
  let pr = first;
  for (const p of peers) {
    put(ws, `F${pr}`, p.co.name);
    put(ws, `G${pr}`, Number(p.co.beta) || 0, { fmt: F.aBeta, color: C_INPUT, fill: 'FFF5F9FF', align: 'right' });
    put(ws, `H${pr}`, p.bs.debt[1], { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF', align: 'right' });
    put(ws, `I${pr}`, p.equityValue, { fmt: F.aItem, color: C_INPUT, fill: 'FFF5F9FF', align: 'right' });
    put(ws, `J${pr}`, { formula: `IFERROR(H${pr}/I${pr},0)` }, { fmt: F.aPct, align: 'right' });
    put(ws, `K${pr}`, Number(p.co.taxRate) / 100 || 0, { fmt: F.aPct, color: C_INPUT, fill: 'FFF5F9FF', align: 'right' });
    put(ws, `L${pr}`, { formula: na(`G${pr}/(1+J${pr}*(1-K${pr}))`) }, { fmt: F.aBeta, align: 'right' });
    pr++;
  }
  const last = pr - 1;
  if (peers.length) {
    for (const [label, fn] of [['Mean', 'AVERAGE'], ['Median', 'MEDIAN']]) {
      put(ws, `F${pr}`, label, { bold: true });
      for (const c of ['G', 'J', 'L']) {
        put(ws, `${c}${pr}`, { formula: na(`${fn}(${c}${first}:${c}${last})`) },
          { fmt: c === 'J' ? F.aPct : F.aBeta, bold: true, align: 'right' });
      }
      if (label === 'Mean') edge(ws, pr, colRun(6, 12), 'top', 'thin', C_RULE);
      pr++;
    }
  }
  const meanUnlev = peers.length ? `L${pr - 2}` : null;
  pr += 1;

  /* ---- relevered cross-check ---- */
  banner(ws, pr, 6, 7, 'Relevered Beta — reference');
  pr++;
  ['', 'Mean Unlevered Beta', 'Target Debt / Equity', 'Target Marginal Tax Rate', 'Relevered Beta'].forEach((h, i) => {
    if (i === 0) return;
    put(ws, `${colL(6 + i)}${pr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  });
  ws.getRow(pr).height = 30;
  pr++;
  put(ws, `F${pr}`, 'Peer set relevered at the target structure');
  if (meanUnlev) {
    put(ws, `G${pr}`, { formula: meanUnlev }, { fmt: F.aBeta, align: 'right' });
    put(ws, `H${pr}`, { formula: `D${W.de}` }, { fmt: F.aPct, align: 'right' });
    put(ws, `I${pr}`, { formula: `D${W.tax}` }, { fmt: F.aPct, align: 'right' });
    put(ws, `J${pr}`, { formula: na(`G${pr}*(1+H${pr}*(1-I${pr}))`) }, { fmt: F.aBeta, bold: true, align: 'right' });
  }
  const relevRow = pr;
  pr++;
  put(ws, `F${pr}`, 'Your levered beta (drives the WACC above)');
  put(ws, `J${pr}`, { formula: `D${W.beta}` }, { fmt: F.aBeta, bold: true, align: 'right' });
  pr++;
  put(ws, `F${pr}`, meanUnlev
    ? 'Reference only. If the relevered peer beta is far from your input, revisit the beta on the Assumptions sheet.'
    : 'Add comparable companies in the app to populate this table.', { italic: true, color: C_MUTED, size: 9 });
  pr += 2;

  /* ---------------- WACC sensitivity ---------------- */
  banner(ws, pr, 6, 7, 'WACC Sensitivity — Capital Structure × Pre-tax Cost of Debt');
  const sTop = pr + 1;
  put(ws, `F${sTop}`, 'D / (D+E)  \\  Cost of debt', { italic: true, align: 'center', fill: C_SECTION_FILL });
  const kdOff = [-0.01, -0.005, 0, 0.005, 0.01];
  const wdOff = [-0.1, -0.05, 0, 0.05, 0.1];
  kdOff.forEach((off, j) => put(ws, `${colL(7 + j)}${sTop}`, { formula: `D${W.kd}+${off}` },
    { fmt: F.aPct, bold: true, align: 'center', fill: C_SECTION_FILL }));
  wdOff.forEach((off, i) => {
    const rr = sTop + 1 + i;
    put(ws, `F${rr}`, { formula: `MIN(0.9,MAX(0,D${W.wd}+${off}))` }, { fmt: F.aPct, bold: true, fill: C_SECTION_FILL });
    kdOff.forEach((_, j) => {
      const wd = `$F${rr}`, kd = `${colL(7 + j)}$${sTop}`;
      // beta relevers with the capital structure, so the cost of equity moves too
      const de = `(${wd}/(1-${wd}))`;
      const bu = `(D${W.beta}/(1+(D${W.wd}/(1-D${W.wd}))*(1-D${W.tax})))`;
      const bl = `(${bu}*(1+${de}*(1-D${W.tax})))`;
      const coe = `(D${W.rf}+${bl}*D${W.erp}+D${W.size})`;
      put(ws, `${colL(7 + j)}${rr}`, { formula: na(`${wd}*${kd}*(1-D${W.tax})+(1-${wd})*${coe}`) },
        { fmt: F.aPct2, fill: C_GRID_FILL });
    });
  });
  pr = sTop + 7;
  put(ws, `F${pr}`, 'Each cell relevers beta at that capital structure before rebuilding the cost of equity, so the grid is a true WACC surface.', { italic: true, color: C_MUTED, size: 9 });

  return { W, waccCell: `'WACC'!$D$${W.wacc}`, coeCell: `'WACC'!$D$${W.coe}`, lastRow: Math.max(buildEnd, pr) };
}
