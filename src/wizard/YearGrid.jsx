import React from 'react';
import { NumBox, parseNum } from './Field.jsx';

/** A row label pasted with its figures: text with a letter in it, not a number or an NA / NM marker. */
const isLabel = (s) => {
  const t = String(s).trim();
  return /\p{L}/u.test(t) && Number.isNaN(parseNum(t)) && !/^(na|n\/a|n\.a\.?|nm|nmf)$/i.test(t);
};

/**
 * Clipboard text → rows of cells (number, null for blank, NaN for anything
 * else), or null for a single value (an ordinary paste into the box). Rows by
 * line breaks, columns by tabs only — so the "." and "," inside a European
 * "1.234,5" never split a cell; each cell reads by `parseNum`.
 */
export function pasteBlock(text) {
  if (!/[\t\n]/.test(String(text).trim())) return null;
  return String(text).replace(/\r/g, '').split('\n').filter((l, i, arr) => l.length || i < arr.length - 1)
    .map((l) => {
      const cells = l.split('\t');
      // a leading text label ("Revenue", copied with its row) is not a value: drop it, so the
      // figures land in the cells they were copied from instead of one column to the right.
      // An empty marker in the first value cell ("-", an Excel accounting zero; "NM", "n.a.")
      // is not a label: it stays, as a cell the paste leaves alone.
      if (cells.length > 1 && isLabel(cells[0])) cells.shift();
      return cells.map((s) => parseNum(s));
    });
}

/**
 * Spreadsheet-style grid: rows × columns of null-able numbers. Blank cells stay
 * blank. Paste a block copied from Excel/Sheets into any cell and it fills
 * right and down from there (rows by line breaks, columns by tabs).
 *
 * rows: [{ key, label, values: (number|null)[], modes?: [[k, label]], mode?, sub? }]
 */
export default function YearGrid({ heads, rows, onCell, onMode, onPasteBlock, note }) {
  const onPaste = (r, c, e) => {
    const block = pasteBlock(e.clipboardData.getData('text'));
    if (!block) return;                                // single value: normal paste
    e.preventDefault();
    onPasteBlock(r, c, block);
  };

  return (
    <div className="ygrid-wrap">
      <table className="ygrid">
        <thead>
          <tr>
            <th />
            {heads.map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key} className={row.sub ? 'sub' : ''}>
              <td className="ygl">
                <div>{row.label}</div>
                {row.modes && (
                  <select value={row.mode} onChange={(e) => onMode(row.key, e.target.value)}>
                    {row.modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                )}
              </td>
              {heads.map((h, c) => (
                <td key={h} onPaste={(e) => onPaste(r, c, e)}>
                  <NumBox small value={row.values[c] ?? null} onChange={(v) => onCell(row.key, c, v)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div className="fld-h" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
