/**
 * The DCF workbook, laid out like the user's twelve DCF templates
 * (DCF_<FCFF|FCFE|DDM>_<GordonGrowth|ExitEVEBITDA|ExitPE>_<CAPM|BuildUp>.xlsx):
 *
 *   Instructions · Inputs · <valuation sheet> · Historicals · Assumptions ·
 *   Forecast · Cost of Equity (CAPM | Build-Up) · WACC (FCFF only)
 *
 * for the chosen combination and N historical / M forecast years (template:
 * 3 and 5 — at those sizes every cell sits where the template has it). Every
 * derived cell is the template's live formula; inputs are blue on cream.
 * Extras kept at the user's request: the beta-peer list (Hamada) beside the
 * CAPM helper, and — when chosen — the re-levered beta driving the cost of
 * equity.
 */
import ExcelJS from 'exceljs';
import { computeDcfT, DRIVERS, exitMultipleName } from '../engine/dcfTemplate.js';
import { IS_LINES, BS_LINES, CF_LINES, fyValues } from '../engine/companyPage.js';
import { CURRENCIES, UNITS } from '../format.js';
import { colL } from './xlsxUtil.js';
import { T, NF, w, fx, title, note, hdr } from './templateXlsx.js';

/** The templates spell the unit out (₹ Crore; shares in crore). */
const UNIT_WORDS = { Cr: 'Crore', Lakh: 'Lakh', Mn: 'Million', Bn: 'Billion', K: 'Thousand' };
/** Currency and unit wording of the DCF / LBO templates. */
export function unitNames(a) {
  const sym = CURRENCIES[a.settings?.currency]?.symbol || '';
  const unitCode = a.settings?.unit;
  const unitWord = UNIT_WORDS[unitCode] || UNITS[unitCode] || unitCode || '';
  return {
    sym,
    unitShort: `${sym} ${UNITS[unitCode] || unitCode || ''}`.trim(),   // e.g. ₹ Cr (table headers)
    unitLabel: `${sym} ${unitWord}`.trim(),                            // e.g. ₹ Crore, as the templates
    unit: unitWord.toLowerCase(),                                      // share counts, e.g. (crore)
  };
}
const KEY = 'FFEAF1DD';                 // the templates' key-result fill (Ke, WACC, FCF, Equity Value, Value per Share)
const NF4 = '0.0000';
const NFB = '0.00';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const pc = (v) => (isNum(v) ? v / 100 : null);
const date = (s) => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Historicals row of a company-page line (the DCF sheet has no Total Income row). */
const hRow = (line) => (line.row >= 10 ? line.row - 1 : line.row);

