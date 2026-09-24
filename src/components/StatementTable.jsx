import React, { useState } from 'react';

/** Excel-style in-place cell editor: shows the raw number, commits on blur/Enter, Escape cancels. */
function EditCell({ raw, onCommit }) {
  const [txt, setTxt] = useState(null); // null = not editing
  const initial = React.useRef(null);   // text at focus — commit only if it changed
  const cancelled = React.useRef(false);
  const shown = txt !== null ? txt : String(Math.round(raw * 100) / 100);
  return (
    <input
      className="cellin"
      type="text"
      inputMode="decimal"
      value={shown}
      onFocus={(e) => {
        const s = String(Math.round(raw * 100) / 100);
        initial.current = s;
        cancelled.current = false;
        setTxt(s);
        e.target.select();
      }}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const v = parseFloat(txt);
        // commit only what the user actually typed — an untouched cell must not
        // round the model value, and Escape must leave it untouched
        if (!cancelled.current && txt !== null && txt !== initial.current && isFinite(v) && v !== raw) onCommit(v);
        setTxt(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setTxt(null);
          e.target.blur();
        }
      }}
    />
  );
}

/**
 * Year-columns financial table.
 * rows: { label, values: number[], year0?: number, fmt: (v)=>string,
 *         bold?, sub?, sechead?,
 *         lead?: (number|null)[], trail?: (number|null)[],
 *         leadFmt?, trailFmt?,
 *         edit?: { values: number[] (raw input values), onChange(i, v) } }
 * Rows with `edit` render blue type-in cells — the model recalculates live.
 *
 * `leadLabels` / `trailLabels` add columns before and after the year grid — the
 * DCF page uses them for the back-cast historical period and the CAGR columns,
 * matching the exported sheet.
 */
export default function StatementTable({
  years, rows, showYear0 = false, labels,
  leadLabels = [], trailLabels = [], leadGroup, trailGroup,
}) {
  const nLead = leadLabels.length, nTrail = trailLabels.length;
  const nCols = nLead + years.length + nTrail + (showYear0 ? 1 : 0) + 1;
  const cell = (v, fmt) => (v === null || v === undefined ? '' : fmt(v));
  // lead/trail columns make the table wider than the view, so let it scroll
  return (
    <div className={`tablewrap${nLead || nTrail ? ' wide' : ''}`}>
      <table className="fin">
        <thead>
          {(leadGroup || trailGroup) && (
            <tr className="bm-groups">
              <th />
              {nLead > 0 && <th colSpan={nLead} className="bm-grp">{leadGroup}</th>}
              {showYear0 && <th />}
              <th colSpan={years.length} className="bm-grp">{trailGroup ? 'Projection period' : ''}</th>
              {nTrail > 0 && <th colSpan={nTrail} className="bm-grp">{trailGroup}</th>}
            </tr>
          )}
          <tr>
            <th />
            {leadLabels.map((l, i) => <th key={`l${i}`}>{l}</th>)}
            {showYear0 && <th>{labels ? 'Y0 / LTM' : 'Year 0'}</th>}
            {years.map((y, i) => (
              <th key={y}>{labels?.[i] ?? `Year ${y}`}</th>
            ))}
            {trailLabels.map((l, i) => <th key={`t${i}`}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.sechead) {
              return (
                <tr key={i} className="sechead">
                  <td colSpan={nCols}>{row.label}</td>
                </tr>
              );
            }
            const cls = [row.bold ? 'bold' : '', row.sub ? 'sub' : ''].join(' ').trim();
            const lf = row.leadFmt || row.fmt, tf = row.trailFmt || row.fmt;
            return (
              <tr key={i} className={cls || undefined}>
                <td>{row.label}{row.edit ? <span className="edit-dot" title="Editable — click a cell and type">✎</span> : null}</td>
                {leadLabels.map((_, j) => (
                  <td key={`l${j}`} className="hist">{cell(row.lead?.[j], lf)}</td>
                ))}
                {showYear0 && (
                  <td className={row.year0 < 0 ? 'neg' : ''}>{row.year0 !== undefined ? row.fmt(row.year0) : ''}</td>
                )}
                {row.values.map((v, j) => (
                  <td key={j} className={!row.edit && v < 0 ? 'neg' : ''}>
                    {row.edit ? (
                      <EditCell raw={row.edit.values[j]} onCommit={(nv) => row.edit.onChange(j, nv)} />
                    ) : (
                      row.fmt(v)
                    )}
                  </td>
                ))}
                {trailLabels.map((_, j) => (
                  <td key={`t${j}`} className="cagr">{cell(row.trail?.[j], tf)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
