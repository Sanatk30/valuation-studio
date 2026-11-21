import React, { useMemo, useState } from 'react';
import { CURRENCIES, fmtTpl } from '../lib/format.js';

/**
 * Peer map (the chosen Comps Peers design, on top of the peer table): every
 * peer placed by size (market cap, log scale) against a multiple, coloured by
 * tier; the target is the ringed point and the dashed line is the median of
 * the included peers. Click a dot to include or exclude that peer.
 *   peers   — computeComps rows (mcap, mult, include, tier, name, id, empty)
 *   target  — computeComps target row
 *   options — [{ key, label }] multiples to plot (the y axis)
 */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const TIER_COL = ['#2B7C85', '#E0A33A', '#7C4DCC', '#1E9E5A', '#E5484D'];

export default function PeerMap({ peers, target, options, onToggle, company, hover, onHover }) {
  const [key, setKey] = useState(options[0]?.key);
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const tiers = [...new Set(peers.filter((p) => !p.empty).map((p) => p.tier || 'No tier'))];
  const col = (p) => TIER_COL[tiers.indexOf(p.tier || 'No tier') % TIER_COL.length] || '#9AA6A6';
  const pts = peers.filter((p) => !p.empty).map((p) => ({ p, x: p.mcap, y: p.mult?.[key] }));
  const ok = pts.filter((d) => fin(d.x) && d.x > 0 && fin(d.y));
  const nm = pts.filter((d) => !(fin(d.x) && d.x > 0 && fin(d.y)));
  const t = target && fin(target.mcap) && target.mcap > 0 && fin(target.mult?.[key]) ? { x: target.mcap, y: target.mult[key] } : null;
  const inc = ok.filter((d) => d.p.include === 1).map((d) => d.y).sort((a, b) => a - b);
  const med = inc.length ? (inc.length % 2 ? inc[(inc.length - 1) / 2] : (inc[inc.length / 2 - 1] + inc[inc.length / 2]) / 2) : null;

  const W = 1000, H = 380, L = 56, R = 24, T = 20, B = 46;
  const xs = [...ok.map((d) => d.x), ...(t ? [t.x] : [])], ys = [...ok.map((d) => d.y), ...(t ? [t.y] : [])];
  const geo = useMemo(() => {
    if (!xs.length) return null;
    const lx0 = Math.log10(Math.min(...xs)) - 0.15, lx1 = Math.log10(Math.max(...xs)) + 0.15;
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.18 || Math.abs(y1) * 0.2 || 1; y0 -= pad; y1 += pad;
    return { lx0, lx1: lx1 === lx0 ? lx0 + 1 : lx1, y0, y1 };
  }, [JSON.stringify(xs), JSON.stringify(ys)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!geo) {
    return <div className="pm-empty">Add priced peers with figures — they appear here by size and {options.find((o) => o.key === key)?.label || 'multiple'}.</div>;
  }
  const X = (v) => L + ((Math.log10(v) - geo.lx0) / (geo.lx1 - geo.lx0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - geo.y0) / (geo.y1 - geo.y0)) * (H - T - B);
  const yTicks = Array.from({ length: 5 }, (_, i) => geo.y0 + ((geo.y1 - geo.y0) * i) / 4);
  const xTicks = [];
  for (let e = Math.floor(geo.lx0); e <= Math.ceil(geo.lx1); e++) [1, 2, 5].forEach((k) => { const v = k * 10 ** e; if (Math.log10(v) >= geo.lx0 && Math.log10(v) <= geo.lx1) xTicks.push(v); });

  return (
    <div className="pm">
      <div className="pm-h">
        <div className="pm-leg">{tiers.map((tn) => <span key={tn}><i style={{ background: TIER_COL[tiers.indexOf(tn) % TIER_COL.length] }} />{tn}</span>)}<span><i className="ring" />Target</span><span><i className="dash" />Median of included</span></div>
        <span className="seg">{options.map((o) => <button type="button" key={o.key} className={key === o.key ? 'on' : ''} onClick={() => setKey(o.key)}>{o.label}</button>)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pm-svg" role="img" aria-label="Peers by size and multiple">
        {yTicks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="pm-grid" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" className="pm-ax">{v.toFixed(1)}x</text></g>)}
        {xTicks.map((v) => <text key={v} x={X(v)} y={H - 24} textAnchor="middle" className="pm-ax">{sym}{fmtTpl(v, 'n0', locale)}</text>)}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="pm-ax">Market cap (log scale)</text>
        {fin(med) && <g><line x1={L} x2={W - R} y1={Y(med)} y2={Y(med)} className="pm-med" /><text x={W - R} y={Y(med) - 6} textAnchor="end" className="pm-medt">median {med.toFixed(1)}x</text></g>}
        {ok.map(({ p, x, y }) => {
          const on = p.include === 1, h = hover === p.id;
          return (
            <g key={p.id} className={`pm-dot${on ? '' : ' off'}${h ? ' hl' : ''}`} onClick={() => onToggle(p.id)} onMouseEnter={() => onHover?.(p.id)} onMouseLeave={() => onHover?.(null)} style={{ cursor: 'pointer' }}>
              {h && <circle cx={X(x)} cy={Y(y)} r="17" fill="none" stroke={col(p)} strokeOpacity=".45" strokeWidth="2" />}
              <circle cx={X(x)} cy={Y(y)} r="9" fill={on ? col(p) : 'var(--surface)'} stroke={col(p)} strokeWidth="2" />
              <text x={X(x) + 13} y={Y(y) + 4} className="pm-lb">{p.name || p.ticker}{on ? '' : ' (excluded)'}</text>
              <title>{`${p.name || p.ticker || p.role}: ${y.toFixed(1)}x · ${sym}${fmtTpl(x, 'n0', locale)} — click to ${on ? 'exclude' : 'include'}`}</title>
            </g>
          );
        })}
        {t && <g><circle cx={X(t.x)} cy={Y(t.y)} r="11" className="pm-t" /><text x={X(t.x) + 15} y={Y(t.y) + 20} className="pm-tl">Target {t.y.toFixed(1)}x</text></g>}
      </svg>
      {nm.length > 0 && <div className="fld-h">Not plotted (no price or a negative / blank metric): {nm.map((d) => d.p.name || d.p.ticker || d.p.role).join(', ')}</div>}
    </div>
  );
}
