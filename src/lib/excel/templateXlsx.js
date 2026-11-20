/**
 * Shared pieces of the Comparable Company and Precedent Transactions
 * workbooks, in the templates' own look:
 *   Arial 10 · blue text on cream = input · black = formula · green = link ·
 *   grey fill = not applicable · navy header rows · light-blue section rows ·
 *   grey subtotal rows with a thin rule · negatives in brackets.
 *
 * `writeCompanySheet` writes one company page (Target / Peer k / Company Being
 * Valued / Deal k) with the rows of engine/companyPage.js, for N fiscal years
 * and with or without the YTD columns, every cell a live formula exactly as
 * in the template.
 */
import { IS_LINES, BS_LINES, CF_LINES, RATIO_LINES, fyValues } from '../engine/companyPage.js';
import { colL } from './xlsxUtil.js';
import { STAT_LABELS } from '../engine/templateStats.js';

export const T = {
  navy: 'FF1F3864', grey: 'FF595959', blue: 'FF0000FF', green: 'FF008000', black: 'FF000000', white: 'FFFFFFFF',
  cream: 'FFFFF2CC', na: 'FFE7E6E6', sub: 'FFF2F2F2', sec: 'FFD9E1F2', rule: 'FF808080',
};
export const NF = {
  n0: '#,##0;(#,##0);-',
  n1: '#,##0.0;(#,##0.0);-',
  n2: '#,##0.00;(#,##0.00);-',
  pct: '0.0%;(0.0%);-',
  x: '0.0x;(0.0"x)";-',
  date: 'dd-mmm-yyyy',
};

/**
 * Write one cell. o: { f (formula) | v, fmt, bold, italic, underline, size,
 * color, fill, align, valign, wrap, top (thin rule), input, link }.
 */
export function w(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  if (value !== undefined && value !== null && value !== '') c.value = value;
  const font = { name: 'Arial', size: o.size || 10 };
  if (o.bold) font.bold = true;
  if (o.italic) font.italic = true;
  if (o.underline) font.underline = 'single';
  const color = o.input ? T.blue : o.link ? T.green : o.color;
  if (color) font.color = { argb: color };
  c.font = font;
  const fill = o.input ? T.cream : o.fill;
  if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  if (o.fmt) c.numFmt = o.fmt;
  if (o.align || o.valign || o.wrap) c.alignment = { horizontal: o.align, vertical: o.valign || (o.wrap ? 'middle' : undefined), wrapText: !!o.wrap };
  if (o.top) c.border = { top: { style: 'thin', color: { argb: T.rule } } };
  return c;
}
export const fx = (formula) => ({ formula });
export const title = (ws, addr, text, o = {}) => w(ws, addr, text, { bold: true, size: 14, color: T.navy, ...o });
export const note = (ws, addr, text) => w(ws, addr, text, { italic: true, size: 9, color: T.grey });
/** A navy header cell. */
export const hdr = (ws, addr, text, o = {}) => w(ws, addr, text, { bold: true, color: T.white, fill: T.navy, align: 'center', valign: 'middle', wrap: true, ...o });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Column letters of a company sheet for n years, with or without YTD columns. */
export function pageCols(n, ytd) {
  const fy = Array.from({ length: n }, (_, j) => colL(2 + j));
  const P = ytd ? colL(2 + n) : null;
  const C = ytd ? colL(3 + n) : null;
  const L = colL(ytd ? 4 + n : 2 + n);
  const Lnum = ytd ? 4 + n : 2 + n;
  return { fy, P, C, L, last: fy[n - 1], labelCol: colL(Lnum + 2), valCol: colL(Lnum + 3), spacer: colL(Lnum + 1), width: Lnum + 3 };
}

/**
 * One company page.
 *   o.page      engine page (inputs are written as blue values)
 *   o.n, o.ytd  layout
 *   o.title     { f } formula or text for A1
 *   o.subtitle  A2 note
 *   o.labels    { link: { fy: [refs], p, c, ltm } } or { input: { fy: [], p, c, ltm } }
 *   o.lease     the lease-toggle cell ref (e.g. Inputs!$B$7)
 *   o.inv       the non-operating-investments toggle ref (e.g. Inputs!$B$8)
 *   o.market    { kind: 'listed', price, shares, heading, priceLabel, evLabel } refs
 *               or { kind: 'deal', equity, stake, consideration }
 *   o.unitLabel e.g. "₹ Cr"; o.sym, o.unitWord for labels
 * Returns cell refs of the page (for the summary sheets).
 */