export function buildDcfWorkbook(a) {
  const r = computeDcfT(a);
  const d = a.dcf;
  const s = r.settings;
  const { n, m, cf, tv } = r;
  const coeKind = r.coeKind;
  const { sym, unitShort, unitLabel, unit } = unitNames(a);
  const CF = cf.toUpperCase();
  const TVN = tv === 'exit' ? 'Exit Multiple' : 'Gordon Growth';
  const multN = exitMultipleName(cf);
  const coeSheet = coeKind === 'capm' ? 'Cost of Equity (CAPM)' : 'Cost of Equity (Build-Up)';
  const valSheet = `${CF} - ${TVN}`;
  const Q = (name) => `'${name}'`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quant Value';
  wb.calcProperties = { fullCalcOnLoad: true };

  /* ---------------- column plans ---------------- */
  const H = (i) => colL(2 + i);                  // historical column i (B…)
  const Fc = (j) => colL(2 + n + j);             // forecast column j (Historicals / Assumptions / Forecast)
  const allCols = [...Array(n)].map((_, i) => H(i)).concat([...Array(m)].map((_, j) => Fc(j)));
  const lastH = H(n - 1);
  const lastF = Fc(m - 1);
  const V = (j) => colL(3 + j);                  // valuation-sheet forecast column j (C…)
  const lastV = V(m - 1);
  const vNote = colL(3 + m);                     // valuation-sheet note column (template H)

  /* ---------------- Inputs rows ---------------- */
  const IN = {
    name: 5, ticker: 6, date: 7, price: 8, shares: 9, lease: 10,
    hist: (i) => 13 + i, fcst: (j) => 13 + n + j,
  };
  IN.tvHead = 13 + n + m + 1;
  IN.tv = IN.tvHead + 1;
  IN.sensHead = IN.tv + 2;
  IN.rateStep = IN.sensHead + 1;
  IN.tvStep = IN.sensHead + 2;
  const inRef = (row) => `Inputs!$B$${row}`;

  /* ============================== Instructions ============================== */
  {
    const ws = wb.addWorksheet('Instructions');
    ws.getColumn(1).width = 3; ws.getColumn(2).width = 32; ws.getColumn(3).width = 110;
    title(ws, 'B1', `DCF Valuation – ${CF} - ${TVN} – ${coeKind === 'capm' ? 'CAPM' : 'Build-Up'} Cost of Equity`);
    note(ws, 'B2', `All amounts in ${unitLabel} unless stated (share price and per-share values in ${sym}, shares in ${unit}).`);
    w(ws, 'B4', 'Colour legend', { bold: true });
    w(ws, 'B5', 'Blue text, cream fill', { input: true }); w(ws, 'C5', 'Input – type your data here');
    w(ws, 'B6', 'Black text'); w(ws, 'C6', 'Formula – do not overwrite');
    w(ws, 'B7', 'Green text', { link: true }); w(ws, 'C7', 'Link from another sheet – do not overwrite');
    w(ws, 'B8', 'Grey fill', { fill: T.na }); w(ws, 'C8', 'Not applicable');
    w(ws, 'B10', 'Order of work', { bold: true });
    const tvInput = tv === 'exit' ? (cf === 'fcff' ? 'exit EV/EBITDA multiple' : 'exit P/E multiple') : 'terminal growth rate';
    const steps = [
      ['1. Inputs', `Company details, share price, diluted shares, period labels, ${tvInput} and sensitivity step sizes.`],
      ['2. Historicals', `${n} year${n === 1 ? '' : 's'} of consolidated P&L, balance sheet and cash flow (same layout as the CCA workbook).`],
      ['3. Assumptions', `${m}-year forecast drivers. Historical ratios appear on the left of each row as a guide – type forecasts in the cream cells.`],
      ['4. Forecast', 'Fully calculated – nothing to type here.'],
      [`5. ${coeSheet}`, coeKind === 'capm'
        ? `Enter the risk-free rate, beta and equity risk premium. An optional helper re-levers a peer unlevered beta${(d.capm?.peers || []).length ? '; the peer beta list beside it unlevers each peer (Hamada)' : ''}.`
        : 'Enter the risk-free rate, equity risk premium and each additional premium (size, industry, company-specific, country).'],
      ...(cf === 'fcff' ? [['6. WACC', 'Pre-tax cost of debt, marginal tax rate and target debt weight. Current market weights are shown as a reference.']] : []),
      [`${cf === 'fcff' ? 7 : 6}. ${valSheet}`, 'The valuation: discounted cash flows, terminal value, value per share, cross-check and sensitivity table.'],
    ];
    let row = 11;
    const pair = ([k, v]) => { w(ws, `B${row}`, k, { bold: true }); w(ws, `C${row}`, v, { wrap: true }); row++; };
    steps.forEach(pair);
    row++;
    w(ws, `B${row++}`, 'Method in this file', { bold: true });
    pair(cf === 'fcff'
      ? ['FCFF', 'Free Cash Flow to Firm = NOPAT + D&A − Capex − Increase in NWC. Discounted at WACC → Enterprise Value → less Net Debt and NCI → Equity Value.']
      : cf === 'fcfe'
        ? ['FCFE', 'Free Cash Flow to Equity = PAT + D&A − Capex − Increase in NWC + Net Borrowing. Discounted at Cost of Equity → Equity Value directly.']
        : ['DDM', 'Dividends = PAT × Payout Ratio. Discounted at Cost of Equity → Equity Value directly. Best for mature, high-payout companies.']);
    pair(tv === 'exit'
      ? ['Exit Multiple TV', 'FCFF: Final-year EBITDA × EV/EBITDA. FCFE & DDM: Final-year PAT × P/E (equity methods need an equity multiple).']
      : ['Gordon Growth TV', 'Final-year cash flow × (1 + g) ÷ (Discount Rate − g). Shows NM if discount rate ≤ g.']);
    pair(['Cross-check', 'Gordon Growth: implied exit multiple. Exit Multiple: implied perpetual growth rate. Use it to test whether the terminal value is reasonable.']);
    row++;
    w(ws, `B${row++}`, 'Conventions & simplifications', { bold: true });
    [
      ['Discounting', `End-of-year: Year 1 to Year ${m} cash flows are discounted 1 to ${m} years. The valuation is therefore as at the end of the last historical year.`],
      ['Sign convention', 'Historicals: expenses positive in P&L, outflows negative in cash flow. Assumptions: capex and costs as positive % of revenue.'],
      ['Interest', 'Forecast interest = Opening Debt × Interest Rate (avoids circular references).'],
      ['Leases', "Lease liabilities are added to net debt if the toggle on Inputs = 1. For FCFE, include lease principal repayments in 'Net Borrowing / (Repayment)'."],
      ['Forecast PAT', 'Forecast does not model associates or non-controlling interest; PAT is treated as attributable to owners.'],
      ['Exceptional items', 'Included in historical PBT but not forecast.'],
    ].forEach(pair);
  }

  /* ============================== Inputs ============================== */
  {
    const ws = wb.addWorksheet('Inputs');
    ws.getColumn(1).width = 46; ws.getColumn(2).width = 18; ws.getColumn(3).width = 70;
    title(ws, 'A1', 'Inputs');
    note(ws, 'A2', 'Fill cream cells. Column C gives a format example.');
    w(ws, 'A4', 'Company', { bold: true });
    const row = (rr, label, value, fmt, eg) => {
      w(ws, `A${rr}`, label);
      w(ws, `B${rr}`, value, { input: true, fmt });
      if (eg !== undefined && eg !== null) note(ws, `C${rr}`, eg);
    };
    row(IN.name, 'Company name', a.company?.name || null, undefined, 'e.g. ABC Industries Ltd');
    row(IN.ticker, 'NSE / BSE ticker', d.company?.ticker || null, undefined, 'e.g. ABCIND');
    row(IN.date, 'Valuation date', date(s.valDate), NF.date, 'e.g. 31-Mar-2026 (end of last historical year – see Instructions)');
    row(IN.price, `Current share price (${sym})`, num(r.price), NF.n2, 'e.g. 620.00 – source and date');
    row(IN.shares, `Diluted shares outstanding (${unit})`, num(r.shares), NF.n2, 'e.g. 20.00');
    row(IN.lease, 'Include lease liabilities in net debt? (1/0)', r.toggle, undefined, '1 = Yes (Ind AS 116 puts rent below EBITDA)');
    w(ws, 'A12', 'Period labels', { bold: true });
    r.labels.hist.forEach((l, i) => row(IN.hist(i), `Historical year ${i + 1}${i === n - 1 ? ' (latest actual)' : ''}`, l, undefined, i === 0 ? 'Labels only – edit freely' : ''));
    r.labels.fcst.forEach((l, j) => row(IN.fcst(j), `Forecast year ${j + 1}`, l, undefined, ''));
    w(ws, `A${IN.tvHead}`, 'Terminal value', { bold: true });
    if (tv === 'gordon') row(IN.tv, 'Terminal (perpetual) growth rate', pc(s.growth), NF.pct, 'e.g. 5.0% – should not exceed long-run nominal GDP growth');
    else row(IN.tv, `Exit ${multN} multiple`, num(s.exitMultiple), NF.x, `e.g. ${cf === 'fcff' ? '12.0x' : '20.0x'} – can take median from your CCA / Precedent workbooks`);
    w(ws, `A${IN.sensHead}`, 'Sensitivity table', { bold: true });
    // the steps the engine's grid uses (a blank step falls back to the template's example, as in the engine)
    row(IN.rateStep, 'Discount rate step', r.sens.rateStep, NF.pct, 'e.g. 0.5%');
    if (tv === 'gordon') row(IN.tvStep, 'Terminal growth step', r.sens.tvStep, NF.pct, 'e.g. 0.5%');
    else row(IN.tvStep, 'Exit multiple step', r.sens.tvStep, NF.x, 'e.g. 1.0x');
  }

  const label = (k) => inRef(k < n ? IN.hist(k) : IN.fcst(k - n));
  writeHistoricals(wb, { page: d.company?.page, n, label, unitLabel, unit, sym });
  writeAssumptions(wb, { defs: DRIVERS, drivers: d.drivers, n, m, label, unitShort });

  /* ============================== Forecast ============================== */
  {
    const ws = wb.addWorksheet('Forecast');
    ws.getColumn(1).width = 44;
    allCols.forEach((c) => { ws.getColumn(c).width = 12; });
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];
    title(ws, 'A1', 'Forecast Model');
    note(ws, 'A2', 'Fully calculated – do not type here. Historical columns link to Historicals; forecast columns use Assumptions.');
    w(ws, 'B3', 'Actual', { bold: true });
    w(ws, `${Fc(0)}3`, 'Forecast', { bold: true });
    hdr(ws, 'A4', unitLabel, { align: 'left', wrap: false });
    for (let i = 0; i < n; i++) hdr(ws, `${H(i)}4`, fx(inRef(IN.hist(i))), { wrap: false });
    for (let j = 0; j < m; j++) hdr(ws, `${Fc(j)}4`, fx(inRef(IN.fcst(j))), { wrap: false });
    const sec = (rr, text) => { w(ws, `A${rr}`, text, { bold: true, fill: T.sec }); allCols.forEach((c) => w(ws, `${c}${rr}`, null, { size: 11, fill: T.sec })); };
    const SUB = { bold: true, fill: T.sub, top: true };
    const NAc = (X, rr, fmt) => w(ws, `${X}${rr}`, 'n.a.', { italic: true, size: 9, color: T.grey, align: 'right', fmt });
    const prev = (X) => colL(allCols.indexOf(X) + 1);          // the column before X (B → A never used: first column handled apart)
    /**
     * One row: label, then hist(X) / fcst(Y, P) formula builders. opts: fmt, sub (subtotal style),
     * histLink (green), firstNa (the first historical column shows n.a.), fcstNa (grey forecast cells).
     */
    const line = (rr, label, hist, fcst, o = {}) => {
      const fmt = o.fmt || NF.n1;
      const st = o.sub ? SUB : {};
      w(ws, `A${rr}`, label, o.label || st);
      allCols.forEach((X, k) => {
        const isH = k < n;
        if (k === 0 && o.firstNa) return NAc(X, rr, fmt);
        if (isH) return w(ws, `${X}${rr}`, fx(hist(X, prev(X))), { fmt, ...st, ...(o.histLink ? { link: true, bold: false } : {}) });
        if (o.fcstNa) return w(ws, `${X}${rr}`, null, { size: 11, fill: T.na, fmt });
        return w(ws, `${X}${rr}`, fx(fcst(X, prev(X))), { fmt, ...st });
      });
    };
    const Hl = (row) => (X) => `Historicals!${X}${row}`;
    const A = (row) => (Y) => `Assumptions!${Y}${row}`;
    sec(6, 'INCOME STATEMENT');
    line(7, 'Revenue from Operations', Hl(7), (Y, P) => `${P}7*(1+${A(7)(Y)})`, { histLink: true });
    line(8, '  Growth %', (X, P) => `IFERROR(${X}7/${P}7-1,0)`, (Y, P) => `IFERROR(${Y}7/${P}7-1,0)`, { fmt: NF.pct, firstNa: true, label: { italic: true, size: 9, color: T.grey } });
    line(9, 'Cost of Materials', Hl(9), (Y) => `${Y}7*${A(8)(Y)}`, { histLink: true });
    line(10, 'Employee Benefits Expense', Hl(10), (Y) => `${Y}7*${A(9)(Y)}`, { histLink: true });
    line(11, 'Other Expenses', Hl(11), (Y) => `${Y}7*${A(10)(Y)}`, { histLink: true });
    line(12, 'Total Operating Expenses', (X) => `SUM(${X}9:${X}11)`, (Y) => `SUM(${Y}9:${Y}11)`, { sub: true });
    line(13, 'EBITDA', (X) => `${X}7-${X}12`, (Y) => `${Y}7-${Y}12`, { sub: true });
    line(14, '  EBITDA margin', (X) => `IFERROR(${X}13/${X}7,0)`, (Y) => `IFERROR(${Y}13/${Y}7,0)`, { fmt: NF.pct });
    line(15, 'Depreciation & Amortisation', Hl(14), (Y) => `${Y}7*${A(11)(Y)}`, { histLink: true });
    line(16, 'EBIT', (X) => `${X}13-${X}15`, (Y) => `${Y}13-${Y}15`, { sub: true });
    line(17, 'Other Income', Hl(8), (Y) => `${Y}7*${A(12)(Y)}`, { histLink: true });
    line(18, 'Finance Costs', Hl(16), (Y) => `${Y}38*${Y}41`, { histLink: true });
    line(19, 'Exceptional Items', Hl(17), null, { histLink: true, fcstNa: true });
    line(20, 'Profit Before Tax', Hl(18), (Y) => `${Y}16+${Y}17-${Y}18`, { sub: true, histLink: true });
    line(21, 'Tax Expense', Hl(19), (Y) => `MAX(0,${Y}20)*${A(13)(Y)}`, { histLink: true });
    line(22, 'PAT (attributable to owners)', Hl(23), (Y) => `${Y}20-${Y}21`, { sub: true, histLink: true });
    line(23, `Diluted EPS (${sym})`, Hl(25), (Y) => `IFERROR(${Y}22/${inRef(IN.shares)},0)`, { fmt: NF.n2, histLink: true });
    line(24, 'Dividends', (X) => `-Historicals!${X}81`, (Y) => `MAX(0,${Y}22)*${A(26)(Y)}`, { histLink: true });
    line(25, `Dividend per Share (${sym})`, (X) => `IFERROR(${X}24/Historicals!${X}24,0)`, (Y) => `IFERROR(${Y}24/${inRef(IN.shares)},0)`, { fmt: NF.n2, histLink: true });
    sec(27, 'WORKING CAPITAL');
    line(28, 'Inventories', Hl(36), (Y) => `${Y}9*${A(17)(Y)}/365`, { histLink: true });
    line(29, 'Trade Receivables', Hl(37), (Y) => `${Y}7*${A(18)(Y)}/365`, { histLink: true });
    line(30, 'Other Current Assets', Hl(41), (Y) => `${Y}7*${A(20)(Y)}`, { histLink: true });
    line(31, 'Trade Payables', Hl(59), (Y) => `${Y}9*${A(19)(Y)}/365`, { histLink: true });
    line(32, 'Other Current Liabilities & Provisions', Hl(60), (Y) => `${Y}7*${A(21)(Y)}`, { histLink: true });
    line(33, 'Net Working Capital', (X) => `${X}28+${X}29+${X}30-${X}31-${X}32`, (Y) => `${Y}28+${Y}29+${Y}30-${Y}31-${Y}32`, { sub: true });
    line(34, 'Increase / (Decrease) in NWC', (X, P) => `${X}33-${P}33`, (Y, P) => `${Y}33-${P}33`, { firstNa: true });
    sec(36, 'CAPEX & DEBT SCHEDULE');
    line(37, 'Capex', (X) => `-Historicals!${X}73`, (Y) => `${Y}7*${A(16)(Y)}`, { histLink: true });
    line(38, 'Opening Debt', (X, P) => `${P}40`, (Y, P) => `${P}40`, { firstNa: true });
    line(39, 'Net Borrowing / (Repayment)', Hl(79), (Y) => A(24)(Y), { histLink: true });
    line(40, 'Closing Debt (Borrowings)', (X) => `Historicals!${X}52+Historicals!${X}57`, (Y) => `${Y}38+${Y}39`, { sub: true, histLink: true });
    line(41, '  Interest rate on opening debt', (X) => A(25)(X), (Y) => A(25)(Y), { fmt: NF.pct, firstNa: true, histLink: true });
    if (cf !== 'ddm') {
      sec(43, cf === 'fcff' ? 'FREE CASH FLOW TO FIRM (FCFF)' : 'FREE CASH FLOW TO EQUITY (FCFE)');
      const block = (rr, label, f, o = {}) => {
        w(ws, `A${rr}`, label, o.key ? { bold: true, fill: KEY } : o.sub ? SUB : {});
        allCols.forEach((X, k) => {
          if (k < n) return w(ws, `${X}${rr}`, null, { size: 11, fill: T.na, fmt: NF.n1 });
          return w(ws, `${X}${rr}`, fx(f(X)), { fmt: NF.n1, ...(o.key ? { bold: true, fill: KEY } : o.sub ? SUB : {}) });
        });
      };
      if (cf === 'fcff') {
        block(44, 'EBIT', (Y) => `${Y}16`);
        block(45, '(−) Taxes on EBIT', (Y) => `MAX(0,${Y}16)*${A(13)(Y)}`);
        block(46, 'NOPAT', (Y) => `${Y}44-${Y}45`, { sub: true });
        block(47, '(+) Depreciation & Amortisation', (Y) => `${Y}15`);
        block(48, '(−) Capex', (Y) => `${Y}37`);
        block(49, '(−) Increase in NWC', (Y) => `${Y}34`);
        block(50, 'Free Cash Flow to Firm', (Y) => `${Y}46+${Y}47-${Y}48-${Y}49`, { key: true });
      } else {
        block(44, 'PAT', (Y) => `${Y}22`);
        block(45, '(+) Depreciation & Amortisation', (Y) => `${Y}15`);
        block(46, '(−) Capex', (Y) => `${Y}37`);
        block(47, '(−) Increase in NWC', (Y) => `${Y}34`);
        block(48, '(+) Net Borrowing / (Repayment)', (Y) => `${Y}39`);
        block(49, 'Free Cash Flow to Equity', (Y) => `${Y}44+${Y}45-${Y}46-${Y}47+${Y}48`, { key: true });
      }
    }
  }

  /* ============================== Cost of equity ============================== */
  const keRef = coeKind === 'capm' ? `${Q(coeSheet)}!$B$9` : `${Q(coeSheet)}!$B$12`;
  {
    const ws = wb.addWorksheet(coeSheet);
    ws.getColumn(1).width = 46; ws.getColumn(2).width = 14; ws.getColumn(3).width = 72;
    hdr(ws, 'A4', 'Component', { wrap: false }); hdr(ws, 'B4', 'Value', { wrap: false }); hdr(ws, 'C4', 'Format example / source', { wrap: false });
    const KEYST = { bold: true, fill: KEY, top: true };
    if (coeKind === 'capm') {
      const cp = d.capm || {};
      const hamada = cp.betaMode === 'hamada';
      title(ws, 'A1', 'Cost of Equity – CAPM');
      note(ws, 'A2', 'Cost of Equity = Risk-free Rate + Beta × Equity Risk Premium');
      w(ws, 'A5', 'Risk-free rate'); w(ws, 'B5', pc(cp.rf), { input: true, fmt: NF.pct });
      note(ws, 'C5', 'e.g. 6.5% – 10-year Government of India bond yield on valuation date (RBI / CCIL)');
      w(ws, 'A6', 'Levered beta');
      if (hamada) {
        w(ws, 'B6', fx('B16'), { fmt: NFB });
        note(ws, 'C6', 'Re-levered peer beta from the helper below (Hamada) – as chosen in the app.');
      } else {
        w(ws, 'B6', num(cp.beta), { input: true, fmt: NFB });
        note(ws, 'C6', 'e.g. 1.05 – regression vs Nifty 50 (2–5 yrs), or re-levered peer beta from helper below');
      }
      w(ws, 'A7', 'Equity risk premium'); w(ws, 'B7', pc(cp.erp), { input: true, fmt: NF.pct });
      note(ws, 'C7', 'e.g. 7.0% – state your source (e.g. Damodaran India ERP)');
      w(ws, 'A9', 'Cost of Equity (Ke)', KEYST); w(ws, 'B9', fx('B5+B6*B7'), { ...KEYST, fmt: NF.pct });
      w(ws, 'A12', 'Optional helper: re-lever a peer unlevered beta', { bold: true });
      w(ws, 'A13', 'Peer average unlevered beta'); w(ws, 'B13', num(cp.peerBeta), { input: true, fmt: NFB });
      note(ws, 'C13', 'e.g. 0.85 – unlever each peer: βu = βL / (1 + (1 − t) × D/E)');
      w(ws, 'A14', 'Company target Debt / Equity'); w(ws, 'B14', pc(cp.targetDe), { input: true, fmt: NF.pct });
      note(ws, 'C14', 'e.g. 15.0% – consistent with target weight on WACC sheet');
      w(ws, 'A15', 'Marginal tax rate'); w(ws, 'B15', pc(cp.taxRate), { input: true, fmt: NF.pct });
      note(ws, 'C15', 'e.g. 25.2%');
      w(ws, 'A16', 'Re-levered beta', { bold: true }); w(ws, 'B16', fx('B13*(1+(1-B15)*B14)'), { bold: true, fmt: NFB });
      note(ws, 'C16', hamada ? 'Drives the levered beta in B6.' : 'Reference only – type your chosen beta into cell B6.');
      /* the beta-peer list (Hamada), beside the helper */
      const peers = cp.peers || [];
      if (peers.length) {
        const c0 = 5;                                   // E…I
        const cc = (k) => colL(c0 + k);
        [26, 12, 12, 12, 14].forEach((wd, k) => { ws.getColumn(c0 + k).width = wd; });
        w(ws, `${cc(0)}12`, 'Beta peers (Hamada) – reference', { bold: true });
        ['Peer', 'Levered β', 'D / E', 'Tax rate', 'Unlevered β'].forEach((h, k) => hdr(ws, `${cc(k)}13`, h));
        const r0 = 14;
        peers.forEach((p, i) => {
          const rr = r0 + i;
          w(ws, `${cc(0)}${rr}`, p.name || `Peer ${i + 1}`, { input: true });
          w(ws, `${cc(1)}${rr}`, num(p.beta), { input: true, fmt: NFB });
          w(ws, `${cc(2)}${rr}`, pc(p.de), { input: true, fmt: NF.pct });
          w(ws, `${cc(3)}${rr}`, pc(p.taxRate), { input: true, fmt: NF.pct });
          w(ws, `${cc(4)}${rr}`, fx(`IF(AND(ISNUMBER(${cc(1)}${rr}),ISNUMBER(${cc(2)}${rr}),ISNUMBER(${cc(3)}${rr})),${cc(1)}${rr}/(1+(1-${cc(3)}${rr})*${cc(2)}${rr}),"")`), { fmt: NFB });
        });
        const r1 = r0 + peers.length - 1;
        const range = `${cc(4)}${r0}:${cc(4)}${r1}`;
        w(ws, `${cc(0)}${r1 + 1}`, 'Mean', { bold: true, fill: T.sub, top: true });
        w(ws, `${cc(4)}${r1 + 1}`, fx(`IF(COUNT(${range})=0,"NM",AVERAGE(${range}))`), { bold: true, fill: T.sub, top: true, fmt: NFB });
        w(ws, `${cc(0)}${r1 + 2}`, 'Median', { bold: true, fill: T.sub });
        w(ws, `${cc(4)}${r1 + 2}`, fx(`IF(COUNT(${range})=0,"NM",MEDIAN(${range}))`), { bold: true, fill: T.sub, fmt: NFB });
        note(ws, `${cc(0)}${r1 + 3}`, 'Each peer unlevered at its own D/E and tax rate. Copy the mean or median into B13 to re-lever it.');
      }
    } else {
      const b = d.buildup || {};
      title(ws, 'A1', 'Cost of Equity – Build-Up Method');
      note(ws, 'A2', 'Cost of Equity = Risk-free Rate + Equity Risk Premium + Size + Industry + Company-specific + Country premia');
      [
        ['Risk-free rate', b.rf, 'e.g. 6.5% – 10-year Government of India bond yield on valuation date'],
        ['Equity risk premium', b.erp, 'e.g. 7.0% – state your source'],
        ['Size premium', b.size, 'e.g. 2.0% – for small / mid-size companies; 0% for large caps'],
        ['Industry risk premium (+/−)', b.industry, 'e.g. 1.0% – can be negative for low-risk industries'],
        ['Company-specific risk premium', b.specific, 'e.g. 1.5% – key-person risk, customer concentration, governance, etc.'],
        ['Country risk premium', b.country, 'e.g. 0.0% – usually 0% when using an INR risk-free rate for an Indian company'],
      ].forEach(([lab, v, eg], i) => {
        w(ws, `A${5 + i}`, lab); w(ws, `B${5 + i}`, pc(v), { input: true, fmt: NF.pct }); note(ws, `C${5 + i}`, eg);
      });
      w(ws, 'A12', 'Cost of Equity (Ke)', KEYST); w(ws, 'B12', fx('SUM(B5:B10)'), { ...KEYST, fmt: NF.pct });
      note(ws, 'A14', 'Document the basis for every premium – the build-up method is judgement-heavy and is often challenged.');
    }
  }

  /* ============================== WACC (FCFF) ============================== */
  if (cf === 'fcff') {
    const ws = wb.addWorksheet('WACC');
    const wc = d.wacc || {};
    const L = lastH;
    ws.getColumn(1).width = 46; ws.getColumn(2).width = 14; ws.getColumn(3).width = 70;
    title(ws, 'A1', 'Weighted Average Cost of Capital (WACC)');
    note(ws, 'A2', 'WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − t)');
    hdr(ws, 'A4', 'Component', { wrap: false }); hdr(ws, 'B4', 'Value', { wrap: false }); hdr(ws, 'C4', 'Format example / note', { wrap: false });
    const U = { bold: true, underline: true };
    const KEYST = { bold: true, fill: KEY, top: true };
    w(ws, 'A5', 'Cost of equity', U);
    w(ws, 'A6', 'Cost of equity (Ke)'); w(ws, 'B6', fx(keRef), { link: true, fmt: NF.pct }); note(ws, 'C6', `From ${coeSheet}`);
    w(ws, 'A8', 'Cost of debt', U);
    w(ws, 'A9', 'Pre-tax cost of debt'); w(ws, 'B9', pc(wc.kd), { input: true, fmt: NF.pct }); note(ws, 'C9', 'e.g. 8.5% – current borrowing rate / credit-rating-based yield');
    w(ws, 'A10', 'Marginal tax rate'); w(ws, 'B10', pc(wc.taxRate), { input: true, fmt: NF.pct }); note(ws, 'C10', 'e.g. 25.2% (Sec 115BAA incl. surcharge & cess) – confirm for the company');
    w(ws, 'A11', 'After-tax cost of debt'); w(ws, 'B11', fx('B9*(1-B10)'), { fmt: NF.pct }); note(ws, 'C11', '');
    w(ws, 'A13', 'Capital structure', U);
    w(ws, 'A14', 'Market value of equity (reference)'); w(ws, 'B14', fx(`${inRef(IN.price)}*${inRef(IN.shares)}`), { fmt: NF.n1 }); note(ws, 'C14', 'Current price × diluted shares');
    w(ws, 'A15', 'Debt incl. leases per toggle (reference)');
    w(ws, 'B15', fx(`Historicals!${L}52+Historicals!${L}57+(Historicals!${L}53+Historicals!${L}58)*${inRef(IN.lease)}`), { link: true, fmt: NF.n1 });
    note(ws, 'C15', 'Latest balance sheet, book value');
    w(ws, 'A16', 'Current D / (D + E) (reference)'); w(ws, 'B16', fx('IFERROR(B15/(B14+B15),0)'), { fmt: NF.pct }); note(ws, 'C16', 'Market-value weight today');
    w(ws, 'A17', 'Target D / (D + E)'); w(ws, 'B17', pc(wc.targetWd), { input: true, fmt: NF.pct }); note(ws, 'C17', 'e.g. 15.0% – long-run target; peer median or current weight are common choices');
    w(ws, 'A18', 'Target E / (D + E)'); w(ws, 'B18', fx('1-B17'), { fmt: NF.pct }); note(ws, 'C18', '');
    w(ws, 'A20', 'WACC', KEYST); w(ws, 'B20', fx('B18*B6+B17*B11'), { ...KEYST, fmt: NF.pct }); note(ws, 'C20', '');
    w(ws, 'A23', 'Net debt bridge (latest balance sheet)', U);
    w(ws, 'A24', 'Total borrowings'); w(ws, 'B24', fx(`Historicals!${L}52+Historicals!${L}57`), { link: true, fmt: NF.n1 }); note(ws, 'C24', '');
    w(ws, 'A25', '(+) Lease liabilities (per toggle)'); w(ws, 'B25', fx(`(Historicals!${L}53+Historicals!${L}58)*${inRef(IN.lease)}`), { link: true, fmt: NF.n1 }); note(ws, 'C25', '');
    w(ws, 'A26', '(−) Cash, bank balances & current investments'); w(ws, 'B26', fx(`Historicals!${L}38+Historicals!${L}39+Historicals!${L}40`), { link: true, fmt: NF.n1 }); note(ws, 'C26', '');
    w(ws, 'A27', 'Net Debt / (Net Cash)', KEYST); w(ws, 'B27', fx('B24+B25-B26'), { ...KEYST, fmt: NF.n1 }); note(ws, 'C27', 'Used in FCFF equity bridge');
    w(ws, 'A28', 'Non-controlling interest'); w(ws, 'B28', fx(`Historicals!${L}49`), { link: true, fmt: NF.n1 }); note(ws, 'C28', 'Deducted in FCFF equity bridge');
  }

  /* ============================== Valuation sheet ============================== */
  {
    const ws = wb.addWorksheet(valSheet);
    ws.getColumn(1).width = 48; ws.getColumn(2).width = 14;
    for (let j = 0; j < m; j++) ws.getColumn(3 + j).width = 13;
    ws.getColumn(vNote).width = 50;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 6, topLeftCell: 'B7' }];
    const S11 = { size: 11 };
    const KEYST = { bold: true, fill: KEY, top: true };
    const SUB = { bold: true, fill: T.sub, top: true };
    const heading = cf === 'fcff' ? 'Free Cash Flow to Firm' : cf === 'fcfe' ? 'Free Cash Flow to Equity' : 'Dividend Discount Model';
    title(ws, 'A1', `${heading} – Terminal Value: ${tv === 'exit' ? `Exit Multiple (${cf === 'fcff' ? 'EV/EBITDA' : 'P/E'})` : 'Gordon Growth'}`);
    w(ws, 'A2', fx(`IF(Inputs!$B$5="","",Inputs!$B$5&" | ")&"${unitLabel} unless stated | End-of-year discounting"`), { italic: true, size: 9, color: T.grey });
    w(ws, 'A4', cf === 'fcff' ? 'WACC' : 'Cost of Equity (Ke)', { bold: true });
    w(ws, 'B4', fx(cf === 'fcff' ? 'WACC!$B$20' : keRef), { bold: true, link: true, fmt: NF.pct });
    hdr(ws, 'A6', unitLabel, { align: 'left', wrap: false });
    hdr(ws, 'B6', null, { wrap: false });
    for (let j = 0; j < m; j++) hdr(ws, `${V(j)}6`, fx(inRef(IN.fcst(j))), { wrap: false });
    w(ws, 'A7', 'Discount period (years)');
    for (let j = 0; j < m; j++) w(ws, `${V(j)}7`, j + 1, { fmt: '0' });
    note(ws, `${vNote}7`, 'End-of-year convention');

    let rr = 9;
    const fr = (label, src, o = {}) => {
      const at = rr++;
      w(ws, `A${at}`, label, o.key ? { bold: true, fill: KEY } : o.bold ? { bold: true } : {});
      for (let j = 0; j < m; j++) w(ws, `${V(j)}${at}`, fx(src(Fc(j))), { link: true, fmt: o.fmt || NF.n1, ...(o.key ? { bold: true, fill: KEY } : o.bold ? { bold: true } : {}) });
      return at;
    };
    let cashRow;
    if (cf === 'fcff') {
      fr('EBIT', (Y) => `Forecast!${Y}44`);
      fr('(−) Taxes on EBIT', (Y) => `Forecast!${Y}45`);
      fr('NOPAT', (Y) => `Forecast!${Y}46`, { bold: true });
      fr('(+) Depreciation & Amortisation', (Y) => `Forecast!${Y}47`);
      fr('(−) Capex', (Y) => `Forecast!${Y}48`);
      fr('(−) Increase in NWC', (Y) => `Forecast!${Y}49`);
      cashRow = fr('Free Cash Flow to Firm', (Y) => `Forecast!${Y}50`, { key: true });
    } else if (cf === 'fcfe') {
      fr('PAT', (Y) => `Forecast!${Y}44`);
      fr('(+) Depreciation & Amortisation', (Y) => `Forecast!${Y}45`);
      fr('(−) Capex', (Y) => `Forecast!${Y}46`);
      fr('(−) Increase in NWC', (Y) => `Forecast!${Y}47`);
      fr('(+) Net Borrowing / (Repayment)', (Y) => `Forecast!${Y}48`);
      cashRow = fr('Free Cash Flow to Equity', (Y) => `Forecast!${Y}49`, { key: true });
    } else {
      fr('PAT', (Y) => `Forecast!${Y}22`);
      fr('Dividend payout (% of PAT)', (Y) => `Assumptions!${Y}26`, { fmt: NF.pct });
      cashRow = fr('Dividends', (Y) => `Forecast!${Y}24`, { key: true });
      fr(`Dividend per share (${sym})`, (Y) => `Forecast!${Y}25`, { fmt: NF.n2 });
    }
    rr++;
    const dfRow = rr++;
    w(ws, `A${dfRow}`, 'Discount factor');
    for (let j = 0; j < m; j++) w(ws, `${V(j)}${dfRow}`, fx(`1/(1+$B$4)^${V(j)}$7`), { ...S11, fmt: NF4 });
    const pvRow = rr++;
    w(ws, `A${pvRow}`, 'Present value', { bold: true });
    for (let j = 0; j < m; j++) w(ws, `${V(j)}${pvRow}`, fx(`${V(j)}${cashRow}*${V(j)}${dfRow}`), { bold: true, fmt: NF.n1 });
    rr++;
    hdr(ws, `A${rr}`, 'Valuation', { align: 'left', wrap: false });
    hdr(ws, `B${rr}`, unitShort, { wrap: false });
    rr++;
    const val = (label, f, o = {}) => {
      const at = rr++;
      const st = o.key ? KEYST : o.sub ? SUB : {};
      w(ws, `A${at}`, label, st);
      w(ws, `B${at}`, f, { align: 'right', fmt: o.fmt || NF.n1, ...(o.link ? { link: true } : o.key || o.sub ? {} : S11), ...st });
      if (o.note) note(ws, `${vNote}${at}`, o.note);
      return at;
    };
    const sumRow = val('Sum of PV of forecast cash flows', fx(`SUM(${V(0)}${pvRow}:${lastV}${pvRow})`));
    let tvRow;
    if (tv === 'gordon') {
      const fin = val('Final-year cash flow', fx(`${lastV}${cashRow}`));
      const g = val('Terminal growth rate (g)', fx(inRef(IN.tv)), { link: true, fmt: NF.pct });
      const nxt = val('Cash flow in year after forecast', fx(`B${fin}*(1+B${g})`));
      tvRow = val('Terminal value', fx(`IF($B$4<=B${g},"NM",B${nxt}/($B$4-B${g}))`), { note: 'NM if discount rate ≤ g' });
    } else {
      const metric = val(`Final-year ${cf === 'fcff' ? 'EBITDA' : 'PAT'}`, fx(`Forecast!${lastF}${cf === 'fcff' ? 13 : 22}`), { link: true });
      const mult = val(`Exit ${multN} multiple`, fx(inRef(IN.tv)), { link: true, fmt: NF.x });
      tvRow = val('Terminal value', fx(`B${metric}*B${mult}`));
    }
    const pvTvRow = val('PV of terminal value', fx(`IF(ISNUMBER(B${tvRow}),B${tvRow}*${lastV}${dfRow},"NM")`));
    let eqRow;
    if (cf === 'fcff') {
      const ev = val('Enterprise Value', fx(`IF(ISNUMBER(B${pvTvRow}),B${sumRow}+B${pvTvRow},"NM")`), { sub: true });
      const nd = val('(−) Net debt / (net cash)', fx('WACC!$B$27'), { link: true });
      const nci = val('(−) Non-controlling interest', fx('WACC!$B$28'), { link: true });
      eqRow = val('Equity Value', fx(`IF(ISNUMBER(B${ev}),B${ev}-B${nd}-B${nci},"NM")`), { key: true });
    } else {
      eqRow = val('Equity Value', fx(`IF(ISNUMBER(B${pvTvRow}),B${sumRow}+B${pvTvRow},"NM")`), { key: true });
    }
    const shRow = val(`Diluted shares outstanding (${unit})`, fx(inRef(IN.shares)), { link: true, fmt: NF.n2 });
    const vpsRow = val(`Value per Share (${sym})`, fx(`IF(AND(ISNUMBER(B${eqRow}),B${shRow}>0),B${eqRow}/B${shRow},"NM")`), { key: true, fmt: NF.n2 });
    const pxRow = val(`Current share price (${sym})`, fx(inRef(IN.price)), { link: true, fmt: NF.n2 });
    val('Upside / (Downside)', fx(`IF(AND(ISNUMBER(B${vpsRow}),B${pxRow}>0),B${vpsRow}/B${pxRow}-1,"NM")`), { fmt: NF.pct });
    val('Terminal value as % of total value', fx(`IFERROR(B${pvTvRow}/(B${sumRow}+B${pvTvRow}),"NM")`), { fmt: NF.pct, note: 'Above ~75% means the value depends heavily on terminal assumptions' });
    if (tv === 'gordon') {
      val(`Implied exit ${multN}`, fx(`IFERROR(B${tvRow}/Forecast!${lastF}${cf === 'fcff' ? 13 : 22},"NM")`), { fmt: NF.x, note: 'Compare with CCA / precedent multiples' });
    } else {
      val('Implied perpetual growth rate', fx(`IFERROR((B${tvRow}*$B$4-${lastV}${cashRow})/(B${tvRow}+${lastV}${cashRow}),"NM")`), { fmt: NF.pct, note: 'Should be below long-run nominal GDP growth' });
    }

    /* sensitivity */
    rr += 2;
    const rateName = cf === 'fcff' ? 'WACC' : 'Ke';
    w(ws, `A${rr}`, `Sensitivity: Value per Share (${sym}) – ${rateName} (rows) vs ${tv === 'exit' ? (cf === 'fcff' ? 'Exit EV/EBITDA' : 'Exit P/E') : 'Terminal growth (g)'} (columns)`, { bold: true });
    const hr = rr + 1;
    hdr(ws, `B${hr}`, tv === 'exit' ? 'Rate ↓ / Multiple →' : 'Rate ↓ / g →');
    const ks = [-2, -1, 0, 1, 2];
    ks.forEach((k, c) => hdr(ws, `${V(c)}${hr}`, fx(`${inRef(IN.tv)}+(${k})*${inRef(IN.tvStep)}`), { wrap: false, fmt: tv === 'exit' ? NF.x : NF.pct }));
    const cashRange = `$${V(0)}$${cashRow}:$${lastV}$${cashRow}`;
    const perRange = `$${V(0)}$7:$${lastV}$7`;
    const less = cf === 'fcff' ? '-WACC!$B$27-WACC!$B$28' : '';
    ks.forEach((k, i) => {
      const row = hr + 1 + i;
      w(ws, `B${row}`, fx(`$B$4+(${k})*${inRef(IN.rateStep)}`), { bold: true, fill: T.sec, fmt: NF.pct, align: 'center' });
      ks.forEach((_, c) => {
        const C = V(c);
        const pvs = `SUMPRODUCT(${cashRange}/(1+$B${row})^${perRange})`;
        const disc = `(1+$B${row})^$${lastV}$7`;
        const f = tv === 'gordon'
          ? `IFERROR(IF(OR($B${row}<=${C}$${hr},${inRef(IN.shares)}<=0),"NM",(${pvs}+$${lastV}$${cashRow}*(1+${C}$${hr})/($B${row}-${C}$${hr})/${disc}${less})/${inRef(IN.shares)}),"NM")`
          : `IFERROR(IF(${inRef(IN.shares)}<=0,"NM",(${pvs}+Forecast!$${lastF}$${cf === 'fcff' ? 13 : 22}*${C}$${hr}/${disc}${less})/${inRef(IN.shares)}),"NM")`;
        const centre = i === 2 && c === 2;
        w(ws, `${C}${row}`, fx(f), { fmt: NF.n2, align: 'right', ...(centre ? { bold: true, fill: KEY } : S11) });
      });
    });
    note(ws, `A${hr + 6}`, 'Centre cell (shaded) equals the base-case value per share. Step sizes are set on Inputs.');
  }

  /* tab order, as the templates */
  const order = ['Instructions', 'Inputs', valSheet, 'Historicals', 'Assumptions', 'Forecast', coeSheet, 'WACC'];
  const rank = new Map(order.map((nm, i) => [nm, i]));
  wb.worksheets.forEach((ws, i) => { ws.orderNo = rank.has(ws.name) ? rank.get(ws.name) : order.length + i; });
  return wb;
}


