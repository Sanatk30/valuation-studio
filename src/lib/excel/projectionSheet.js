/**
 * The operating projection page shared by the LBO, IPO, 3-Statement and Ratio
 * workbooks, in the layout of the Rosenbaum & Pearl (Investment Banking, 3E)
 * DCF sheet's projection block: reported history (when entered) + LTM + the
 * projection with CAGR columns and, for the 3-Statement and Ratio files, the
 * tax (NOL) and unlevered free-cash-flow build.
 *
 * Mirrors engine/drivers.js (projectOperations) exactly:
 *   - Historical columns are REPORTED (blue inputs, "NA" where a line was not
 *     reported) — never back-cast. They appear only when history was entered.
 *   - The LTM column carries only what the model knows about Year 0: revenue,
 *     EBITDA and the opening NWC balance (all explicit inputs).
 *   - Tax runs through a tax-loss carryforward (NOL): a loss year pays no tax
 *     and adds to the balance; a profit year uses the balance first. Tax is
 *     never negative.
 */
import {
  put, colL, colRun, na, styleSheet, edge,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_MUTED,
  C_TAB_ANALYSIS, C_INPUT_FILL,
} from './xlsxUtil.js';

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

/**
 * Write the projection page.
 *   o.mode  'fcff' — projection + tax (NOL) + unlevered free cash flow (3-Statement, Ratios)
 *           'ops'  — the operating lines only, down to the change in NWC (LBO, IPO)
 *   o.ops   projectOperations(a) — the per-year blue assumptions are written
 *           as the equivalent percentages, whatever mode the forecast used
 *   o.hist  reportedHistory(a) (historyModel.js) or null
 * `R` holds the Inputs-sheet references. Returns the row map, column helpers
 * and refs the other sheets link through.
 */
export function writeProjectionSheet(ws, a, F, R, o) {
  const { unitNote, mode = 'ops', ops: opsX, hist = null, title } = o;
  const withTax = mode === 'fcff';
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
  put(ws, 'B2', title || 'Operating Projection', { bold: true, size: 12 });
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
  skip(2);

  row('asmHdr');
  row('aGrowth'); row('aMargin'); row('aDa'); row('aCapex'); row('aNwc');
  skip(2);

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
  return base;
}