export function writeCompanySheet(ws, o) {
  const { n, ytd } = o;
  const K = pageCols(n, ytd);
  const cols = [...K.fy, ...(ytd ? [K.P, K.C] : []), K.L];
  const last = K.last;

  ws.getColumn(1).width = 52;
  for (let i = 2; i < 2 + cols.length; i++) ws.getColumn(i).width = 13;
  ws.getColumn(K.spacer).width = 3;
  ws.getColumn(K.labelCol).width = 40;
  ws.getColumn(K.valCol).width = 15;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4, topLeftCell: 'B5' }];

  w(ws, 'A1', o.title, { bold: true, size: 14, link: !!o.title?.formula, color: o.title?.formula ? undefined : T.navy });
  note(ws, 'A2', o.subtitle);
  if (o.labels.input) note(ws, 'B3', 'Period labels (edit) →');
  if (ytd) note(ws, `${K.P}3`, 'YTD (for LTM)');

  // header row
  hdr(ws, 'A4', 'Particulars', { align: 'left', wrap: false });
  const labelCell = (col, key, i) => {
    if (o.labels.link) return w(ws, `${col}4`, fx(key === 'fy' ? o.labels.link.fy[i] : o.labels.link[key]), { bold: true, color: T.white, fill: T.navy, align: 'center' });
    const v = key === 'fy' ? o.labels.input.fy[i] : o.labels.input[key];
    return w(ws, `${col}4`, v, { bold: true, input: true, align: 'center' });
  };
  K.fy.forEach((col, i) => labelCell(col, 'fy', i));
  if (ytd) { labelCell(K.P, 'p'); labelCell(K.C, 'c'); }
  labelCell(K.L, 'ltm');
  w(ws, `${K.labelCol}4`, o.market.kind === 'deal' ? 'Deal Terms & Implied Transaction Value' : o.market.heading || 'Market Data & Enterprise Value', { bold: true, color: T.white, fill: T.navy });
  w(ws, `${K.valCol}4`, o.unitLabel, { bold: true, color: T.white, fill: T.navy, align: 'center' });

  const sec = (row, text) => {
    w(ws, `A${row}`, text, { bold: true, fill: T.sec });
    for (const c of cols) w(ws, `${c}${row}`, null, { fill: T.sec });
  };
  const sub = (row) => ({ bold: true, fill: T.sub, top: true });
  const input = (key, col) => {
    const line = o.page?.lines?.[key];
    if (col === K.P) return isNum(line?.p) ? line.p : null;
    if (col === K.C) return isNum(line?.c) ? line.c : null;
    const v = fyValues(line, n)[K.fy.indexOf(col)];
    return isNum(v) ? v : null;
  };
  const flowLtm = (r) => (ytd ? `${last}${r}+${K.C}${r}-${K.P}${r}` : `${last}${r}`);
  const bsLtm = (r) => (ytd ? `IF(ISBLANK(${K.C}${r}),${last}${r},${K.C}${r})` : `${last}${r}`);

  /* ---- income statement ---- */
  sec(6, 'INCOME STATEMENT');
  const isF = {
    totalIncome: (X) => `${X}7+${X}8`, opex: (X) => `SUM(${X}10:${X}12)`, ebitda: (X) => `${X}7-${X}13`,
    ebit: (X) => `${X}14-${X}15`, pbt: (X) => `${X}16+${X}8-${X}17+${X}18`, pat: (X) => `${X}19-${X}20`,
    patOwners: (X) => `${X}21+${X}22-${X}23`, eps: (X) => `IFERROR(${X}24/${X}25,0)`,
  };
  for (const line of IS_LINES) {
    const r = line.row;
    const fmt = line.key === 'shares' || line.key === 'eps' ? NF.n2 : NF.n1;
    const label = line.kind === 'shares' ? `${line.label} (${o.unitWord})` : line.kind === 'pershare' ? `${line.label} (${o.sym})` : line.label;
    const st = line.sub ? sub(r) : {};
    w(ws, `A${r}`, label, st);
    for (const c of cols) {
      if (line.input && c !== K.L) w(ws, `${c}${r}`, input(line.key, c), { input: true, fmt });
      else if (line.input) w(ws, `${c}${r}`, fx(line.key === 'shares' ? (ytd ? `IF(ISBLANK(${K.C}${r}),${last}${r},${K.C}${r})` : `${last}${r}`) : flowLtm(r)), { fmt });
      else w(ws, `${c}${r}`, fx(isF[line.key](c)), { fmt, ...st });
    }
  }

  /* ---- balance sheet ---- */
  sec(28, 'BALANCE SHEET');
  const bsF = {
    totalNca: (X) => `SUM(${X}30:${X}34)`, totalCa: (X) => `SUM(${X}37:${X}42)`, totalAssets: (X) => `${X}35+${X}43`,
    eqOwners: (X) => `${X}47+${X}48`, totalEquity: (X) => `${X}49+${X}50`, totalNcl: (X) => `SUM(${X}53:${X}55)`,
    totalCl: (X) => `SUM(${X}58:${X}61)`, totalEL: (X) => `${X}51+${X}56+${X}62`, check: (X) => `ROUND(${X}44-${X}63,1)`,
  };
  for (const line of BS_LINES) {
    const r = line.row;
    if (line.head) { w(ws, `A${r}`, line.head, { bold: true, underline: true }); continue; }
    const st = line.sub ? sub(r) : {};
    w(ws, `A${r}`, line.label, st);
    for (const c of cols) {
      if (c === K.P) { w(ws, `${c}${r}`, null, { fill: T.na, fmt: NF.n1 }); continue; }
      if (line.input && c !== K.L) w(ws, `${c}${r}`, input(line.key, c), { input: true, fmt: NF.n1 });
      else if (line.input) w(ws, `${c}${r}`, fx(bsLtm(r)), { fmt: NF.n1 });
      else w(ws, `${c}${r}`, fx(bsF[line.key](c)), { fmt: NF.n1, ...st });
    }
  }

  /* ---- cash flow ---- */
  sec(66, 'CASH FLOW STATEMENT');
  const cfF = {
    cfo: (X) => `SUM(${X}67:${X}72)`, cfi: (X) => `SUM(${X}74:${X}78)`, cff: (X) => `SUM(${X}80:${X}85)`,
    netCash: (X) => `${X}73+${X}79+${X}86`, fcf: (X) => `${X}73+${X}74`,
  };
  for (const line of CF_LINES) {
    const r = line.row;
    const st = line.sub ? sub(r) : {};
    w(ws, `A${r}`, line.label, st);
    for (const c of cols) {
      if (line.input && c !== K.L) w(ws, `${c}${r}`, input(line.key, c), { input: true, fmt: NF.n1 });
      else if (line.input) w(ws, `${c}${r}`, fx(flowLtm(r)), { fmt: NF.n1 });
      else w(ws, `${c}${r}`, fx(cfF[line.key](c)), { fmt: NF.n1, ...st });
    }
  }

  /* ---- key ratios ---- */
  sec(90, 'KEY RATIOS (fiscal years & LTM)');
  const toggle = o.lease;
  const rF = {
    ebitdaMargin: (X) => `IFERROR(${X}14/${X}7,"")`,
    ebitMargin: (X) => `IFERROR(${X}16/${X}7,"")`,
    patMargin: (X) => `IFERROR(${X}24/${X}7,"")`,
    roe: (X) => `IFERROR(${X}24/${X}49,"")`,
    roce: (X) => `IFERROR(${X}16/(${X}51+${X}53+${X}58+${X}54+${X}59),"")`,
    roa: (X) => `IFERROR(${X}24/${X}44,"")`,
    assetTurn: (X) => `IFERROR(${X}7/${X}44,"")`,
    de: (X) => `IFERROR((${X}53+${X}58)/${X}51,"")`,
    ndEbitda: (X) => `IFERROR((${X}53+${X}58+(${X}54+${X}59)*${toggle}-${X}39-${X}40-${X}41)/${X}14,"")`,
    intCover: (X) => `IFERROR(${X}16/${X}17,"")`,
    currentRatio: (X) => `IFERROR(${X}43/${X}62,"")`,
    invDays: (X) => `IFERROR(${X}37/${X}10*365,"")`,
    recDays: (X) => `IFERROR(${X}38/${X}7*365,"")`,
    payDays: (X) => `IFERROR(${X}60/${X}10*365,"")`,
    // template: IFERROR(inv + rec − pay, ""); the COUNT guard gives the same blank in Google Sheets / other engines, which read "" + "" as 0
    ccc: (X) => `IFERROR(IF(COUNT(${X}109:${X}111)<3,"",${X}109+${X}110-${X}111),"")`,
    cfoEbitda: (X) => `IFERROR(${X}73/${X}14,"")`,
    fcfMargin: (X) => `IFERROR(${X}88/${X}7,"")`,
    capexRev: (X) => `IFERROR(-${X}74/${X}7,"")`,
    payout: (X) => `IFERROR(-${X}82/${X}24,"")`,
  };
  const growthRow = { gRev: 7, gEbitda: 14, gPat: 24 };
  for (const line of RATIO_LINES) {
    const r = line.row;
    if (line.head) { w(ws, `A${r}`, line.head, { bold: true, underline: true }); continue; }
    const fmt = line.fmt === 'pct' ? NF.pct : line.fmt === 'x' ? NF.x : NF.n0;
    w(ws, `A${r}`, line.label);
    K.fy.forEach((c, j) => {
      if (line.growth) {
        if (j === 0) w(ws, `${c}${r}`, 'n.a.', { italic: true, size: 9, color: T.grey, align: 'right', fmt });
        else { const src = growthRow[line.key]; w(ws, `${c}${r}`, fx(`IFERROR(${c}${src}/${K.fy[j - 1]}${src}-1,"")`), { fmt }); }
      } else w(ws, `${c}${r}`, fx(rF[line.key](c)), { fmt });
    });
    if (ytd) for (const c of [K.P, K.C]) w(ws, `${c}${r}`, null, { fill: T.na, fmt });
    if (line.growth) w(ws, `${K.L}${r}`, 'n.a.', { italic: true, size: 9, color: T.grey, align: 'right', fmt });
    else w(ws, `${K.L}${r}`, fx(rF[line.key](K.L)), { fmt });
  }

  /* ---- market data / deal terms ---- */
  const V = K.valCol, Lb = K.labelCol, L = K.L;
  const m = o.market;
  const row = (r, label, value, fmt, st = {}) => { w(ws, `${Lb}${r}`, label, st.bold ? { bold: true, fill: T.sub, top: true } : {}); w(ws, `${V}${r}`, value, { fmt, ...st }); };
  if (m.kind === 'deal') {
    row(5, 'Implied Equity Value (100%)', fx(m.equity), NF.n1, { link: true });
    row(6, 'Stake Acquired (%)', fx(m.stake), NF.pct, { link: true });
    row(7, 'Consideration Paid', fx(m.consideration), NF.n1, { link: true });
  } else {
    row(5, m.priceLabel || `Share Price (${o.sym})`, fx(m.price), NF.n2, { link: true });
    row(6, `Diluted Shares Outstanding (${o.unitWord})`, fx(m.shares), NF.n2, { link: true });
    row(7, 'Market Capitalisation', fx(`${V}5*${V}6`), NF.n1);
  }
  row(8, '(+) Total Borrowings', fx(`${L}53+${L}58`), NF.n1);
  row(9, '(+) Lease Liabilities (per Inputs toggle)', fx(`(${L}54+${L}59)*${toggle}`), NF.n1);
  row(10, '(−) Cash, Bank Balances & Current Investments', fx(`${L}39+${L}40+${L}41`), NF.n1);
  row(11, 'Net Debt / (Net Cash)', fx(`${V}8+${V}9-${V}10`), NF.n1, { bold: true, fill: T.sub, top: true });
  row(12, '(+) Non-controlling Interest', fx(`${L}50`), NF.n1);
  // revised templates: non-operating (non-current) investments come out of EV, per the Inputs toggle
  row(13, '(−) Non-operating investments (per Inputs toggle)', fx(`${L}33*${o.inv || 0}`), NF.n1);
  row(14, m.kind === 'deal' ? 'Implied Enterprise Value' : m.evLabel || 'Enterprise Value',
    fx(m.kind === 'deal' ? `IF(ISNUMBER(${V}5),${V}5+${V}11+${V}12-${V}13,"NM")` : `${V}7+${V}11+${V}12-${V}13`), NF.n1, { bold: true, fill: T.sub, top: true });
  row(15, 'Book Value of Equity (owners)', fx(`${L}49`), NF.n1);
  const bvps = m.kind !== 'deal' && m.bvps !== false;
  if (bvps) row(16, `Book Value per Share (${o.sym})`, fx(`IFERROR(${V}15/${V}6,0)`), NF.n2);
  note(ws, `${Lb}${bvps ? 18 : 17}`, m.kind === 'deal' ? 'Balance sheet items use the LTM column (last balance sheet before announcement).' : 'Balance sheet items use the LTM (latest) column.');
  note(ws, `${Lb}${bvps ? 19 : 18}`, m.kind === 'deal'
    ? 'EV = Equity value (100%) + Net debt + NCI − Non-operating investments (toggle on Inputs).'
    : 'EV = Market cap + Net debt + NCI − Non-operating investments (toggle on Inputs).');

  const q = `'${ws.name.replace(/'/g, "''")}'!`;
  const abs = (col, r) => `${q}$${col}$${r}`;
  return {
    name: ws.name, q, K,
    at: (col, r) => abs(col, r),
    fy: (r) => abs(last, r), ltm: (r) => abs(L, r),
    mkt: (r) => abs(V, r),
  };
}

