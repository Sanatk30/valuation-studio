/**
 * Discounted cash flow, operating projection and cost-of-capital pages, in the
 * layout of the Rosenbaum & Pearl (Investment Banking, 3E) "DCF" and "WACC"
 * sheets:
 *
 *   DCF / Projection — reported history (when entered) + LTM + the projection
 *           with CAGR columns and the unlevered free-cash-flow build. On the DCF
 *           file it continues into the side-by-side output blocks (enterprise
 *           value / implied equity value & share price / terminal-value
 *           cross-checks), the levered (FCFE) build when FCFE was not skipped,
 *           and 2-up sensitivity grids. The LBO, IPO, 3-Statement and Ratio
 *           files carry the projection block only (no WACC, TV or FCFE).
 *   WACC  — the CAPM + Hamada build, the peer unlevered-beta reference table
 *           (the DCF's own beta peers) with mean / median and the relevered
 *           cross-check, and a capital-structure × cost-of-debt WACC surface.
 *
 * Mirrors engine/dcf.js exactly:
 *   - Historical columns are REPORTED (blue inputs, "NA" where a line was not
 *     reported) — never back-cast. They appear only when history was entered.
 *   - The LTM column carries only what the model knows about Year 0: revenue,
 *     EBITDA and the opening NWC balance (all explicit inputs).
 *   - Tax runs through a tax-loss carryforward (NOL): a loss year pays no tax
 *     and adds to the balance; a profit year uses the balance first. Tax is
 *     never negative.
 *   - Both Gordon terminal values capitalise a NORMALISED, fully-taxed year-N
 *     flow; the NOL still unused at year N is valued once, on its own line.
 *   - FCFE adds the opening cash balance to the equity value.
 *   - Every sensitivity grid is a self-contained valuation whose step sizes
 *     are blue inputs on the Inputs sheet.
 */
import {
  put, colL, colRun, na, styleSheet, edge,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED,
  C_RULE, C_TAB_ANALYSIS, C_INPUT_FILL, nv,
} from './xlsxUtil.js';
import { betaPeerStats } from '../engine/wacc.js';

/* ------------------------------------------------------------- primitives */

