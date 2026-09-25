/**
 * Precedent transactions workbook, in the layout of the Rosenbaum & Pearl
 * (Investment Banking, 3E) template:
 *
 *   Precedent      — the output page: one row per deal with the LTM
 *                    transaction multiples, LTM EBITDA margin and premiums paid
 *                    at 1 / 7 / 30 days, Mean / Median / High / Low, and the
 *                    implied takeover value per share for the target
 *   Deal List      — date, acquirer, target, type, business description,
 *                    equity and enterprise value, LTM sales and EBITDA
 *   <ACQ - TGT> ×n — one full input page per transaction
 *
 * A deal's input page is the comparable-company page (compsSheets.js) with
 * the target's reported financials PRICED AT THE OFFER (its price cell links
 * to the offer-price build), plus the deal-terms block. The purchase
 * consideration decides which offer legs apply (engine/precedentDeal.js):
 * Cash → cash only, Stock → stock only, Cash / Stock → both; unchosen → NA.
 * The target's LTM revenue and EBITDA come from the Inputs sheet.
 */
import {
  put, colL, colRun, na, nv, sheetName, styleSheet, edge,
  C_INPUT, C_LINK, C_HDR_FILL, C_HDR_TEXT, C_SECTION_FILL, C_GRID_FILL, C_MUTED,
  C_RULE, C_TAB_ANALYSIS, C_TAB_INPUT, C_INPUT_FILL,
} from './xlsxUtil.js';
import { writeCompanySheet, companyLayout } from './compsSheets.js';
import { OUTPUT_GROUPS, LIST_COLS } from '../engine/precedent.js';
import { PREMIUM_DAYS } from '../engine/precedentDeal.js';

const kindFmt = (kind, F) => ({
  money: F.plain, price: F.price, pct: F.pct, x: F.x2, num: F.num3, date: F.date, text: null,
}[kind] ?? null);

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const dateV = (s) => {
  if (!s) return 'NA';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : 'NA';
};

/** Rows the deal-terms block adds beneath the shared company-page layout. */
export function dealLayout() {
  return {
    hdr: 71, tgt: 72, tgtTicker: 73, acq: 74, acqTicker: 75,
    announced: 76, effective: 77, type: 78, consideration: 79,
    offerHdr: 81, cashOffer: 82, ratio: 83, acqPrice: 84, stockOffer: 85, cashLeg: 86, offer: 87,
    fdShares: 88, equityValue: 89,
    evHdr: 91, plusDebt: 92, plusPref: 93, plusNci: 94, lessCash: 95, ev: 96,
    multHdr: 98, evSales: 99, evSalesM: 100, evEbitda: 101, evEbitdaM: 102,
    evEbit: 103, evEbitM: 104, pe: 105, peM: 106,
    premHdr: 108, premFirst: 109,
  };
}

/** Absolute references the output and list pages link to. */
export function dealRefs(name, DL, L) {
  const q = `'${name.replace(/'/g, "''")}'`;
  const at = (addr) => `${q}!${addr}`;
  const r = {
    sheet: name,
    acquirer: at(`$E$${DL.acq}`), target: at(`$E$${DL.tgt}`),
    dateAnnounced: at(`$E$${DL.announced}`), type: at(`$E$${DL.type}`),
    consideration: at(`$E$${DL.consideration}`),
    description: at('$P$2'),
    offerPrice: at(`$E$${DL.offer}`),
    equityValue: at(`$E$${DL.equityValue}`), enterpriseValue: at(`$E$${DL.ev}`),
    evSales: at(`$E$${DL.evSales}`), evEbitda: at(`$E$${DL.evEbitda}`),
    evEbit: at(`$E$${DL.evEbit}`), pe: at(`$E$${DL.pe}`),
    ltmSales: at(`$N$${L.sales}`), ltmEbitda: at(`$N$${L.adjEbitda}`),
    ebitdaMargin: at(`$N$${L.adjEbitdaM}`),
  };
  PREMIUM_DAYS.forEach((d, i) => { r[`prem${d}`] = at(`$E$${DL.premFirst + i}`); });
  return r;
}

/* ------------------------------------------------------- deal input page */