/* -------------------------------------------------------------- statistics */

/** The worksheet formula of one statistic over a helper range (template: IF(COUNT()=0,"NM",…)). */
export function statFormula(key, range, method) {
  const q = (k) => (method === 'exc' ? `IFERROR(QUARTILE.EXC(${range},${k}),"NM")` : `QUARTILE(${range},${k})`);
  const body = { max: `MAX(${range})`, q3: q(3), mean: `AVERAGE(${range})`, median: `MEDIAN(${range})`, q1: q(1), min: `MIN(${range})` }[key];
  return `IF(COUNT(${range})=0,"NM",${body})`;
}

/**
 * A statistics block under a table: one row per shown statistic. `cols` are
 * { col, helper } pairs (the table column and its helper column);
 * `rows` = [firstRow, lastRow] of the helper range. Returns { [statKey]: row }.
 */
export function writeStats(ws, startRow, { show, cols, rows, method, fmtOf, label = STAT_LABELS }) {
  const at = {};
  show.forEach((k, i) => {
    const r = startRow + i;
    w(ws, `A${r}`, label[k], { bold: true, fill: T.sub, top: i === 0 });
    for (const c of cols) {
      const range = `$${c.helper}$${rows[0]}:$${c.helper}$${rows[1]}`;
      w(ws, `${c.col}${r}`, fx(statFormula(k, range, method)), { bold: true, fill: T.sub, top: i === 0, fmt: fmtOf(c), align: 'right' });
    }
    at[k] = r;
  });
  return at;
}

