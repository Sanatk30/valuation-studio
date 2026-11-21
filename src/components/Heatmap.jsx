import React, { useState } from 'react';
import { Roll } from '../lib/motion.jsx';

/**
 * Sensitivity grid: each cell is shaded by its value (darker = higher), the
 * base case (centre cell) is outlined, and the cells above / below the base
 * carry a small ▲ / ▼. Hovering a cell highlights its row and column and
 * shows the change against the base underneath the grid.
 */
function shade(v, min, max) {
  if (!isFinite(v)) return { background: 'var(--surface-3)', color: 'var(--faint)' };
  const t = max > min ? (v - min) / (max - min) : 0.5;
  const pct = Math.round(6 + t * 74);
  return {
    background: `color-mix(in srgb, var(--heat) ${pct}%, var(--surface))`,
    color: pct > 58 ? 'var(--heat-on)' : 'var(--text)',
  };
}

export default function Heatmap({ corner, rowLabels, colLabels, grid, fmt, fmtRow, fmtCol }) {
  const [hov, setHov] = useState(null);
  const flat = grid.flat().filter(isFinite);
  const mid = Math.floor(grid.length / 2);
  const midRow = grid[mid] || [];
  const midCol = Math.floor(midRow.length / 2);
  const center = midRow[midCol];
  const base = isFinite(center) ? center : NaN;
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 0;
  const hv = hov ? grid[hov[0]]?.[hov[1]] : NaN;
  const delta = isFinite(hv) && isFinite(base) && base !== 0 ? hv / base - 1 : NaN;
  return (
    <div className="heatwrap">
      <div className="tablewrap heat-scroll">
        <table className="heatmap" onMouseLeave={() => setHov(null)}>
          <thead>
            <tr>
              <th className="corner">{corner}</th>
              {colLabels.map((c, j) => (
                <th key={j} className={hov && hov[1] === j ? 'hl' : j === midCol ? 'base' : ''}>{fmtCol(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i}>
                <th className={hov && hov[0] === i ? 'hl' : i === mid ? 'base' : ''}>{fmtRow(rowLabels[i])}</th>
                {row.map((v, j) => {
                  const isBase = i === mid && j === midCol;
                  const dir = isFinite(v) && isFinite(base) && !isBase ? (v > base ? 'up' : v < base ? 'dn' : '') : '';
                  return (
                    <td
                      key={j}
                      className={`${isBase ? 'center-cell' : ''}${hov && (hov[0] === i || hov[1] === j) ? ' cross' : ''}`}
                      style={shade(v, min, max)}
                      onMouseEnter={() => setHov([i, j])}
                    >
                      <Roll>{isFinite(v) ? fmt(v) : 'n/m'}</Roll>
                      {dir ? <span className={`hm-dir ${dir}`} aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heat-read" aria-live="polite">
        {hov && isFinite(hv)
          ? <>{fmtRow(rowLabels[hov[0]])} × {fmtCol(colLabels[hov[1]])} → <b>{fmt(hv)}</b>{isFinite(delta) ? <span className={delta >= 0 ? 'pos' : 'neg'}> {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}% vs base</span> : null}</>
          : <>Base case <b>{isFinite(base) ? fmt(base) : 'n/m'}</b> · range {flat.length ? `${fmt(min)} – ${fmt(max)}` : 'n/m'} · hover a cell to compare</>}
      </div>
    </div>
  );
}