export function writeDealSheet(ws, dealPage, L, DL, F, opts) {
  const { unitNote } = opts;
  const deal = dealPage.deal;

  // the financial half is the comps company page, priced at the offer
  writeCompanySheet(ws, deal.target, L, F, {
    unitNote, subtitle: 'Input Page — transaction (the target priced at the offer)', priceFormula: `E${DL.offer}`,
  });
  put(ws, 'A1', `Acquisition of ${deal.target.name || 'the target'} by ${deal.acquirer || 'the acquirer'}`, { bold: true, size: 14 });
  // the deal's own target description wins over the page's (as on the Deal List)
  put(ws, 'P2', deal.targetDescription || deal.target.description || '[to come]', { color: C_INPUT, wrap: true, wrapTop: true });

  const IN = { color: C_INPUT, fill: C_INPUT_FILL };
  const lbl = (row, text, o = {}) => put(ws, `A${row}`, text, o);
  const inp = (row, v, fmt) => put(ws, `E${row}`, v, { fmt, ...IN, align: 'right' });
  const fml = (row, f, fmt, o = {}) => put(ws, `E${row}`, { formula: f }, { fmt, align: 'right', ...o });
  const hdr = (row, text) => {
    for (let i = 0; i < 5; i++) put(ws, `${colL(1 + i)}${row}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
    ws.mergeCells(`A${row}:E${row}`);
    ws.getRow(row).height = 18;
  };
  const MUTED = { italic: true, color: C_MUTED };

  /* ---- transaction ---- */
  hdr(DL.hdr, 'Transaction');
  lbl(DL.tgt, 'Target'); fml(DL.tgt, `E${L.name}`, null, { color: C_LINK });
  lbl(DL.tgtTicker, '   Ticker'); fml(DL.tgtTicker, `E${L.ticker}`, null, { color: C_LINK });
  lbl(DL.acq, 'Acquirer'); inp(DL.acq, deal.acquirer || '', null);
  lbl(DL.acqTicker, '   Ticker'); inp(DL.acqTicker, deal.acquirerTicker || '', null);
  lbl(DL.announced, 'Date Announced'); inp(DL.announced, dateV(deal.dateAnnounced), F.date);
  lbl(DL.effective, 'Date Effective'); inp(DL.effective, deal.dateEffective || '', null);
  lbl(DL.type, 'Transaction Type'); inp(DL.type, deal.transactionType || '', null);
  lbl(DL.consideration, 'Purchase Consideration ("Cash", "Stock" or "Cash / Stock")'); inp(DL.consideration, deal.consideration || '', null);

  /* ---- offer price & equity value ---- */
  const cons = `E${DL.consideration}`;
  const hasCash = `OR(${cons}="Cash",${cons}="Cash / Stock")`;
  const hasStock = `OR(${cons}="Stock",${cons}="Cash / Stock")`;
  hdr(DL.offerHdr, 'Calculation of Equity and Enterprise Value');
  lbl(DL.cashOffer, 'Cash Offer Price per Share'); inp(DL.cashOffer, nv(toNum(deal.cashOffer)), F.price);
  lbl(DL.ratio, 'Exchange Ratio (acquirer shares per target share)'); inp(DL.ratio, nv(toNum(deal.exchangeRatio)), F.num3);
  lbl(DL.acqPrice, 'Acquirer Share Price'); inp(DL.acqPrice, nv(toNum(deal.acquirerPrice)), F.price);
  lbl(DL.stockOffer, '   Stock Leg per Share (ratio × acquirer price)', MUTED);
  fml(DL.stockOffer, `IF(${hasStock},${na(`E${DL.ratio}*E${DL.acqPrice}`)},IF(${cons}="Cash",0,"NA"))`, F.price, MUTED);
  lbl(DL.cashLeg, '   Cash Leg per Share', MUTED);
  fml(DL.cashLeg, `IF(${hasCash},E${DL.cashOffer},IF(${cons}="Stock",0,"NA"))`, F.price, MUTED);
  lbl(DL.offer, '   Offer Price per Share', { bold: true });
  fml(DL.offer, na(`E${DL.cashLeg}+E${DL.stockOffer}`), F.price, { bold: true, top: true });
  lbl(DL.fdShares, 'Fully Diluted Shares Outstanding (at the offer)');
  fml(DL.fdShares, `T${L.fullyDiluted}`, F.shares, { color: C_LINK });
  lbl(DL.equityValue, '   Implied Equity Value', { bold: true });
  fml(DL.equityValue, na(`E${DL.offer}*E${DL.fdShares}`), F.money, { bold: true, top: true });

  /* ---- enterprise value bridge ---- */
  hdr(DL.evHdr, 'Implied Enterprise Value');
  lbl(DL.plusDebt, 'Plus: Total Debt'); fml(DL.plusDebt, `T${L.bsDebt}`, F.money, { color: C_LINK });
  lbl(DL.plusPref, 'Plus: Preferred Stock'); fml(DL.plusPref, `T${L.bsPref}`, F.money, { color: C_LINK });
  lbl(DL.plusNci, 'Plus: Noncontrolling Interest'); fml(DL.plusNci, `T${L.bsNci}`, F.money, { color: C_LINK });
  lbl(DL.lessCash, 'Less: Cash and Cash Equivalents'); fml(DL.lessCash, na(`-T${L.bsCash}`), F.money, { color: C_LINK });
  lbl(DL.ev, '   Implied Enterprise Value', { bold: true });
  fml(DL.ev, na(`E${DL.equityValue}+E${DL.plusDebt}+E${DL.plusPref}+E${DL.plusNci}+E${DL.lessCash}`), F.money, { bold: true, top: true, bottom: 'double' });

  /* ---- LTM transaction multiples ---- */
  hdr(DL.multHdr, 'LTM Transaction Multiples');
  const mult = (row, mRow, label, base, metricRef, metricFmt) => {
    lbl(row, label, { bold: true });
    fml(row, `IF(ISNUMBER(E${mRow}),IF(E${mRow}<=0,"NM",${na(`${base}/E${mRow}`)}),"NA")`, F.x2, { bold: true });
    lbl(mRow, '   Metric', MUTED);
    fml(mRow, metricRef, metricFmt, { italic: true, color: C_LINK });
  };
  const ev = `$E$${DL.ev}`, offer = `$E$${DL.offer}`;
  mult(DL.evSales, DL.evSalesM, 'EV / LTM Sales', ev, `N${L.sales}`, F.money);
  mult(DL.evEbitda, DL.evEbitdaM, 'EV / LTM EBITDA', ev, `N${L.adjEbitda}`, F.money);
  mult(DL.evEbit, DL.evEbitM, 'EV / LTM EBIT', ev, `N${L.adjEbit}`, F.money);
  mult(DL.pe, DL.peM, 'Offer Price / LTM EPS', offer, `N${L.adjEps}`, F.price);

  /* ---- premiums paid ---- */
  hdr(DL.premHdr, 'Premiums Paid — offer price over the unaffected share price');
  PREMIUM_DAYS.forEach((d, i) => {
    const row = DL.premFirst + i;
    lbl(row, `${d} day${d > 1 ? 's' : ''} prior — unaffected price`);
    put(ws, `C${row}`, nv(toNum(deal.unaffected?.[d])), { fmt: F.price, ...IN, align: 'right' });
    fml(row, `IF(AND(ISNUMBER(C${row}),C${row}>0),${na(`${offer}/C${row}-1`)},"NA")`, F.pct, { bold: true });
  });
  put(ws, `A${DL.premFirst + PREMIUM_DAYS.length + 1}`,
    'Blue cells are inputs. The consideration decides which offer legs apply; a leg the deal has must be filled, or the offer price reads NA.',
    { italic: true, color: C_MUTED, size: 9 });

  return dealRefs(ws.name, DL, L);
}

/* ------------------------------------------------------------ output page */

export function writePrecedentOutput(ws, o) {
  const { F, unitNote, allRefs, source, R } = o;
  const cols = [];
  let c = 2;
  const plan = [];
  for (const g of OUTPUT_GROUPS) {
    if (plan.length) plan.push({ kind: 'spacer', col: colL(c++) });
    const start = c;
    for (const spec of g.cols) { const col = colL(c++); cols.push({ col, spec }); plan.push({ kind: 'col', col, spec }); }
    plan.push({ kind: 'span', title: g.title, from: start, to: c - 1 });
  }
  const lastCol = c - 1;
  const allCols = colRun(2, lastCol);

  ws.getColumn('A').width = 1.4;
  for (const p of plan) {
    if (p.kind === 'spacer') ws.getColumn(p.col).width = 1.4;
    else if (p.kind === 'col') ws.getColumn(p.col).width = { text: 24, date: 13, money: 14 }[p.spec.kind] ?? 12.5;
  }
  styleSheet(ws, { freezeRow: 9, freezeCol: 4, tab: C_TAB_ANALYSIS, printTitles: '1:9' });

  put(ws, 'B1', { formula: R.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'Precedent Transactions Analysis', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  const R_GROUP = 6, R_LABEL = 8, R_UNIT = 9;
  for (const g of plan.filter((p) => p.kind === 'span')) {
    if (!g.title) continue;
    for (let k = g.from; k <= g.to; k++) {
      put(ws, `${colL(k)}${R_GROUP}`, k === g.from ? g.title : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true, align: 'center' });
    }
    if (g.to > g.from) ws.mergeCells(`${colL(g.from)}${R_GROUP}:${colL(g.to)}${R_GROUP}`);
  }
  ws.getRow(R_GROUP).height = 19;
  for (const { col, spec } of cols) put(ws, `${col}${R_LABEL}`, spec.label, { bold: true, fill: C_SECTION_FILL, align: 'center', wrap: true });
  ws.getRow(R_LABEL).height = 34;
  ws.getRow(R_UNIT).height = 4;
  edge(ws, R_UNIT, allCols, 'bottom', 'medium', C_HDR_FILL);

  let r = 11;
  const first = r;
  for (const refs of allRefs) {
    for (const { col, spec } of cols) {
      const ref = refs[spec.key];
      if (!ref) continue;
      put(ws, `${col}${r}`, { formula: ref }, { fmt: kindFmt(spec.kind, F), color: C_LINK, align: spec.kind === 'text' ? 'left' : 'right', wrap: spec.kind === 'text' });
    }
    r++;
  }
  const last = Math.max(first, r - 1);
  edge(ws, last, allCols, 'bottom', 'thin', C_RULE);
  r++;

  const range = (col) => `${col}${first}:${col}${last}`;
  for (const [label, fn] of [['Mean', 'AVERAGE'], ['Median', 'MEDIAN'], [null, null], ['High', 'MAX'], ['Low', 'MIN']]) {
    if (!label) { r++; continue; }
    put(ws, `B${r}`, label, { bold: true });
    for (const { col, spec } of cols) {
      if (!spec.stat) continue;
      const f = fn === 'MAX' || fn === 'MIN' ? `IF(COUNT(${range(col)})=0,"NA",${fn}(${range(col)}))` : na(`${fn}(${range(col)})`);
      put(ws, `${col}${r}`, { formula: f }, { fmt: kindFmt(spec.kind, F), bold: true, align: 'right' });
    }
    if (label === 'Mean') edge(ws, r, allCols, 'top', 'thin', C_RULE);
    r++;
  }
  r += 2;

  /* ---- implied takeover value: deal quartiles applied to the target ---- */
  const colOf = (key) => (cols.find((x) => x.spec.key === key) || {}).col;
  const bannerRow = r;
  for (let i = 0; i < 4; i++) put(ws, `${colL(2 + i)}${r}`, i === 0 ? 'IMPLIED TAKEOVER VALUE PER SHARE' : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
  ws.mergeCells(`B${r}:E${r}`);
  ws.getRow(r).height = 19;
  r++;
  ['', '25th percentile', 'Median', '75th percentile'].forEach((h, i) =>
    put(ws, `${colL(2 + i)}${r}`, h, { bold: true, fill: C_SECTION_FILL, align: i ? 'center' : 'left' }));
  edge(ws, r, colRun(2, 5), 'bottom', 'thin', C_RULE);
  r++;

  const stat = (col, q) => (q === 2 ? `MEDIAN(${range(col)})` : `QUARTILE(${range(col)},${q === 1 ? 1 : 3})`);
  const refs = {};
  const bridge = (label, key, metricRef) => {
    put(ws, `B${r}`, label, { bold: true });
    const col = colOf(key);
    [['C', 1], ['D', 2], ['E', 3]].forEach(([out, q]) => {
      put(ws, `${out}${r}`, { formula: na(`IF(${R.shares}>0,(${stat(col, q)}*${metricRef}-${R.netDebt})/${R.shares},"NA")`) },
        { fmt: F.price, align: 'right', bold: q === 2 });
    });
    refs[key] = { lo: `'${ws.name}'!$C$${r}`, mid: `'${ws.name}'!$D$${r}`, hi: `'${ws.name}'!$E$${r}` };
    r++;
  };
  bridge('EV / LTM Sales × target LTM revenue', 'evSales', R.pRev);
  bridge('EV / LTM EBITDA × target LTM EBITDA', 'evEbitda', R.pEbitda);

  // premia analysis: the observed 1-day premia applied to today's share price
  put(ws, `B${r}`, 'Premiums paid (1-day) on the current share price', { bold: true });
  const pcol = colOf(`prem${PREMIUM_DAYS[0]}`);
  [['C', 1], ['D', 2], ['E', 3]].forEach(([out, q]) => {
    put(ws, `${out}${r}`, { formula: na(`IF(AND(ISNUMBER(${R.curPrice}),${R.curPrice}>0),${R.curPrice}*(1+${stat(pcol, q)}),"NA")`) }, { fmt: F.price, align: 'right', bold: q === 2 });
  });
  refs.premia = { lo: `'${ws.name}'!$C$${r}`, mid: `'${ws.name}'!$D$${r}`, hi: `'${ws.name}'!$E$${r}` };
  r++;
  for (let rr = bannerRow + 2; rr < r; rr++) ws.getCell(`D${rr}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRID_FILL } };
  edge(ws, r - 1, colRun(2, 5), 'bottom', 'double', C_HDR_FILL);
  r += 2;

  put(ws, `B${r++}`, `Source: ${source}`, { italic: true, color: C_MUTED, size: 9 });
  put(ws, `B${r++}`, 'Deal multiples embed the control premium and are applied to the target\'s LTM metrics (Inputs sheet). Every row is shown side by side.', { italic: true, color: C_MUTED, size: 9 });
  put(ws, `B${r++}`, 'Statistics exclude deals reporting NA (not available) or NM (not meaningful) for a given line.', { italic: true, color: C_MUTED, size: 9 });
  return { statFirst: first, statLast: last, cols, refs };
}

