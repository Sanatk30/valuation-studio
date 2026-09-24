import React from 'react';

/**
 * Sensitivity grid, dark-fintech style: cells tint emerald above the base
 * case and red below it, intensity scaled by distance — the base (center)
 * cell carries an indigo outline. Values keep full-contrast text.
 */
function cellStyle(v, base, span) {
  if (!isFinite(v)) return { background: '#161B25', color: '#626B7A' };
  const d = (v - base) / span;
  const a = Math.min(0.42, Math.abs(d) * 0.42 + 0.05);
  return {
    background: d >= 0 ? `rgba(52,211,153,${a})` : `rgba(248,113,113,${a})`,
    color: '#E7EAF0',
  };
}

export default function Heatmap({ corner, rowLabels, colLabels, grid, fmt, fmtRow, fmtCol }) {
  const flat = grid.flat().filter(isFinite);
  const mid = Math.floor(grid.length / 2);
  const midRow = grid[mid] || [];
  const center = midRow[Math.floor(midRow.length / 2)];
  const base = isFinite(center) ? center : flat.reduce((s, v) => s + v, 0) / (flat.length || 1);
  const span = Math.max(...flat.map((v) => Math.abs(v - base)), 1e-9);
  return (
    <div className="tablewrap" style={{ display: 'inline-block', padding: 8 }}>
      <table className="heatmap">
        <thead>
          <tr>
            <th className="corner">{corner}</th>
            {colLabels.map((c, j) => (
              <th key={j}>{fmtCol(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, i) => (
            <tr key={i}>
              <th>{fmtRow(rowLabels[i])}</th>
              {row.map((v, j) => (
                <td
                  key={j}
                  className={i === mid && j === Math.floor(row.length / 2) ? 'center-cell' : ''}
                  style={cellStyle(v, base, span)}
                >
                  {isFinite(v) ? fmt(v) : 'n/m'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
