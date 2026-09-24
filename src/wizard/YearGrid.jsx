import React from 'react';
import { NumBox, parseNum } from './Field.jsx';

/**
 * Spreadsheet-style grid: rows × columns of null-able numbers. Blank cells stay
 * blank. Paste a block copied from Excel/Sheets into any cell and it fills
 * right and down from there (rows by line breaks, columns by tabs).
 *
 * rows: [{ key, label, values: (number|null)[], modes?: [[k, label]], mode?, sub? }]
 */
export default function YearGrid({ heads, rows, onCell, onMode, onPasteBlock, note }) {
  const onPaste = (r, c, e) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;          // single value: normal paste
    e.preventDefault();
    const block = text.replace(/\r/g, '').split('\n').filter((l, i, arr) => l.length || i < arr.length - 1)
      .map((l) => l.split('\t').map((s) => parseNum(s)));
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