/** A navy banner across `span` columns starting at column index `c0`. */
function banner(ws, row, c0, span, text) {
  for (let i = 0; i < span; i++) {
    put(ws, `${colL(c0 + i)}${row}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: span > 1 ? 'center' : 'left' });
  }
  if (span > 1) ws.mergeCells(`${colL(c0)}${row}:${colL(c0 + span - 1)}${row}`);
  ws.getRow(row).height = 18;
}

const BLUE = (fmt) => ({ fmt, color: C_INPUT, fill: C_INPUT_FILL });

/* ==================================================================== */
/*                     DCF / operating projection sheet                 */
/* ==================================================================== */

/**
 * Write the projection page.
 *   o.mode  'dcf'  — the full DCF (discounting, output blocks, cross-checks)
 *           'fcff' — projection + tax (NOL) + unlevered free cash flow (Ratios)
 *           'ops'  — the operating lines only, down to the change in NWC
 *   o.ops   projectOperations(a) — the per-year blue assumptions are written
 *           as the equivalent percentages, whatever mode the forecast used
 *   o.hist  dcfReportedHistory(a) or null
 * `R` holds the Inputs-sheet references. Returns the row map, column helpers
 * and refs the other sheets link through.
 */
export function writeDcfSheet(ws, a, F, R, o) {
  const { unitNote, mode = 'dcf', ops: opsX, hist = null, title } = o;
  const isDcf = mode === 'dcf';
  const withTax = mode === 'dcf' || mode === 'fcff';
  const n = a.drivers.years;
  const H = hist ? hist.n : 0;

  /* ---------------- column plan ----------------
     A gutter | B labels | [reported × H | hist CAGR] | LTM | projection × n | proj CAGR */
  const cHist = (i) => 3 + i;
  const cHCagr = H ? 3 + H : null;
  const cLtm = H ? 4 + H : 3;
  const cProj = (i) => cLtm + 1 + i;
  const cPCagr = cLtm + 1 + n;
  const lastCol = cPCagr;

  const hc = (i) => colL(cHist(i));
  const hCagr = H ? colL(cHCagr) : null;
  const ltm = colL(cLtm);
  const yc = (i) => colL(cProj(i));
  const pCagr = colL(cPCagr);
  const allCols = colRun(2, lastCol);
  const histCols = [...Array(H)].map((_, i) => hc(i));
  const projCols = [...Array(n)].map((_, i) => yc(i));
  /** Every period column, oldest first: reported, LTM, then the projection. */
  const periodCols = [...histCols, ltm, ...projCols];
  const priorCol = (c) => {
    const i = periodCols.indexOf(c);
    return i > 0 ? periodCols[i - 1] : null;
  };

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 44;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 13.5;
  if (H) ws.getColumn(cHCagr).width = 11;
  ws.getColumn(cPCagr).width = 11;
  styleSheet(ws, { freezeRow: 8, freezeCol: 2, tab: C_TAB_ANALYSIS, printTitles: '1:8' });

  /* ================= header ================= */
  put(ws, 'B1', { formula: R.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', title || (isDcf ? 'Discounted Cash Flow Analysis' : 'Operating Projection'), { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  const R_BAND = 6, R_YEAR = 7, R_RULE = 8;
  if (H) {
    banner(ws, R_BAND, 3, H, H > 1 ? 'Historical — reported' : 'Reported');
    put(ws, `${hCagr}${R_BAND}`, 'CAGR', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
  }
  put(ws, `${ltm}${R_BAND}`, 'LTM', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
  banner(ws, R_BAND, cProj(0), n, 'Projection Period');
  put(ws, `${pCagr}${R_BAND}`, 'CAGR', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });

  for (const c of allCols) put(ws, `${c}${R_YEAR}`, '', { fill: C_SECTION_FILL });
  histCols.forEach((c, i) => {
    const y = Number(String(hist.dates[i]).slice(0, 4));
    put(ws, `${c}${R_YEAR}`, y, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL });
  });
  if (H) put(ws, `${hCagr}${R_YEAR}`, 'hist.', { italic: true, align: 'center', fill: C_SECTION_FILL, size: 10 });
  put(ws, `${ltm}${R_YEAR}`, { formula: `${R.baseYear}` }, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL });
  projCols.forEach((c, i) => put(ws, `${c}${R_YEAR}`, { formula: `${R.baseYear}+${i + 1}` }, { fmt: F.fyYear, bold: true, align: 'center', fill: C_SECTION_FILL }));
  put(ws, `${pCagr}${R_YEAR}`, `${n}-yr`, { italic: true, align: 'center', fill: C_SECTION_FILL, size: 10 });
  ws.getRow(R_YEAR).height = 16;
  ws.getRow(R_RULE).height = 4;
  edge(ws, R_RULE, allCols, 'bottom', 'medium', C_HDR_FILL);

  /* ================= pass 1: lay out every row ================= */
  const D = {};
  let r = 10;
  const row = (key) => (D[key] = r++);
  const skip = (k = 1) => { r += k; };

  row('sales'); row('growth'); row('opex'); row('ebitda'); row('margin');
  row('da'); row('ebit'); row('ebitMargin');
  if (withTax) { row('nolOpen'); row('nolUsed'); row('nolClose'); row('taxes'); row('ebiat'); }
  skip();
  if (withTax) row('daBack');
  row('capex'); row('nwc'); row('dnwc');
  skip();
  if (withTax) row('fcff');
  if (isDcf) { row('wacc'); row('period'); row('df'); row('pv'); row('cumPv'); }
  skip(2);

  let OUT = null, CHK = null;
  if (isDcf) {
    OUT = r; skip(14);          // enterprise value | implied equity value
    CHK = r; skip(8);           // terminal-value cross-checks | implied multiples
  }
  row('asmHdr');
  row('aGrowth'); row('aMargin'); row('aDa'); row('aCapex'); row('aNwc');
  skip(2);
  const outRow = (i) => OUT + i;
  const chkRow = (i) => CHK + i;

  /* ================= pass 2: labels ================= */
  const MUTED = { italic: true, color: C_MUTED };
  const LABELS = [
    ['sales', 'Sales', { bold: true }],
    ['growth', '   % growth', MUTED],
    ['opex', 'Less: Operating costs (Sales − EBITDA)'],
    ['ebitda', 'EBITDA', { bold: true }],
    ['margin', '   % margin', MUTED],
    ['da', 'Less: Depreciation & Amortization'],
    ['ebit', 'EBIT', { bold: true }],
    ['ebitMargin', '   % margin', MUTED],
    ['nolOpen', '   Tax losses brought forward (NOL)', MUTED],
    ['nolUsed', '   NOL used against EBIT', MUTED],
    ['nolClose', '   Tax losses carried forward', MUTED],
    ['taxes', 'Less: Taxes (after tax losses)'],
    ['ebiat', 'EBIAT', { bold: true }],
    ['daBack', 'Plus: Depreciation & Amortization'],
    ['capex', 'Less: Capital Expenditures'],
    ['nwc', 'Memo: Net working capital', MUTED],
    ['dnwc', 'Less: Inc./(Dec.) in Net Working Capital'],
    ['fcff', 'Unlevered Free Cash Flow', { bold: true }],
    ['wacc', '   WACC', { italic: true }],
    ['period', '   Discount Period', { italic: true }],
    ['df', '   Discount Factor', { italic: true }],
    ['pv', '   Present Value of Free Cash Flow', { bold: true }],
    ['cumPv', '   Cumulative Present Value of FCF', MUTED],
  ];
  for (const [key, label, opts = {}] of LABELS) if (D[key]) put(ws, `B${D[key]}`, label, opts);

  const eachProj = (key, f, fmt, opts = {}) => projCols.forEach((c, i) => put(ws, `${c}${D[key]}`, { formula: f(c, i) }, { fmt, ...opts }));

  /* ================= reported history ================= */
  if (H) {
    const inV = (c, key, v, sign = 1) => put(ws, `${c}${D[key]}`, Number.isFinite(v) ? sign * v : 'NA', { ...BLUE(key === 'sales' || key === 'ebitda' ? F.aTotal : F.aItem), align: 'right', bold: key === 'sales' || key === 'ebitda' });
    histCols.forEach((c, i) => {
      inV(c, 'sales', hist.revenue[i]);
      inV(c, 'ebitda', hist.ebitda[i]);
      inV(c, 'da', hist.da[i]);
      inV(c, 'capex', hist.capex[i], -1);
      put(ws, `${c}${D.opex}`, { formula: na(`${c}${D.sales}-${c}${D.ebitda}`) }, { fmt: F.aItem, align: 'right' });
      put(ws, `${c}${D.ebit}`, { formula: na(`${c}${D.ebitda}-${c}${D.da}`) }, { fmt: F.aTotal, bold: true, top: true, align: 'right' });
      put(ws, `${c}${D.margin}`, { formula: na(`${c}${D.ebitda}/${c}${D.sales}`) }, { fmt: F.aPct, ...MUTED, align: 'right' });
      put(ws, `${c}${D.ebitMargin}`, { formula: na(`${c}${D.ebit}/${c}${D.sales}`) }, { fmt: F.aPct, ...MUTED, align: 'right' });
      if (i === 0) {
        // growth into the oldest shown year uses the reported year before it,
        // which sits outside the page — carried as a reported figure
        put(ws, `${c}${D.growth}`, Number.isFinite(hist.growth[0]) ? hist.growth[0] / 100 : 'NA', { ...BLUE(F.aPct), italic: true, align: 'right' });
      }
    });
    put(ws, `B${D.asmHdr - 2}`, 'History columns are reported figures (blue), never back-cast; NA = not reported.', { italic: true, color: C_MUTED, size: 9 });
  }

  /* ================= LTM (Year 0) ================= */
  put(ws, `${ltm}${D.sales}`, { formula: R.rev0 }, { fmt: F.aTotal, bold: true, color: C_LINK });
  put(ws, `${ltm}${D.ebitda}`, { formula: R.ebitda0 }, { fmt: F.aTotal, bold: true, color: C_LINK, top: true });
  put(ws, `${ltm}${D.opex}`, { formula: na(`${ltm}${D.sales}-${ltm}${D.ebitda}`) }, { fmt: F.aItem });
  put(ws, `${ltm}${D.margin}`, { formula: na(`${ltm}${D.ebitda}/${ltm}${D.sales}`) }, { fmt: F.aPct, ...MUTED });
  put(ws, `${ltm}${D.nwc}`, { formula: R.nwc0 }, { fmt: F.aItem, italic: true, color: C_LINK });

  // % growth under every sales figure that has one before it
  for (const c of [...histCols.slice(1), ltm, ...projCols]) {
    put(ws, `${c}${D.growth}`, { formula: na(`${c}${D.sales}/${priorCol(c)}${D.sales}-1`) }, { fmt: F.aPct, ...MUTED });
  }

  /* ================= projection ================= */
  eachProj('sales', (c, i) => `${i === 0 ? ltm : yc(i - 1)}${D.sales}*(1+${c}${D.aGrowth})`, F.aTotal, { bold: true });
  eachProj('opex', (c) => `${c}${D.sales}-${c}${D.ebitda}`, F.aItem);
  eachProj('ebitda', (c) => `${c}${D.sales}*${c}${D.aMargin}`, F.aTotal, { bold: true, top: true });
  eachProj('margin', (c) => na(`${c}${D.ebitda}/${c}${D.sales}`), F.aPct, MUTED);
  eachProj('da', (c) => `${c}${D.sales}*${c}${D.aDa}`, F.aItem);
  eachProj('ebit', (c) => `${c}${D.ebitda}-${c}${D.da}`, F.aTotal, { bold: true, top: true });
  eachProj('ebitMargin', (c) => na(`${c}${D.ebit}/${c}${D.sales}`), F.aPct, MUTED);
  if (withTax) {
    // unlevered NOL schedule on EBIT (engine: nolSchedule(ops.ebit, t, nol0))
    eachProj('nolOpen', (c, i) => (i === 0 ? R.nol0 : `${yc(i - 1)}${D.nolClose}`), F.aItem, MUTED);
    eachProj('nolUsed', (c) => `IF(${c}${D.ebit}>0,MIN(${c}${D.nolOpen},${c}${D.ebit}),0)`, F.aItem, MUTED);
    eachProj('nolClose', (c) => `${c}${D.nolOpen}-${c}${D.nolUsed}+IF(${c}${D.ebit}<=0,-${c}${D.ebit},0)`, F.aItem, MUTED);
    eachProj('taxes', (c) => `MAX(0,${c}${D.ebit}-${c}${D.nolUsed})*${R.tax}`, F.aItem);
    eachProj('ebiat', (c) => `${c}${D.ebit}-${c}${D.taxes}`, F.aTotal, { bold: true, top: true });
    eachProj('daBack', (c) => `${c}${D.da}`, F.aItem);
  }
  // 3E convention: outflows carry their sign, so the build reads as a sum
  eachProj('capex', (c) => `-(${c}${D.sales}*${c}${D.aCapex})`, F.aItem);
  eachProj('nwc', (c) => `${c}${D.sales}*${c}${D.aNwc}`, F.aItem, MUTED);
  eachProj('dnwc', (c, i) => `-(${c}${D.nwc}-${i === 0 ? ltm : yc(i - 1)}${D.nwc})`, F.aItem);
  if (withTax) eachProj('fcff', (c) => `${c}${D.ebiat}+${c}${D.daBack}+${c}${D.capex}+${c}${D.dnwc}`, F.aTotal, { bold: true, top: true });

  // CAGR columns: history → LTM on the reported years; LTM → Year N on the projection
  const cagrF = (from, to, years) => na(`(${to}/${from})^(1/${years})-1`);
  if (H) {
    for (const key of ['sales', 'ebitda']) {
      put(ws, `${hCagr}${D[key]}`, { formula: cagrF(`${hc(0)}${D[key]}`, `${ltm}${D[key]}`, `(${ltm}$${R_YEAR}-${hc(0)}$${R_YEAR})`) }, { fmt: F.aPct, ...MUTED });
    }
  }
  for (const key of ['sales', 'ebitda']) {
    put(ws, `${pCagr}${D[key]}`, { formula: cagrF(`${ltm}${D[key]}`, `${yc(n - 1)}${D[key]}`, n) }, { fmt: F.aPct, ...MUTED });
  }
  const tailKeys = ['ebit', ...(withTax ? ['ebiat', 'fcff'] : [])];
  if (n > 1) for (const key of tailKeys) put(ws, `${pCagr}${D[key]}`, { formula: cagrF(`${yc(0)}${D[key]}`, `${yc(n - 1)}${D[key]}`, n - 1) }, { fmt: F.aPct, ...MUTED });

  /* ================= discounting (DCF only) ================= */
  if (isDcf) {
    put(ws, `${ltm}${D.wacc}`, { formula: R.wacc }, { fmt: F.aPct2, italic: true, color: C_LINK });
    eachProj('period', (c) => `${c}$${R_YEAR}-${ltm}$${R_YEAR}-IF(${R.midYear},0.5,0)`, F.aFactor, { italic: true });
    eachProj('df', (c) => `1/((1+${R.wacc})^${c}${D.period})`, F.aFactor, { italic: true });
    eachProj('pv', (c) => `${c}${D.fcff}*${c}${D.df}`, F.aTotal, { bold: true });
    eachProj('cumPv', (c, i) => (i === 0 ? `${c}${D.pv}` : `${yc(i - 1)}${D.cumPv}+${c}${D.pv}`), F.aItem, MUTED);
  }

  /* ================= assumptions block (the blue per-year inputs) ================= */
  banner(ws, D.asmHdr, 2, 1, 'Projection assumptions (per year)');
  for (const [key, label] of [
    ['aGrowth', 'Sales (% growth)'],
    ['aMargin', 'EBITDA margin (% sales)'],
    ['aDa', 'Depreciation & amortization (% sales)'],
    ['aCapex', 'Capital expenditures (% sales)'],
    ['aNwc', 'Net working capital (% sales)'],
  ]) put(ws, `B${D[key]}`, label);
  projCols.forEach((c, i) => {
    const pct = (v) => (Number.isFinite(v) ? v : 'NA');
    put(ws, `${c}${D.aGrowth}`, pct(opsX.growth[i] / 100), BLUE(F.aPct));
    put(ws, `${c}${D.aMargin}`, pct(opsX.margin[i] / 100), BLUE(F.aPct));
    put(ws, `${c}${D.aDa}`, pct(opsX.da[i] / opsX.revenue[i]), BLUE(F.aPct));
    put(ws, `${c}${D.aCapex}`, pct(opsX.capex[i] / opsX.revenue[i]), BLUE(F.aPct));
    put(ws, `${c}${D.aNwc}`, pct(opsX.nwcBalance[i] / opsX.revenue[i]), BLUE(F.aPct));
  });
  put(ws, `B${D.aNwc + 1}`, 'Blue cells are inputs. A forecast entered in absolute amounts appears here as the equivalent percentages. Year-0 revenue, EBITDA and NWC are on the Inputs sheet.', { italic: true, color: C_MUTED, size: 9 });

  const base = {
    D, yc, hc, ltm, hCagr, pCagr, lastCol, allCols, periodCols, projCols, priorCol,
    H, n, R_YEAR, nextRow: r, sheet: ws.name,
    ref: (key, i) => `'${ws.name}'!$${yc(i)}$${D[key]}`,
    ltmRef: (key) => `'${ws.name}'!$${ltm}$${D[key]}`,
  };
  if (!isDcf) return base;

  /* ================= output blocks ================= */
  const evCol = colL(4), exCol = colL(5);          // D, E — perpetuity growth | exit multiple
  const eqLbl = 7, eqA = colL(9), eqB = colL(10);   // G labels, I / J values

  banner(ws, OUT, 2, 4, 'Enterprise Value');
  banner(ws, OUT, eqLbl, 4, 'Implied Equity Value and Share Price');
  for (const [c, t] of [[evCol, 'Perpetuity Growth'], [exCol, 'Exit Multiple'], [eqA, 'Perpetuity Growth'], [eqB, 'Exit Multiple']]) {
    put(ws, `${c}${outRow(1)}`, t, { bold: true, align: 'center', fill: C_SECTION_FILL, wrap: true });
  }
  ws.getRow(outRow(1)).height = 26;

  const evL = (i, text, opts = {}) => put(ws, `B${outRow(i)}`, text, opts);
  const evV = (i, fa, fb, fmt, opts = {}) => {
    if (fa) put(ws, `${evCol}${outRow(i)}`, { formula: fa }, { fmt, ...opts });
    if (fb) put(ws, `${exCol}${outRow(i)}`, { formula: fb }, { fmt, ...opts });
  };
  const N = yc(n - 1);
  const cumPvN = `$${N}$${D.cumPv}`;
  const ebitdaN = `$${N}$${D.ebitda}`;
  const periodN = `$${N}$${D.period}`;
  const yearsN = `(${N}$${R_YEAR}-${ltm}$${R_YEAR})`;
  // normalised terminal-year flow: fully taxed, no NOL (tax never negative)
  const normF = `$${N}$${D.ebit}-MAX(0,$${N}$${D.ebit})*${R.tax}+$${N}$${D.daBack}+$${N}$${D.capex}+$${N}$${D.dnwc}`;
  const nolPv = (w) => `$${N}$${D.nolClose}*${R.tax}*(1+${w})^-${yearsN}`;

  evL(2, 'Cumulative Present Value of FCF');
  evV(2, cumPvN, cumPvN, F.aItem);
  evL(3, 'Normalised Terminal-Year FCF (fully taxed)', MUTED);
  evV(3, normF, null, F.aItem, MUTED);
  evL(4, 'Perpetuity Growth Rate', MUTED);
  evV(4, R.tg, null, F.aPct, MUTED);
  evL(5, 'Terminal-Year EBITDA', MUTED);
  evV(5, null, ebitdaN, F.aItem, MUTED);
  evL(6, 'Exit Multiple', MUTED);
  evV(6, null, R.dcfExitX, F.aX, MUTED);
  evL(7, 'Terminal Value', { bold: true });
  evV(7, `IF(${R.wacc}>${R.tg},${evCol}${outRow(3)}*(1+${R.tg})/(${R.wacc}-${R.tg}),"NA")`, `${R.dcfExitX}*${ebitdaN}`, F.aTotal, { bold: true, top: true });
  evL(8, 'Discount Factor');
  evV(8, `1/((1+${R.wacc})^${periodN})`, `1/((1+${R.wacc})^${yearsN})`, F.aFactor);
  evL(9, 'Present Value of Terminal Value', { bold: true });
  evV(9, na(`${evCol}${outRow(7)}*${evCol}${outRow(8)}`), `${exCol}${outRow(7)}*${exCol}${outRow(8)}`, F.aTotal, { bold: true });
  evL(10, 'PV of Unused Tax Losses at Year N (NOL × t)');
  evV(10, nolPv(R.wacc), nolPv(R.wacc), F.aItem);
  evL(11, '   PV of Terminal Value, % of Enterprise Value', MUTED);
  evV(11, na(`${evCol}${outRow(9)}/${evCol}${outRow(12)}`), na(`${exCol}${outRow(9)}/${exCol}${outRow(12)}`), F.aPct, MUTED);
  evL(12, 'Enterprise Value', { bold: true });
  evV(12, na(`${evCol}${outRow(2)}+${evCol}${outRow(9)}+${evCol}${outRow(10)}`), na(`${exCol}${outRow(2)}+${exCol}${outRow(9)}+${exCol}${outRow(10)}`), F.aTotal, { bold: true, top: true, bottom: 'double' });

  const eqL = (i, text, opts = {}) => put(ws, `${colL(eqLbl)}${outRow(i)}`, text, opts);
  const eqV = (i, f, fmt, opts = {}) => {
    put(ws, `${eqA}${outRow(i)}`, { formula: f(evCol, eqA) }, { fmt, ...opts });
    put(ws, `${eqB}${outRow(i)}`, { formula: f(exCol, eqB) }, { fmt, ...opts });
  };
  eqL(2, 'Enterprise Value');
  eqV(2, (c) => `${c}${outRow(12)}`, F.aItem);
  eqL(3, 'Less: Total Debt');
  eqV(3, () => `-${R.grossDebt}`, F.aItem);
  eqL(4, 'Plus: Cash and Cash Equivalents');
  eqV(4, () => R.cash, F.aItem);
  eqL(5, 'Implied Equity Value', { bold: true });
  eqV(5, (_, q) => na(`${q}${outRow(2)}+${q}${outRow(3)}+${q}${outRow(4)}`), F.aTotal, { bold: true, top: true });
  eqL(6, 'Diluted Shares Outstanding');
  eqV(6, () => R.shares, F.aShares);
  eqL(7, 'Implied Share Price', { bold: true });
  eqV(7, (_, q) => na(`${q}${outRow(5)}/${q}${outRow(6)}`), F.aPrice, { bold: true, top: true, bottom: 'double' });
  eqL(8, 'Premium / (Discount) to Current Price', MUTED);
  eqV(8, (_, q) => na(`${q}${outRow(7)}/${R.curPrice}-1`), F.aPct, MUTED);
  eqL(9, 'Current Share Price', MUTED);
  eqV(9, () => R.curPrice, F.aPrice, MUTED);

  /* ================= cross-checks ================= */
  banner(ws, CHK, 2, 4, 'Terminal Value Cross-Checks');
  banner(ws, CHK, eqLbl, 4, 'Implied Valuation Multiples');
  const ckL = (i, t, opts = {}) => put(ws, `B${chkRow(i)}`, t, opts);
  const ckV = (i, f, fmt, opts = {}) => put(ws, `${exCol}${chkRow(i)}`, { formula: f }, { fmt, ...opts });
  // mid-year: the terminal flow is grossed up before it is capitalised
  const fcffTerm = `(${evCol}${outRow(3)}*(1+${R.wacc})^IF(${R.midYear},0.5,0))`;
  ckL(1, 'Perpetuity growth TV → implied exit EV/EBITDA');
  ckV(1, na(`${evCol}${outRow(7)}/${ebitdaN}`), F.aX2, { bold: true });
  ckL(2, '   vs the exit-multiple assumption', MUTED);
  ckV(2, R.dcfExitX, F.aX2, MUTED);
  ckL(3, 'Exit-multiple TV → implied perpetuity growth');
  ckV(3, na(`(${exCol}${outRow(7)}*${R.wacc}-${fcffTerm})/(${exCol}${outRow(7)}+${fcffTerm})`), F.aPct2, { bold: true });
  ckL(4, '   vs the terminal-growth assumption', MUTED);
  ckV(4, R.tg, F.aPct2, MUTED);
  ckL(5, 'The two terminal values should roughly agree.', { ...MUTED, size: 9 });

  const mL = (i, t, opts = {}) => put(ws, `${colL(eqLbl)}${chkRow(i)}`, t, opts);
  const mV = (i, f, fmt, opts = {}) => put(ws, `${eqB}${chkRow(i)}`, { formula: f }, { fmt, ...opts });
  mL(1, 'Enterprise Value (exit multiple)');
  mV(1, `${exCol}${outRow(12)}`, F.aItem);
  mL(2, 'LTM EBITDA');
  mV(2, `${ltm}${D.ebitda}`, F.aItem);
  mL(3, 'Implied EV / LTM EBITDA', { bold: true });
  mV(3, na(`${eqB}${chkRow(1)}/${eqB}${chkRow(2)}`), F.aX2, { bold: true });
  mL(4, 'LTM Sales');
  mV(4, `${ltm}${D.sales}`, F.aItem);
  mL(5, 'Implied EV / LTM Sales', { bold: true });
  mV(5, na(`${eqB}${chkRow(1)}/${eqB}${chkRow(4)}`), F.aX2, { bold: true });

  const q = `'${ws.name}'`;
  return {
    ...base,
    evCol, exCol, eqA, eqB, outRow, chkRow,
    dcfRefs: {
      priceGordon: `${q}!$${eqA}$${outRow(7)}`,
      priceExit: `${q}!$${eqB}$${outRow(7)}`,
      evGordon: `${q}!$${evCol}$${outRow(12)}`,
      evExit: `${q}!$${exCol}$${outRow(12)}`,
    },
    normF, nolPv, yearsN, periodN,
  };
}

/* ==================================================================== */
/*                DCF sheet — levered build & sensitivities             */
/* ==================================================================== */

/**
 * The second half of the DCF page: the levered (FCFE) build and its valuation
 * (only when FCFE was not skipped), then the sensitivity grids two across.
 * Returns the FCFE refs and the grid ranges.
 */
export function writeDcfLower(ws, a, F, R, P, o = {}) {
  const { fcfe = true } = o;
  const { D, yc, ltm, n, R_YEAR, projCols } = P;
  const MUTED = { italic: true, color: C_MUTED };
  const N = yc(n - 1);
  let r = P.nextRow;
  const L = {};
  let fcfeRefs = null;

  if (fcfe) {
    /* ================= levered free cash flow ================= */
    banner(ws, r, 2, P.lastCol - 1, 'Levered Free Cash Flow (FCFE) — discounted at the cost of equity');
    r += 2;
    const line = (key, label, opts = {}) => { L[key] = r; put(ws, `B${r}`, label, opts); r++; };
    line('openDebt', 'Opening debt', MUTED);
    line('interest', 'Interest expense (on opening debt)');
    line('repay', 'Mandatory repayment (= − net borrowing)');
    line('ebt', 'Pre-tax income (EBIT − interest)');
    line('nolOpen', '   Tax losses brought forward', MUTED);
    line('nolUsed', '   NOL used', MUTED);
    line('nolClose', '   Tax losses carried forward', MUTED);
    line('tax', 'Less: Taxes (after tax losses)');
    line('ni', 'Net income (FCFE basis)', { bold: true });
    line('fcfe', 'Free Cash Flow to Equity', { bold: true });
    line('dfE', '   Discount Factor @ cost of equity', { italic: true });
    line('pvE', '   Present Value of FCFE', { bold: true });
    r++;
    put(ws, `B${r++}`, 'Memo — net income on the 3-statement basis (interest income on retained cash), for the exit P/E', { bold: true, italic: true });
    line('openCash', 'Opening cash', MUTED);
    line('intInc', 'Interest income (on opening cash)', MUTED);
    line('ebtNi', 'Pre-tax income', MUTED);
    line('nolOpenNi', '   Tax losses brought forward', MUTED);
    line('nolUsedNi', '   NOL used', MUTED);
    line('nolCloseNi', '   Tax losses carried forward', MUTED);
    line('taxNi', 'Taxes', MUTED);
    line('niNi', 'Net income (3-statement basis)', MUTED);
    line('div', 'Dividends (payout × net income)', MUTED);
    line('closeCash', 'Closing cash (retained)', MUTED);

    const each = (key, f, fmt, opts = {}) => projCols.forEach((c, i) => put(ws, `${c}${L[key]}`, { formula: f(c, i, i === 0 ? null : yc(i - 1)) }, { fmt, ...opts }));
    each('openDebt', (c, i, p) => (i === 0 ? R.grossDebt : `${p}${L.openDebt}-${p}${L.repay}`), F.aItem, MUTED);
    each('interest', (c) => `${c}${L.openDebt}*${R.intDebt}`, F.aItem);
    each('repay', (c) => `${c}${L.openDebt}*${R.repayPct}`, F.aItem);
    each('ebt', (c) => `${c}${D.ebit}-${c}${L.interest}`, F.aItem);
    each('nolOpen', (c, i, p) => (i === 0 ? R.nol0 : `${p}${L.nolClose}`), F.aItem, MUTED);
    each('nolUsed', (c) => `IF(${c}${L.ebt}>0,MIN(${c}${L.nolOpen},${c}${L.ebt}),0)`, F.aItem, MUTED);
    each('nolClose', (c) => `${c}${L.nolOpen}-${c}${L.nolUsed}+IF(${c}${L.ebt}<=0,-${c}${L.ebt},0)`, F.aItem, MUTED);
    each('tax', (c) => `MAX(0,${c}${L.ebt}-${c}${L.nolUsed})*${R.tax}`, F.aItem);
    each('ni', (c) => `${c}${L.ebt}-${c}${L.tax}`, F.aItem, { bold: true, top: true });
    each('fcfe', (c) => `${c}${L.ni}+${c}${D.da}+${c}${D.capex}+${c}${D.dnwc}-${c}${L.repay}`, F.aTotal, { bold: true, top: true });
    each('dfE', (c) => `1/((1+${R.coe})^${c}${D.period})`, F.aFactor, { italic: true });
    each('pvE', (c) => `${c}${L.fcfe}*${c}${L.dfE}`, F.aTotal, { bold: true });
    each('openCash', (c, i, p) => (i === 0 ? R.cash : `${p}${L.closeCash}`), F.aItem, MUTED);
    each('intInc', (c) => `${c}${L.openCash}*${R.intCash}`, F.aItem, MUTED);
    each('ebtNi', (c) => `${c}${D.ebit}-${c}${L.interest}+${c}${L.intInc}`, F.aItem, MUTED);
    each('nolOpenNi', (c, i, p) => (i === 0 ? R.nol0 : `${p}${L.nolCloseNi}`), F.aItem, MUTED);
    each('nolUsedNi', (c) => `IF(${c}${L.ebtNi}>0,MIN(${c}${L.nolOpenNi},${c}${L.ebtNi}),0)`, F.aItem, MUTED);
    each('nolCloseNi', (c) => `${c}${L.nolOpenNi}-${c}${L.nolUsedNi}+IF(${c}${L.ebtNi}<=0,-${c}${L.ebtNi},0)`, F.aItem, MUTED);
    each('taxNi', (c) => `MAX(0,${c}${L.ebtNi}-${c}${L.nolUsedNi})*${R.tax}`, F.aItem, MUTED);
    each('niNi', (c) => `${c}${L.ebtNi}-${c}${L.taxNi}`, F.aItem, MUTED);
    each('div', (c) => `MAX(0,${c}${L.niNi})*${R.payout}`, F.aItem, MUTED);
    each('closeCash', (c) => `${c}${L.openCash}+${c}${L.niNi}+${c}${D.da}+${c}${D.dnwc}+${c}${D.capex}-${c}${L.repay}-${c}${L.div}`, F.aItem, MUTED);
    r++;

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
    const sumPvE = `SUM(${yc(0)}${L.pvE}:${N}${L.pvE})`;
    const normE = `$${N}$${L.ebt}-MAX(0,$${N}$${L.ebt})*${R.tax}+$${N}$${D.da}+$${N}$${D.capex}+$${N}$${D.dnwc}-$${N}$${L.repay}`;
    const normNi = `$${N}$${L.ebtNi}-MAX(0,$${N}$${L.ebtNi})*${R.tax}`;
    const periodN = `$${N}$${D.period}`;
    const yearsN = `(${N}$${R_YEAR}-${ltm}$${R_YEAR})`;
    const nolPvE = (c) => `$${N}$${L.nolClose}*${R.tax}*(1+${c})^-${yearsN}`;

    fL(2, 'Sum of Present Value of FCFE');
    fV(2, sumPvE, sumPvE, F.aItem);
    fL(3, 'Normalised Terminal-Year FCFE / Net Income (fully taxed)', MUTED);
    fV(3, normE, normNi, F.aItem, MUTED);
    fL(4, 'Terminal Value');
    fV(4, `IF(${R.coe}>${R.tg},${gCol}${OUT + 3}*(1+${R.tg})/(${R.coe}-${R.tg}),"NA")`, `${R.dcfExitPE}*${pCol}${OUT + 3}`, F.aItem);
    fL(5, 'Discount Factor');
    fV(5, `1/((1+${R.coe})^${periodN})`, `1/((1+${R.coe})^${yearsN})`, F.aFactor);
    fL(6, 'Present Value of Terminal Value');
    fV(6, na(`${gCol}${OUT + 4}*${gCol}${OUT + 5}`), `${pCol}${OUT + 4}*${pCol}${OUT + 5}`, F.aItem);
    fL(7, 'PV of Unused Tax Losses at Year N (NOL × t)');
    fV(7, nolPvE(R.coe), nolPvE(R.coe), F.aItem);
    fL(8, 'Plus: Opening Cash');
    fV(8, R.cash, R.cash, F.aItem);
    fL(9, 'Implied Equity Value', { bold: true });
    fV(9, na(`${gCol}${OUT + 2}+${gCol}${OUT + 6}+${gCol}${OUT + 7}+${gCol}${OUT + 8}`), na(`${pCol}${OUT + 2}+${pCol}${OUT + 6}+${pCol}${OUT + 7}+${pCol}${OUT + 8}`), F.aTotal, { bold: true, top: true });
    fL(10, 'Diluted Shares Outstanding');
    fV(10, R.shares, R.shares, F.aShares);
    fL(11, 'Implied Share Price', { bold: true });
    fV(11, na(`${gCol}${OUT + 9}/${gCol}${OUT + 10}`), na(`${pCol}${OUT + 9}/${pCol}${OUT + 10}`), F.aPrice, { bold: true, top: true, bottom: 'double' });
    const q = `'${ws.name}'`;
    fcfeRefs = { priceFcfe: `${q}!$${gCol}$${OUT + 11}`, priceFcfePE: `${q}!$${pCol}$${OUT + 11}` };
    L.normE = normE; L.nolPvE = nolPvE;
    r = OUT + 13;
  }

  /* ================= sensitivity grids, two across ================= */
  const K = [-2, -1, 0, 1, 2];
  const step = (ref, s, scale) => (k) => (k === 0 ? ref : `${ref}+(${k})*${s}${scale}`);
  const wAt = step(R.wacc, R.sWacc, '/100');
  const gAt = step(R.tg, R.sG, '/100');
  const xAt = step(R.dcfExitX, R.sMult, '');
  const cAt = step(R.coe, R.sCoe, '/100');

  /**
   * One 5×5 grid. `left` picks the column block: labels at B (values C..G) or
   * labels at I (values J..N), so two grids sit side by side on the page.
   */
  const grid = (row, left, title, corner, rowAt, rowFmt, colAt, colFmt, cellFmt, cell) => {
    const c0 = left ? 2 : 9;
    banner(ws, row, c0, 6, title);
    const top = row + 1;
    put(ws, `${colL(c0)}${top}`, corner, { italic: true, align: 'center', fill: C_SECTION_FILL });
    K.forEach((k, j) => put(ws, `${colL(c0 + 1 + j)}${top}`, { formula: colAt(k) }, { fmt: colFmt, bold: true, align: 'center', fill: C_SECTION_FILL }));
    K.forEach((k, i) => {
      const rr = top + 1 + i;
      put(ws, `${colL(c0)}${rr}`, { formula: rowAt(k) }, { fmt: rowFmt, bold: true, fill: C_SECTION_FILL });
      K.forEach((_, j) => {
        const rRef = `$${colL(c0)}${rr}`, cRef = `${colL(c0 + 1 + j)}$${top}`;
        put(ws, `${colL(c0 + 1 + j)}${rr}`, { formula: na(cell(rRef, cRef)) }, { fmt: cellFmt, fill: C_GRID_FILL });
      });
    });
    return { top, range: `'${ws.name}'!$${colL(c0 + 1)}$${top + 1}:$${colL(c0 + 5)}$${top + 5}` };
  };

  const fcffRange = `$${yc(0)}$${D.fcff}:$${N}$${D.fcff}`;
  const periodRange = `$${yc(0)}$${D.period}:$${N}$${D.period}`;
  const ebitdaN = `$${N}$${D.ebitda}`;
  const pvOf = (w) => `SUMPRODUCT(${fcffRange},(1+${w})^-(${periodRange}))`;
  const eqAdj = `-${R.grossDebt}+${R.cash}`;
  const normF = `(${P.normF})`;

  const gGordon = grid(r, true, 'SENSITIVITY — IMPLIED SHARE PRICE: WACC × PERPETUITY GROWTH', 'WACC \\ g',
    wAt, F.aPct2, gAt, F.aPct2, F.aPrice,
    (w, g) => `IF(${w}>${g},(${pvOf(w)}+${normF}*(1+${g})/(${w}-${g})*(1+${w})^-${P.periodN}+${P.nolPv(w)}${eqAdj})/${R.shares},"NA")`);
  const gExit = grid(r, false, 'SENSITIVITY — IMPLIED SHARE PRICE: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    wAt, F.aPct2, xAt, F.aX, F.aPrice,
    (w, x) => `(${pvOf(w)}+${x}*${ebitdaN}*(1+${w})^-${P.yearsN}+${P.nolPv(w)}${eqAdj})/${R.shares}`);
  r = gGordon.top + 7;

  const gPerp = grid(r, true, 'SENSITIVITY — IMPLIED PERPETUITY GROWTH: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    wAt, F.aPct2, xAt, F.aX, F.aPct2,
    (w, x) => {
      const tv = `(${x}*${ebitdaN})`;
      const ft = `(${normF}*(1+${w})^IF(${R.midYear},0.5,0))`;
      return `(${tv}*${w}-${ft})/(${tv}+${ft})`;
    });
  const gMult = grid(r, false, 'SENSITIVITY — IMPLIED EV / LTM EBITDA: WACC × EXIT EV/EBITDA', 'WACC \\ x',
    wAt, F.aPct2, xAt, F.aX, F.aX2,
    (w, x) => `(${pvOf(w)}+${x}*${ebitdaN}*(1+${w})^-${P.yearsN}+${P.nolPv(w)})/${ltm}${D.ebitda}`);
  r = gPerp.top + 7;

  let gFcfe = null;
  if (fcfe) {
    const fcfeRange = `$${yc(0)}$${L.fcfe}:$${N}$${L.fcfe}`;
    gFcfe = grid(r, true, 'SENSITIVITY — FCFE SHARE PRICE: COST OF EQUITY × PERPETUITY GROWTH', 'CoE \\ g',
      cAt, F.aPct2, gAt, F.aPct2, F.aPrice,
      (c, g) => `IF(${c}>${g},(SUMPRODUCT(${fcfeRange},(1+${c})^-(${periodRange}))+(${L.normE})*(1+${g})/(${c}-${g})*(1+${c})^-${P.periodN}+${L.nolPvE(c)}+${R.cash})/${R.shares},"NA")`);
    r = gFcfe.top + 7;
  }

  put(ws, `B${r}`, 'Every grid cell is a complete, self-contained valuation. The step sizes are blue inputs on the Inputs sheet.', { italic: true, color: C_MUTED, size: 9 });

  return {
    L, fcfeRefs,
    grids: { gordon: gGordon.range, exit: gExit.range, fcfe: gFcfe?.range || null },
    lastRow: r,
  };
}

/* ==================================================================== */
/*                             WACC sheet                               */
/* ==================================================================== */

/**
 * Cost-of-capital page. The WACC the model discounts at is the CAPM + Hamada
 * build off the Inputs sheet — this page shows that build in full. Beside it
 * sits the DCF's own peer beta table (a.wacc.betaPeers): each peer's levered
 * beta unlevered at its own D/E and tax rate, averaged, and relevered at the
 * target structure. That is a REFERENCE — it never drives the discount rate.
 */
export function writeWaccSheet(ws, a, F, R, o) {
  const { unitNote } = o;
  const peers = betaPeerStats(a).rows;

  ws.getColumn('A').width = 1.4;
  ws.getColumn('B').width = 36;
  ws.getColumn('C').width = 3;
  ws.getColumn('D').width = 14;
  ws.getColumn('E').width = 3;
  ws.getColumn('F').width = 30;
  for (let c = 7; c <= 11; c++) ws.getColumn(c).width = 14.5;
  const allCols = colRun(2, 11);
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
    put(ws, `D${r}`, { formula }, { fmt, align: 'right', ...opts });
    r++;
  };
  const wHead = (t) => { put(ws, `B${r}`, t, { bold: true, italic: true }); r++; };

  wHead('Target Capital Structure');
  wLine('wd', 'Debt-to-Total Capitalization', R.wd, F.aPct, { color: C_LINK });
  wLine('we', 'Equity-to-Total Capitalization', `1-D${W.wd}`, F.aPct);
  wLine('de', '   Debt / Equity', na(`D${W.wd}/D${W.we}`), F.aPct, { italic: true, color: C_MUTED });
  r++;
  wHead('Cost of Debt');
  wLine('kd', 'Pre-tax Cost of Debt', R.kd, F.aPct, { color: C_LINK });
  wLine('tax', 'Marginal Tax Rate', R.tax, F.aPct, { color: C_LINK });
  wLine('katd', '   After-tax Cost of Debt', `D${W.kd}*(1-D${W.tax})`, F.aPct2, { bold: true, top: true });
  r++;
  wHead('Cost of Equity');
  wLine('rf', 'Risk-free Rate', R.rf, F.aPct, { color: C_LINK });
  wLine('erp', 'Market Risk Premium', R.erp, F.aPct, { color: C_LINK });
  wLine('bu', 'Unlevered (Asset) Beta', R.bu, F.aBeta, { color: C_LINK });
  wLine('beta', 'Levered Beta', R.beta, F.aBeta, { color: C_LINK });
  wLine('size', 'Size / Company-specific Premium', R.sizePrem, F.aPct, { color: C_LINK });
  wLine('coe', '   Cost of Equity (CAPM)', `D${W.rf}+(D${W.beta}*D${W.erp})+D${W.size}`, F.aPct2, { bold: true, top: true });
  r++;
  wLine('wacc', '   WACC', `(D${W.wd}*D${W.katd})+(D${W.we}*D${W.coe})`, F.aPct2, { bold: true, top: true, bottom: 'double' });
  r++;
  put(ws, `B${r}`, 'The build behind the WACC on the Inputs sheet — the rate the DCF discounts at.', { italic: true, color: C_MUTED, size: 9 });
  const buildEnd = r;

  /* ---------------- right: peer unlevered beta (reference) ---------------- */
  banner(ws, 6, 6, 6, 'Peer Unlevered Beta — reference');
  const hdr = ['Company', 'Levered Beta', 'Debt / Equity', 'Marginal Tax Rate', 'Unlevered Beta', ''];
  hdr.forEach((h, i) => { if (h) put(ws, `${colL(6 + i)}8`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left', wrap: true }); });
  ws.getRow(8).height = 30;
  edge(ws, 8, colRun(6, 10), 'bottom', 'thin', C_RULE);

  const first = 9;
  let pr = first;
  for (const p of peers) {
    put(ws, `F${pr}`, p.name || '');
    put(ws, `G${pr}`, nv(p.leveredBeta), { ...BLUE(F.aBeta), align: 'right' });
    put(ws, `H${pr}`, nv(p.de), { ...BLUE(F.num), align: 'right' });
    put(ws, `I${pr}`, Number.isFinite(p.taxRate) ? p.taxRate / 100 : 'NA', { ...BLUE(F.aPct), align: 'right' });
    put(ws, `J${pr}`, { formula: na(`G${pr}/(1+(1-I${pr})*H${pr})`) }, { fmt: F.aBeta, align: 'right' });
    pr++;
  }
  const last = pr - 1;
  const stat = {};
  if (peers.length) {
    for (const [label, fn] of [['Mean', 'AVERAGE'], ['Median', 'MEDIAN']]) {
      put(ws, `F${pr}`, label, { bold: true });
      put(ws, `J${pr}`, { formula: na(`${fn}(J${first}:J${last})`) }, { fmt: F.aBeta, bold: true, align: 'right' });
      if (label === 'Mean') edge(ws, pr, colRun(6, 10), 'top', 'thin', C_RULE);
      stat[label] = pr++;
    }
  } else {
    put(ws, `F${pr++}`, 'No beta peers were entered in the app.', { italic: true, color: C_MUTED });
  }
  pr += 1;

  /* ---- relevered cross-check ---- */
  banner(ws, pr, 6, 6, 'Relevered at the Target Structure — reference');
  pr++;
  ['', 'Peer Unlevered Beta', 'Target Debt / Equity', 'Target Tax Rate', 'Relevered Beta'].forEach((h, i) => {
    if (i) put(ws, `${colL(6 + i)}${pr}`, h, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  });
  ws.getRow(pr).height = 30;
  pr++;
  const relev = {};
  for (const label of ['Mean', 'Median']) {
    put(ws, `F${pr}`, `Peer ${label.toLowerCase()}`);
    if (stat[label]) {
      put(ws, `G${pr}`, { formula: `J${stat[label]}` }, { fmt: F.aBeta, align: 'right' });
      put(ws, `H${pr}`, { formula: `D${W.de}` }, { fmt: F.num, align: 'right' });
      put(ws, `I${pr}`, { formula: `D${W.tax}` }, { fmt: F.aPct, align: 'right' });
      put(ws, `J${pr}`, { formula: na(`G${pr}*(1+(1-I${pr})*H${pr})`) }, { fmt: F.aBeta, bold: true, align: 'right' });
      relev[label] = pr;
    }
    pr++;
  }
  put(ws, `F${pr}`, 'Levered beta used (drives the WACC)');
  put(ws, `J${pr}`, { formula: `D${W.beta}` }, { fmt: F.aBeta, bold: true, align: 'right' });
  pr++;
  put(ws, `F${pr}`, 'Reference only. If the relevered peer beta is far from the beta used, revisit the beta input.', { italic: true, color: C_MUTED, size: 9 });
  pr += 2;

  /* ---------------- WACC sensitivity ---------------- */
  banner(ws, pr, 6, 6, 'WACC Sensitivity — Capital Structure × Pre-tax Cost of Debt');
  const sTop = pr + 1;
  put(ws, `F${sTop}`, 'D / (D+E)  \\  Cost of debt', { italic: true, align: 'center', fill: C_SECTION_FILL });
  const K = [-2, -1, 0, 1, 2];
  K.forEach((k, j) => put(ws, `${colL(7 + j)}${sTop}`, { formula: k ? `D${W.kd}+(${k})*${R.sKd}/100` : `D${W.kd}` },
    { fmt: F.aPct, bold: true, align: 'center', fill: C_SECTION_FILL }));
  K.forEach((k, i) => {
    const rr = sTop + 1 + i;
    // rows clamped to the 0–90 % debt-weight band (engine WD_MIN / WD_MAX)
    put(ws, `F${rr}`, { formula: `MIN(0.9,MAX(0,D${W.wd}${k ? `+(${k})*${R.sWd}/100` : ''}))` }, { fmt: F.aPct, bold: true, fill: C_SECTION_FILL });
    K.forEach((_, j) => {
      const wd = `$F${rr}`, kd = `${colL(7 + j)}$${sTop}`;
      // the asset beta relevers at each capital structure, so the cost of equity moves too
      const bl = `(D${W.bu}*(1+(1-D${W.tax})*(${wd}/(1-${wd}))))`;
      const coe = `(D${W.rf}+${bl}*D${W.erp}+D${W.size})`;
      put(ws, `${colL(7 + j)}${rr}`, { formula: na(`(1-${wd})*${coe}+${wd}*${kd}*(1-D${W.tax})`) }, { fmt: F.aPct2, fill: C_GRID_FILL });
    });
  });
  pr = sTop + 7;
  put(ws, `F${pr}`, 'Each cell relevers the asset beta at that capital structure before rebuilding the cost of equity. Step sizes are on the Inputs sheet.', { italic: true, color: C_MUTED, size: 9 });

  const q = `'${ws.name}'`;
  return {
    W, waccCell: `${q}!$D$${W.wacc}`, coeCell: `${q}!$D$${W.coe}`,
    peerMean: stat.Mean ? `${q}!$J$${stat.Mean}` : null,
    peerMedian: stat.Median ? `${q}!$J$${stat.Median}` : null,
    relevMean: relev.Mean ? `${q}!$J$${relev.Mean}` : null,
    relevMedian: relev.Median ? `${q}!$J$${relev.Median}` : null,
    surface: `${q}!$G$${sTop + 1}:$K$${sTop + 5}`,
    lastRow: Math.max(buildEnd, pr),
  };
}
