/** Shared workbook primitives. Banker conventions: blue = input,
 *  black = formula, green = cross-sheet link. */

export const C_INPUT = 'FF1F4FD8';
export const C_LINK = 'FF1E7A34';
export const C_HDR_FILL = 'FF173A5E';
export const C_HDR_TEXT = 'FFFFFFFF';
export const C_SECTION_FILL = 'FFEAF1FA';
export const C_GRID_FILL = 'FFF7FAFF';
export const C_MUTED = 'FF999999';
/** Hairline used for the rules that separate blocks on a page. */
export const C_RULE = 'FFB4C4D8';
/** Tab colours: analysis pages read dark, input pages read pale. */
export const C_TAB_ANALYSIS = 'FF173A5E';
export const C_TAB_INPUT = 'FF9DB8D6';

export function colL(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Inverse of colL: 'A' -> 1, 'Z' -> 26, 'AA' -> 27. Multi-letter safe. */
export function colN(letters) {
  let n = 0;
  for (const ch of String(letters).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function put(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  c.value = value;
  if (o.fmt) c.numFmt = o.fmt;
  const font = { name: 'Calibri', size: o.size || 11 };
  if (o.bold) font.bold = true;
  if (o.italic) font.italic = true;
  if (o.underline) font.underline = true;
  if (o.color) font.color = { argb: o.color };
  c.font = font;
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  // Everything sits on the text baseline of its row, so taller header rows
  // centre their labels instead of pinning them to the top.
  c.alignment = { vertical: 'middle', ...(o.align ? { horizontal: o.align } : {}) };
  if (o.indent) c.alignment.indent = o.indent;
  if (o.wrap) c.alignment = { ...c.alignment, wrapText: true, vertical: o.wrapTop ? 'top' : 'middle' };
  if (o.top || o.bottom) {
    c.border = { ...(c.border || {}) };
    if (o.top) c.border.top = { style: 'thin' };
    if (o.bottom) c.border.bottom = { style: o.bottom === 'double' ? 'double' : 'thin' };
  }
  return c;
}

/* ------------------------------------------------------------ page styling */

/**
 * Screen and print chrome for one sheet: gridlines off (the fills and rules
 * carry the structure), frozen headers, A4 landscape fitted to one page wide,
 * repeating header rows and a page footer.
 */
export function styleSheet(ws, o = {}) {
  const { freezeRow = 0, freezeCol = 0, tab, zoom = 90, printTitles, portrait = false } = o;
  const frozen = freezeRow > 0 || freezeCol > 0;
  ws.views = [{
    ...(frozen
      ? { state: 'frozen', xSplit: freezeCol, ySplit: freezeRow, topLeftCell: `${colL(freezeCol + 1)}${freezeRow + 1}` }
      : { state: 'normal' }),
    showGridLines: false,
    zoomScale: zoom,
  }];
  ws.pageSetup = {
    paperSize: 9,                                     // A4
    orientation: portrait ? 'portrait' : 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,   // one page wide, as many pages long as it takes
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.55, header: 0.3, footer: 0.3 },
    ...(printTitles ? { printTitlesRow: printTitles } : {}),
  };
  ws.headerFooter = {
    oddFooter: '&L&9&A&C&9Valuation Studio&R&9Page &P of &N',
  };
  if (tab) ws.properties.tabColor = { argb: tab };
  return ws;
}

/** Solid fill across a run of columns, leaving the cells' values alone. */
export function fillRow(ws, row, cols, argb) {
  for (const c of cols) {
    ws.getCell(`${c}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  }
}

/** One border edge across a run of columns, merged into whatever is there. */
export function edge(ws, row, cols, side, style = 'thin', color) {
  for (const c of cols) {
    const cell = ws.getCell(`${c}${row}`);
    cell.border = { ...(cell.border || {}), [side]: { style, ...(color ? { color: { argb: color } } : {}) } };
  }
}

/** Inclusive column-letter run, e.g. colRun(2, 8) -> B..H. */
export function colRun(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(colL(i));
  return out;
}

export function sectionHeader(ws, row, text, span = 3, startCol = 1) {
  for (let i = 0; i < span; i++) {
    put(ws, `${colL(startCol + i)}${row}`, i === 0 ? text : '', { fill: C_HDR_FILL, color: C_HDR_TEXT, bold: true });
  }
}

/** Number formats for a display currency. */
export function makeFormats(sym) {
  return {
    money: `"${sym}"#,##0;("${sym}"#,##0)`,
    money1: `"${sym}"#,##0.0;("${sym}"#,##0.0)`,
    plain: '#,##0;(#,##0)',
    plain1: '#,##0.0;(#,##0.0)',
    price: `"${sym}"#,##0.00`,
    pct: '0.0%', pct2: '0.00%',
    x: '0.0"x"', x2: '0.00"x"',
    num: '#,##0.00', num3: '0.000', int: '0',
    shares: '#,##0.000',
    date: 'dd-mmm-yy',
    year: '"Year "0',

    /* ---- 3E banker accounting formats (DCF / WACC pages) ----
       Line items get the accounting form: figures aligned on the decimal, a
       dash for zero, negatives in parentheses. Subtotals and totals carry the
       currency symbol and turn red when negative, so a loss is unmissable. */
    aItem: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
    aItem1: '_(* #,##0.0_);_(* (#,##0.0);_(* "-"?_);_(@_)',
    aTotal: `"${sym}"#,##0_);[Red]("${sym}"#,##0)`,
    aTotal1: `"${sym}"#,##0.0_);[Red]("${sym}"#,##0.0)`,
    aPrice: `_("${sym}"* #,##0.00_);[Red]_("${sym}"* (#,##0.00);_(* "-"??_);_(@_)`,
    aPct: '_(* #,##0.0%;_(* (#,##0.0%);_(* "- %"_);_(@_)',
    aPct2: '_(* #,##0.00%;_(* (#,##0.00%);_(* "- %"_);_(@_)',
    aX: '_(* #,##0.0"x";_(* (#,##0.0"x");_(* "- x"_);_(@_)',
    aX2: '_(* #,##0.00"x";_(* (#,##0.00"x");_(* "- x"_);_(@_)',
    aFactor: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"?_);_(@_)',
    aBeta: '#,##0.00 ;[Red](#,##0.00)',
    aShares: '_(* #,##0.000_);_(* (#,##0.000);_(* "-"?_);_(@_)',
    fyYear: '0000',
  };
}

/** Wrap a formula so errors read "NA", as the 3E template does. */
export const na = (f) => `IFERROR(${f},"NA")`;

/** Excel-safe, unique worksheet name (31 chars, no []:*?/\\). */
export function sheetName(raw, taken) {
  let base = String(raw || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base, i = 2;
  while (taken.has(name)) {
    const suffix = ` (${i++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}
