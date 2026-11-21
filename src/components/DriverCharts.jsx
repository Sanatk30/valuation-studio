import React, { useEffect, useRef, useState } from 'react';
import { DRIVERS } from '../lib/engine/dcfTemplate.js';
import { NumBox } from '../wizard/Field.jsx';
import { fmtTpl } from '../lib/format.js';
import { histAverage } from './DriversGrid.jsx';

/**
 * The Assumptions page as driver charts (the chosen design): each driver is a
 * card with its history (grey) and forecast (blue). Three ways to adjust:
 * drag a blue point up or down, type in the year boxes, or Fill ▾ (same every
 * year, history average, taper first → last, copy the last actual year, clear).
 * Same data and units as DriversGrid (pct ×100, days, money).
 */
const fin = Number.isFinite;
const round = (v, fmt) => (fmt === 'pct' ? Math.round(v * 10) / 10 : fmt === 'days' ? Math.round(v) : Math.round(v * 10) / 10);

function DriverCard({ d, row, hist, nHist, labels, onSet, onRow, emptyHist, unitLabel, locale }) {
  const W = 400, H = 120, P = 16;
  const histV = hist.map((x, i) => (emptyHist[i] || !fin(x) ? null : (d.fmt === 'pct' ? x * 100 : x)));
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(null);     // { j, scale }
  const svg = useRef(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const vals = [...histV, ...row].filter(fin);
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (hi - lo < 1e-9) { const pad = Math.abs(hi) * 0.2 || 1; lo -= pad; hi += pad; }
  const span = hi - lo;
  const scale = drag?.scale || { lo: lo - span * 0.25, hi: hi + span * 0.25 };
  const n = nHist + row.length;
  const x = (i) => P + (n > 1 ? (i / (n - 1)) * (W - 2 * P) : (W - 2 * P) / 2);
  const y = (v) => H - P - ((v - scale.lo) / (scale.hi - scale.lo)) * (H - 2 * P);
  const vOf = (py) => scale.lo + ((H - P - py) / (H - 2 * P)) * (scale.hi - scale.lo);

  const toLocal = (e) => {
    const r = svg.current.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * H;
  };
  const onDown = (j) => (e) => {
    e.preventDefault();
    svg.current.setPointerCapture?.(e.pointerId);
    setDrag({ j, scale });
  };
  const onMove = (e) => {
    if (!drag) return;
    const r = round(vOf(toLocal(e)), d.fmt);
    const v = d.fmt === 'days' ? Math.max(0, r) : r;
    if (v !== row[drag.j]) onSet(drag.j, v);   // save only when the rounded value moves
  };
  const onUp = () => setDrag(null);

  const avg = histAverage(hist, d.fmt, emptyHist);
  const lastActual = [...histV].reverse().find(fin);
  const fills = [
    { t: 'Same every year', v: fin(row[0]) ? row[0] : null, run: () => fin(row[0]) && onRow(row.map(() => row[0])) },
    { t: 'History average', v: fin(avg) ? round(avg, d.fmt) : null, run: () => fin(avg) && onRow(row.map(() => round(avg, d.fmt))) },
    { t: 'Taper first → last', v: null, run: () => fin(row[0]) && fin(row[row.length - 1]) && row.length > 2 && onRow(row.map((_, j) => round(row[0] + ((row[row.length - 1] - row[0]) * j) / (row.length - 1), d.fmt))) },
    { t: 'Copy last actual', v: fin(lastActual) ? round(lastActual, d.fmt) : null, run: () => fin(lastActual) && onRow(row.map(() => round(lastActual, d.fmt))) },
  ];
  const fmtV = (v) => (!fin(v) ? '—' : d.fmt === 'pct' ? `${v.toFixed(1)}%` : d.fmt === 'days' ? `${Math.round(v)}` : fmtTpl(v, 'n1', locale));
  const pts = [...histV.map((v, i) => (fin(v) ? [x(i), y(v)] : null)), ...row.map((v, j) => (fin(v) ? [x(nHist + j), y(v)] : null))];
  const histLine = pts.slice(0, nHist).filter(Boolean);
  const fcLine = pts.slice(Math.max(0, nHist - 1)).filter(Boolean);
  const first = row[0], last = row[row.length - 1];

  return (
    <div className={`drv${drag ? ' dragging' : ''}`}>
      <div className="drv-h">
        <h4 title={d.note || ''}>{d.label}</h4>
        <span className="drv-sum">{fmtV(first)}{fin(first) && fin(last) && first !== last ? ` → ${fmtV(last)}` : ''}</span>
        <div className="drv-fill" ref={ref}>
          <button type="button" className="drv-fb" onClick={() => setMenu(!menu)} aria-expanded={menu}>Fill ▾</button>
          {menu && (
            <div className="drv-menu">
              {fills.map((f) => <button type="button" key={f.t} onClick={() => { f.run(); setMenu(false); }}><span>{f.t}</span>{f.v !== null && <b>{fmtV(f.v)}</b>}</button>)}
              <div className="tb-menu-sep" />
              <button type="button" onClick={() => { onRow(row.map(() => null)); setMenu(false); }}><span>Clear forecast</span></button>
            </div>
          )}
        </div>
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="drv-svg" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerCancel={onUp} role="img" aria-label={`${d.label}: history and forecast`}>
        <rect x={(x(nHist - 1) + x(nHist)) / 2} y="0" width={W - (x(nHist - 1) + x(nHist)) / 2} height={H} rx="8" className="drv-band" />
        {histLine.length > 1 && <polyline points={histLine.map((p) => p.join(',')).join(' ')} className="drv-hl" />}
        {fcLine.length > 1 && <polyline points={fcLine.map((p) => p.join(',')).join(' ')} className="drv-fl" />}
        {histV.map((v, i) => (fin(v) ? <circle key={`h${i}`} cx={x(i)} cy={y(v)} r="3" className="drv-hp"><title>{`${labels.hist[i]}: ${fmtV(v)}`}</title></circle> : null))}
        {row.map((v, j) => (
          <g key={`f${j}`}>
            <circle cx={x(nHist + j)} cy={fin(v) ? y(v) : H - P} r="12" className="drv-hit" onPointerDown={onDown(j)} />
            <circle cx={x(nHist + j)} cy={fin(v) ? y(v) : H - P} r={drag?.j === j ? 7 : 5.5} className={`drv-fp${fin(v) ? '' : ' blank'}`} onPointerDown={onDown(j)}>
              <title>{`${labels.fcst[j]}: ${fmtV(v)} — drag to change`}</title>
            </circle>
          </g>
        ))}
        {drag && fin(row[drag.j]) && (
          <g className="drv-tag" transform={`translate(${Math.min(W - 60, Math.max(60, x(nHist + drag.j)))}, ${Math.max(16, y(row[drag.j]) - 18)})`}>
            <rect x="-48" y="-12" width="96" height="20" rx="6" />
            <text textAnchor="middle" y="3">{labels.fcst[drag.j]} {fmtV(row[drag.j])}</text>
          </g>
        )}
      </svg>
      <div className="drv-vals" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
        {row.map((v, j) => (
          <label key={j}><small>{labels.fcst[j]}</small><NumBox small value={v} onChange={(nv) => onSet(j, nv)} /></label>
        ))}
      </div>
      <div className="drv-hist">History {histV.map(fmtV).join(' · ')}{fin(avg) ? ` · avg ${fmtV(round(avg, d.fmt))}` : ''}{d.fmt === 'money' ? ` · ${unitLabel}` : ''}</div>
    </div>
  );
}

export default function DriverCharts({ drivers, onChange, m, labels, refs, locale, unitLabel, defs = DRIVERS, emptyHist = [] }) {
  const row = (key) => {
    const arr = Array.isArray(drivers?.[key]) ? drivers[key] : [];
    return Array.from({ length: m }, (_, j) => (fin(arr[j]) ? arr[j] : null));
  };
  const setRow = (key, vals) => {
    const old = Array.isArray(drivers?.[key]) ? drivers[key] : [];
    onChange({ ...drivers, [key]: [...vals, ...old.slice(m)] });
  };
  const groups = [];
  defs.forEach((d) => {
    if (!d.key) groups.push({ name: d.section, rows: [] });
    else { if (!groups.length) groups.push({ name: '', rows: [] }); groups[groups.length - 1].rows.push(d); }
  });
  const nHist = labels.hist.length;
  const title = (s) => String(s || '').toLowerCase().replace(/(^|\s|&\s|\()([a-z])/g, (q) => q.toUpperCase()).replace(/\bInd As\b/, 'Ind AS');
  return (
    <div className="drvs">
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.name}>
          {g.name && <h3 className="drv-g">{title(g.name)}</h3>}
          <div className="drv-grid">
            {g.rows.map((d) => (
              <DriverCard
                key={d.key} d={d} row={row(d.key)} hist={(refs?.[d.key] || []).slice(0, nHist)} nHist={nHist} labels={labels}
                emptyHist={emptyHist} unitLabel={unitLabel} locale={locale}
                onSet={(j, v) => { const r = row(d.key); r[j] = v; setRow(d.key, r); }}
                onRow={(vals) => setRow(d.key, vals)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Charts (default) or the classic table, with the "three ways to adjust" line. */
export function DriversView(props) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('qv-drivers-view') || 'charts'; } catch { return 'charts'; } });
  const set = (v) => { setMode(v); try { localStorage.setItem('qv-drivers-view', v); } catch { /* private mode */ } };
  const Grid = props.Grid;
  return (
    <div>
      <div className="drv-bar">
        <div className="hint"><b>Three ways to adjust:</b> ① drag a blue point up or down · ② type in the year boxes · ③ <b>Fill ▾</b> for same every year, history average, taper or copy the last actual year</div>
        <span className="seg"><button type="button" className={mode === 'charts' ? 'on' : ''} onClick={() => set('charts')}>Charts</button><button type="button" className={mode === 'table' ? 'on' : ''} onClick={() => set('table')}>Table</button></span>
      </div>
      {mode === 'charts' ? <DriverCharts {...props} /> : <Grid {...props} />}
    </div>
  );
}