/**
 * The Historicals sheet shared by the DCF and LBO templates: the company page
 * (P&L, balance sheet, cash flow) for n years, inputs blue on cream.
 * o: { page, n, label(k) → the Inputs period-label ref, unitLabel, unit, sym }.
 */
export function writeHistoricals(wb, { page, n, label, unitLabel, unit, sym }) {
  const H = (i) => colL(2 + i);
  const ws = wb.addWorksheet('Historicals');
  ws.getColumn(1).width = 52;
  for (let i = 0; i < n; i++) ws.getColumn(2 + i).width = 13;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];
  w(ws, 'A1', fx(`IF(Inputs!$B$5="","Historical Financials",Inputs!$B$5&" – Historical Financials")`), { bold: true, size: 14, link: true });
  note(ws, 'A2', `Consolidated, ${unitLabel}. Expenses positive in P&L; outflows negative in cash flow. Example format: Revenue 5,300.0`);
  hdr(ws, 'A4', 'Particulars', { align: 'left', wrap: false });
  for (let i = 0; i < n; i++) hdr(ws, `${H(i)}4`, fx(label(i)), { wrap: false });
  const sec = (rr, text) => { w(ws, `A${rr}`, text, { bold: true, fill: T.sec }); for (let i = 0; i < n; i++) w(ws, `${H(i)}${rr}`, null, { size: 11, fill: T.sec }); };
  const SUB = { bold: true, fill: T.sub, top: true };
  const F = {
    opex: (X) => `SUM(${X}9:${X}11)`, ebitda: (X) => `${X}7-${X}12`, ebit: (X) => `${X}13-${X}14`,
    pbt: (X) => `${X}15+${X}8-${X}16+${X}17`, pat: (X) => `${X}18-${X}19`, patOwners: (X) => `${X}20+${X}21-${X}22`,
    eps: (X) => `IFERROR(${X}23/${X}24,0)`,
    totalNca: (X) => `SUM(${X}29:${X}33)`, totalCa: (X) => `SUM(${X}36:${X}41)`, totalAssets: (X) => `${X}34+${X}42`,
    eqOwners: (X) => `${X}46+${X}47`, totalEquity: (X) => `${X}48+${X}49`, totalNcl: (X) => `SUM(${X}52:${X}54)`,
    totalCl: (X) => `SUM(${X}57:${X}60)`, totalEL: (X) => `${X}50+${X}55+${X}61`, check: (X) => `ROUND(${X}43-${X}62,1)`,
    cfo: (X) => `SUM(${X}66:${X}71)`, cfi: (X) => `SUM(${X}73:${X}77)`, cff: (X) => `SUM(${X}79:${X}84)`,
    netCash: (X) => `${X}72+${X}78+${X}85`, fcf: (X) => `${X}72+${X}73`,
  };
  const lines = (list) => {
    for (const line of list) {
      if (line.key === 'totalIncome') continue;
      const rr = hRow(line);
      if (line.head) { w(ws, `A${rr}`, line.head, { bold: true, underline: true }); continue; }
      const fmt = line.key === 'shares' || line.key === 'eps' ? NF.n2 : NF.n1;
      const lab = line.kind === 'shares' ? `${line.label} (${unit})` : line.kind === 'pershare' ? `${line.label} (${sym})` : line.label;
      const st = line.sub ? SUB : {};
      w(ws, `A${rr}`, lab, st);
      for (let i = 0; i < n; i++) {
        const X = H(i);
        if (line.input) {
          const v = fyValues(page?.lines?.[line.key], n)[i];
          w(ws, `${X}${rr}`, num(v), { input: true, fmt });
        } else w(ws, `${X}${rr}`, fx(F[line.key](X)), { fmt, ...st });
      }
    }
  };
  sec(6, 'INCOME STATEMENT'); lines(IS_LINES);
  sec(27, 'BALANCE SHEET'); lines(BS_LINES);
  sec(65, 'CASH FLOW STATEMENT'); lines(CF_LINES);
}