/* -------------------------------------------------------------- list page */

export function writeDealList(ws, o) {
  const { F, unitNote, allRefs, source, R } = o;
  ws.getColumn('A').width = 1.4;
  const widths = [13, 26, 26, 20, 60, 15, 15, 14, 14];
  LIST_COLS.forEach((_, i) => { ws.getColumn(2 + i).width = widths[i] ?? 14; });
  const allCols = colRun(2, 1 + LIST_COLS.length);
  styleSheet(ws, { freezeRow: 7, freezeCol: 4, tab: C_TAB_ANALYSIS, printTitles: '1:7' });

  put(ws, 'B1', { formula: R.name }, { bold: true, size: 16, color: C_LINK });
  put(ws, 'B2', 'List of Comparable Acquisitions', { bold: true, size: 12 });
  put(ws, 'B3', unitNote, { italic: true, color: C_MUTED });
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 17;
  ws.getRow(4).height = 6;
  edge(ws, 4, allCols, 'bottom', 'medium', C_HDR_FILL);

  LIST_COLS.forEach((c, i) => put(ws, `${colL(2 + i)}6`, c.label, { bold: true, fill: C_SECTION_FILL, align: i > 4 ? 'center' : 'left', wrap: true }));
  ws.getRow(6).height = 20;
  ws.getRow(7).height = 4;
  edge(ws, 7, allCols, 'bottom', 'medium', C_HDR_FILL);

  let r = 9;
  for (const refs of allRefs) {
    LIST_COLS.forEach((c, i) => {
      const ref = refs[c.key];
      if (!ref) return;
      put(ws, `${colL(2 + i)}${r}`, { formula: ref }, { fmt: kindFmt(c.kind, F), color: C_LINK, align: c.kind === 'money' ? 'right' : 'left', wrap: c.wide, wrapTop: c.wide });
    });
    ws.getRow(r).height = 28;
    r++;
  }
  edge(ws, r - 1, allCols, 'bottom', 'thin', C_RULE);
  r++;
  put(ws, `B${r}`, `Source: ${source}`, { italic: true, color: C_MUTED, size: 9 });
  return ws;
}