/** The Instructions sheet (colour legend, how to use, key definitions). */
export function writeInstructions(ws, { heading, units, steps, definitions }) {
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 100;
  title(ws, 'B1', heading);
  note(ws, 'B2', units);
  w(ws, 'B4', 'Colour legend', { bold: true });
  w(ws, 'B5', 'Blue text, cream fill', { input: true }); w(ws, 'C5', 'Input cell – type your data here');
  w(ws, 'B6', 'Black text', { color: T.black }); w(ws, 'C6', 'Formula – do not overwrite');
  w(ws, 'B7', 'Green text', { link: true }); w(ws, 'C7', 'Link from another sheet – do not overwrite');
  w(ws, 'B8', 'Grey fill', { fill: T.na }); w(ws, 'C8', 'Not applicable for that column');
  w(ws, 'B10', 'How to use', { bold: true });
  let r = 11;
  steps.forEach(([k, v]) => {
    w(ws, `B${r}`, k, { bold: true, valign: 'top' });
    w(ws, `C${r}`, v, { wrap: true, valign: 'top' });
    if (v.length > 110) ws.getRow(r).height = 24 * Math.ceil(v.length / 110) / 2 + 12;
    r++;
  });
  r++;
  w(ws, `B${r++}`, 'Key definitions', { bold: true });
  definitions.forEach(([k, v]) => {
    w(ws, `B${r}`, k, { bold: true, valign: 'top' });
    w(ws, `C${r}`, v, { wrap: true, valign: 'top' });
    r++;
  });
}