/**
 * The Assumptions sheet shared by the DCF and LBO templates: each driver row
 * of `defs` with its historical reference ratios (live formulas on
 * Historicals) and one cream input per forecast year.
 * o: { defs, drivers (stored values, % as 12 = 12 %), n, m, label(k), unitShort }.
 */
export function writeAssumptions(wb, { defs, drivers, n, m, label, unitShort }) {
  const H = (i) => colL(2 + i);
  const Fc = (j) => colL(2 + n + j);
  const allCols = [...Array(n)].map((_, i) => H(i)).concat([...Array(m)].map((_, j) => Fc(j)));
  const ws = wb.addWorksheet('Assumptions');
  const exCol = colL(2 + n + m + 1), noteCol = colL(2 + n + m + 2);
  ws.getColumn(1).width = 44;
  allCols.forEach((c) => { ws.getColumn(c).width = 12; });
  ws.getColumn(colL(2 + n + m)).width = 3;
  ws.getColumn(exCol).width = 14; ws.getColumn(noteCol).width = 55;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];
  title(ws, 'A1', 'Forecast Assumptions (Drivers)');
  note(ws, 'A2', 'Historical ratios (black) are calculated for reference. Type forecast drivers in the cream cells.');
  w(ws, 'B3', 'Historical (reference)', { bold: true });
  w(ws, `${Fc(0)}3`, 'Forecast (inputs)', { bold: true });
  hdr(ws, 'A4', 'Driver', { align: 'left', wrap: false });
  allCols.forEach((c, k) => hdr(ws, `${c}4`, fx(label(k)), { wrap: false }));
  hdr(ws, `${exCol}4`, 'Format example', { wrap: false });
  hdr(ws, `${noteCol}4`, 'Basis / note', { wrap: false });
  const Hs = (X, row) => `Historicals!${X}${row}`;
  const refF = {
    materials: (X) => `IFERROR(${Hs(X, 9)}/${Hs(X, 7)},"")`,
    employee: (X) => `IFERROR(${Hs(X, 10)}/${Hs(X, 7)},"")`,
    otherExp: (X) => `IFERROR(${Hs(X, 11)}/${Hs(X, 7)},"")`,
    da: (X) => `IFERROR(${Hs(X, 14)}/${Hs(X, 7)},"")`,
    otherInc: (X) => `IFERROR(${Hs(X, 8)}/${Hs(X, 7)},"")`,
    tax: (X) => `IFERROR(${Hs(X, 19)}/${Hs(X, 18)},"")`,
    capex: (X) => `IFERROR(-${Hs(X, 73)}/${Hs(X, 7)},"")`,
    invDays: (X) => `IFERROR(${Hs(X, 36)}/${Hs(X, 9)}*365,"")`,
    recDays: (X) => `IFERROR(${Hs(X, 37)}/${Hs(X, 7)}*365,"")`,
    payDays: (X) => `IFERROR(${Hs(X, 59)}/${Hs(X, 9)}*365,"")`,
    oca: (X) => `IFERROR(${Hs(X, 41)}/${Hs(X, 7)},"")`,
    ocl: (X) => `IFERROR(${Hs(X, 60)}/${Hs(X, 7)},"")`,
    netBorrow: (X) => `IFERROR(${Hs(X, 79)},"")`,
    payout: (X) => `IFERROR(-${Hs(X, 81)}/${Hs(X, 23)},"")`,
  };
  for (const dr of defs) {
    if (dr.section) {
      w(ws, `A${dr.row}`, dr.section, { bold: true, fill: T.sec });
      allCols.forEach((c) => w(ws, `${c}${dr.row}`, null, { size: 11, fill: T.sec }));
      continue;
    }
    const fmt = dr.fmt === 'pct' ? NF.pct : dr.fmt === 'days' ? NF.n0 : NF.n1;
    w(ws, `A${dr.row}`, dr.fmt === 'money' ? `${dr.label} (${unitShort})` : dr.label);
    for (let i = 0; i < n; i++) {
      const X = H(i);
      if (dr.key === 'gRev' || dr.key === 'intRate') {
        if (i === 0) { w(ws, `${X}${dr.row}`, 'n.a.', { italic: true, size: 9, color: T.grey, align: 'right', fmt }); continue; }
        const P = H(i - 1);
        const f = dr.key === 'gRev' ? `IFERROR(${Hs(X, 7)}/${Hs(P, 7)}-1,"")` : `IFERROR(${Hs(X, 16)}/(${Hs(P, 52)}+${Hs(P, 57)}),"")`;
        w(ws, `${X}${dr.row}`, fx(f), { fmt });
      } else w(ws, `${X}${dr.row}`, fx(refF[dr.key](X)), { fmt });
    }
    for (let j = 0; j < m; j++) {
      const v = drivers?.[dr.key]?.[j];
      w(ws, `${Fc(j)}${dr.row}`, dr.fmt === 'pct' ? pc(v) : num(v), { input: true, fmt });
    }
    w(ws, `${exCol}${dr.row}`, dr.example, { italic: true, size: 9, color: T.grey, align: 'right' });
    note(ws, `${noteCol}${dr.row}`, dr.note || '');
  }
}
