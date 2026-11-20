import React from 'react';
import { DRIVERS } from '../lib/engine/dcfTemplate.js';
import { NumBox } from '../wizard/Field.jsx';
import { fmtTpl } from '../lib/format.js';

/**
 * The Assumptions sheet of the DCF / LBO templates on screen (`defs`: the
 * template's driver rows, DCF by default): every driver with its
 * historical ratios (black, for reference) and one cream input per forecast
 * year, plus shortcuts that only fill cells — they never change a value you
 * did not ask for:
 *
 *   →    copy the first forecast year across every year
 *   ⟋    straight line from the first to the last forecast year
 *   avg  the historical average in every year
 *
 * and, for the whole grid, "fill blanks from history" (each blank cell gets
 * its row's historical average; typed cells stay).
 *
 * Stored values: % rows in percent (12 = 12 %), days, money as typed.
 */
const fin = Number.isFinite;
const round = (v, fmt) => (fmt === 'pct' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

/**
 * Historical average of a driver in stored units (pct ×100), or NaN. Years with
 * no figures (`skip[i]` true: no revenue) are left out — a blank year would
 * otherwise count as −100 % growth or a 0 % ratio.
 */
export function histAverage(refRow, fmt, skip = []) {
  const v = (refRow || []).filter((x, i) => !skip[i] && typeof x === 'number' && fin(x));
  if (!v.length) return NaN;
  const avg = v.reduce((s, x) => s + x, 0) / v.length;
  return fmt === 'pct' ? avg * 100 : avg;
}

export default function DriversGrid({ drivers, onChange, m, labels, refs, locale, unitLabel, defs = DRIVERS, emptyHist = [] }) {
  const row = (key) => {
    const arr = Array.isArray(drivers?.[key]) ? drivers[key] : [];
    return Array.from({ length: m }, (_, j) => (fin(arr[j]) ? arr[j] : null));
  };
  const setRow = (key, vals) => {
    const old = Array.isArray(drivers?.[key]) ? drivers[key] : [];
    onChange({ ...drivers, [key]: [...vals, ...old.slice(m)] });     // years beyond the horizon are kept
  };
  const setCell = (key, j, v) => { const r = row(key); r[j] = v; setRow(key, r); };
  const fillRight = (d) => { const r = row(d.key); if (fin(r[0])) setRow(d.key, r.map(() => r[0])); };
  const straight = (d) => {
    const r = row(d.key);
    if (!fin(r[0]) || !fin(r[m - 1]) || m < 3) return;
    setRow(d.key, r.map((_, j) => round(r[0] + ((r[m - 1] - r[0]) * j) / (m - 1), d.fmt)));
  };
  const avgFill = (d) => { const a = histAverage(refs[d.key], d.fmt, emptyHist); if (fin(a)) setRow(d.key, row(d.key).map(() => round(a, d.fmt))); };
  const fillBlanks = () => {
    const next = { ...drivers };
    for (const d of defs.filter((x) => x.key)) {
      const a = histAverage(refs[d.key], d.fmt, emptyHist);
      if (!fin(a)) continue;
      const r = row(d.key).map((v) => (v === null ? round(a, d.fmt) : v));
      const old = Array.isArray(drivers?.[d.key]) ? drivers[d.key] : [];
      next[d.key] = [...r, ...old.slice(m)];
    }
    onChange(next);
  };

  const refFmt = (d) => (d.fmt === 'pct' ? 'pct' : d.fmt === 'days' ? 'n0' : 'n1');
  const nHist = labels.hist.length;
  const suffix = (d) => (d.fmt === 'pct' ? '%' : d.fmt === 'days' ? 'days' : unitLabel);

  return (
    <div className="dg">
      <div className="row-btns" style={{ marginTop: 0, marginBottom: 8 }}>
        <button className="btn sm" onClick={fillBlanks}>Fill blanks from history</button>
        <span className="fld-h" style={{ margin: 0 }}>Each blank forecast cell gets its row’s historical average (years with no figures are left out); cells you typed stay. A blank cell counts as 0, as in the template.</span>
      </div>
      <div className="tablewrap tp-grid">
        <table className="fin compact dg-table">
          <thead>
            <tr>
              <th>Driver</th>
              {labels.hist.map((l, i) => <th key={`h${i}`} className="dg-hist">{l}</th>)}
              {labels.fcst.map((l, j) => <th key={`f${j}`}>{l}</th>)}
              <th>Fill</th>
              <th className="dg-note">Example · basis</th>
            </tr>
            <tr className="dg-band">
              <th />
              <th colSpan={nHist} className="dg-hist">Historical (reference)</th>
              <th colSpan={m}>Forecast (inputs)</th>
              <th /><th />
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              if (d.section) return <tr key={d.section} className="tp-sec dg-sec"><td colSpan={nHist + m + 3}>{d.section}</td></tr>;
              const r = row(d.key);
              return (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  {refs[d.key].map((x, i) => <td key={i} className={`dg-hist${x === 'n.a.' || emptyHist[i] ? ' tp-mute' : ''}`} title={emptyHist[i] ? `${labels.hist[i]} has no figures — left out of the averages` : undefined}>{fmtTpl(x, refFmt(d), locale)}</td>)}
                  {r.map((v, j) => (
                    <td key={j} className="tp-in">
                      <NumBox small value={v} onChange={(x) => setCell(d.key, j, x)} placeholder={suffix(d)} />
                    </td>
                  ))}
                  <td className="dg-fill">
                    <button className="btn xs" title="Copy the first forecast year across" onClick={() => fillRight(d)} disabled={!fin(r[0])}>→</button>
                    <button className="btn xs" title="Straight line from the first to the last forecast year" onClick={() => straight(d)} disabled={!(fin(r[0]) && fin(r[m - 1]) && m >= 3)}>⟋</button>
                    <button className="btn xs" title="Historical average in every year" onClick={() => avgFill(d)} disabled={!fin(histAverage(refs[d.key], d.fmt, emptyHist))}>avg</button>
                  </td>
                  <td className="dg-note">{d.example}{d.note ? ` · ${d.note}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