/* ------------------------------------------------------------- package */

/** Build the precedent package onto a workbook. `R` holds the Inputs refs. */
export function addPrecedentSheets(wb, a, prec, F, unitNote, taken, R) {
  const deals = prec.deals;
  const source = a.precedent?.source || 'Company filings, press releases, merger proxies';

  const optCount = Math.max(5, ...deals.map((d) => (d.deal.target.options || []).length));
  const convCount = Math.max(5, ...deals.map((d) => (d.deal.target.converts || []).length));
  const L = companyLayout(optCount, convCount);
  const DL = dealLayout();

  const outName = sheetName('Precedent', taken);
  const listName = sheetName('Deal List', taken);
  const dealNames = deals.map((d) => sheetName(`${d.deal.acquirer || 'Acquirer'} - ${d.page.co.name || 'Target'}`.slice(0, 31), taken));

  const outWs = wb.addWorksheet(outName);
  const listWs = wb.addWorksheet(listName);
  const allRefs = deals.map((d, i) => {
    const ws = wb.addWorksheet(dealNames[i]);
    const refs = writeDealSheet(ws, d, L, DL, F, { unitNote });
    ws.properties.tabColor = { argb: C_TAB_INPUT };
    return refs;
  });

  const out = writePrecedentOutput(outWs, { F, unitNote, allRefs, source, R });
  writeDealList(listWs, { F, unitNote, allRefs, source, R });

  return { order: [outName, listName, ...dealNames], outName, listName, dealNames, layout: L, dealLayout: DL, allRefs, refs: out.refs };
}
