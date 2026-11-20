/**
 * Recalculate an ExcelJS workbook with HyperFormula and look cells up by
 * label — the harness behind the Excel recalculation tests.
 */
import { HyperFormula } from 'hyperformula';

const colNum = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
export const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * HyperFormula has no INTERCEPT. The comps Regression sheet only ever passes
 * it two paired ranges (x and y blank together), where
 * INTERCEPT(y, x) = AVERAGE(y) − SLOPE(y, x) × AVERAGE(x) exactly.
 */
const hfCompat = (f) => f
  // a post-2007 function is saved with Excel's _xlfn. prefix (e.g. _xlfn.QUARTILE.EXC); HyperFormula reads the bare name
  .replace(/_xlfn\./g, '')
  .replace(/INTERCEPT\(([^,()]+),([^,()]+)\)/g, '(AVERAGE($1)-SLOPE($1,$2)*AVERAGE($2))')
  // real Excel takes the signed odd root of a negative base, (−0.8)^(1/3) = −0.928; HyperFormula gives #NUM!
  .replace(/\(([^()]+)\)\^\(1\/([^()]+)\)/g, 'IF(AND(($1)<0,ISODD($2)),-((-($1))^(1/($2))),($1)^(1/($2)))');

export function recalc(wb) {
  const sheets = {};
  wb.eachSheet((ws) => {
    const grid = [];
    ws.eachRow({ includeEmpty: true }, (row, rn) => {
      while (grid.length < rn - 1) grid.push([]);
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        while (arr.length < cn - 1) arr.push(null);
        let v = cell.value;
        if (v && typeof v === 'object' && v.formula) v = '=' + hfCompat(v.formula);
        else if (v instanceof Date) v = (v.getTime() / 86400000) + 25569;   // Excel serial
        arr.push(v === undefined ? null : v);
      });
      grid.push(arr);
    });
    sheets[ws.name] = grid;
  });
  const hf = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3', useArrayArithmetic: true, smartRounding: false });

  const sid = (s) => {
    const id = hf.getSheetId(s);
    if (id === undefined) throw new Error(`no sheet "${s}"`);
    return id;
  };
  const get = (sheet, addr) => {
    const m = addr.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/);
    return hf.getCellValue({ sheet: sid(sheet), col: colNum(m[1]) - 1, row: parseInt(m[2], 10) - 1 });
  };
  /** Resolve a reference like "'DCF'!$I$40" or "Inputs!$B$5". */
  const ref = (r) => {
    const m = r.match(/^'?(.*?)'?!(\$?[A-Z]+\$?\d+)$/);
    return get(m[1].replace(/''/g, "'"), m[2]);
  };
  const rows = (sheet, label, labelCol = 'A') => {
    const id = sid(sheet);
    const { height } = hf.getSheetDimensions(id);
    const c0 = colNum(labelCol) - 1;
    const out = [];
    for (let r0 = 0; r0 < height; r0++) {
      const v = hf.getCellValue({ sheet: id, col: c0, row: r0 });
      if (typeof v === 'string' && v.trim() === label.trim()) out.push(r0 + 1);
    }
    return out;
  };
  const row = (sheet, label, labelCol = 'A') => rows(sheet, label, labelCol)[0] ?? -1;
  const rowLast = (sheet, label, labelCol = 'A') => rows(sheet, label, labelCol).slice(-1)[0] ?? -1;

  /** Every error cell: [{ sheet, addr, err, formula }]. */
  const errors = () => {
    const out = [];
    for (const name of Object.keys(sheets)) {
      const id = sid(name);
      const { height, width } = hf.getSheetDimensions(id);
      for (let r0 = 0; r0 < height; r0++) for (let c0 = 0; c0 < width; c0++) {
        const v = hf.getCellValue({ sheet: id, col: c0, row: r0 });
        if (v && typeof v === 'object' && v.type) {
          out.push({ sheet: name, addr: `${colLetter(c0 + 1)}${r0 + 1}`, err: v.value || v.type, formula: hf.getCellFormula({ sheet: id, col: c0, row: r0 }) || '' });
        }
      }
    }
    return out;
  };
  return { hf, get, ref, row, rowLast, rows, errors, sheets: Object.keys(sheets) };
}
