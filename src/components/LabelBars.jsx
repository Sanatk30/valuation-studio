import React from 'react';

/**
 * Bar chart with every value printed on it (the chosen 3-Statement and Ratio
 * designs: graphical, but every number visible).
 *   labels  — x labels
 *   series  — [{ name, data, color }] grouped bars (negative values go down)
 *   lines   — [{ name, data, color }] lines on their own scale, each point labelled
 *   ref     — { value, label } dashed reference line on the bar scale
 *   colorOf — optional (seriesIndex, i, v) => colour, for per-bar colouring
 *   fmt     — value formatter
 */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export default function LabelBars({ labels, series, lines = [], refLine, fmt = (v) => String(v), lineFmt = (v) => `${v.toFixed(1)}%`, colorOf, h = 260, w = 900, legend = true, small = false }) {
  const all = series.flatMap((s) => s.data).filter(fin).concat(refLine && fin(refLine.value) ? [refLine.value] : []);
  const mx = Math.max(0, ...all), mn = Math.min(0, ...all);
  const span = mx - mn || 1;
  const T = lines.length ? 44 : 22, B = 26, L = 6, R = 6;
  const top = mx + span * 0.14, bot = mn < 0 ? mn - span * 0.12 : 0;
  const y = (v) => T + (h - T - B) * (1 - (v - bot) / (top - bot));
  const n = labels.length, gw = (w - L - R) / n;
  const bw = Math.min(46, (gw * 0.72) / series.length);
  const fs = small ? 10 : 11;
  return (
    <div className="lb">
      {legend && (series.length > 1 || lines.length > 0 || refLine) && (
        <div className="lb-leg">
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          {lines.map((l) => <span key={l.name}><i className="ln" style={{ background: l.color }} />{l.name}</span>)}
          {refLine && <span><i className="ref" />{refLine.label}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={series.map((s) => s.name).join(', ')}>
        <line x1={L} x2={w - R} y1={y(0)} y2={y(0)} className="lb-0" />
        {labels.map((lab, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={i}>
              {series.map((s, k) => {
                const v = s.data[i];
                if (!fin(v)) return null;
                const x0 = cx - (bw * series.length) / 2 + k * bw;
                const yv = y(Math.max(v, 0)), yb = y(Math.min(v, 0));
                const col = colorOf ? colorOf(k, i, v) : s.color;
                return (
                  <g key={k}>
                    <rect x={x0 + 1} y={yv} width={bw - 2} height={Math.max(1, yb - yv)} rx="3" fill={col} className="lb-bar" style={{ animationDelay: `${(i * series.length + k) * 55}ms`, transformOrigin: `0 ${y(0)}px` }}><title>{`${s.name} ${lab}: ${fmt(v)}`}</title></rect>
                    <text x={x0 + bw / 2} y={v >= 0 ? yv - 4 : yb + fs + 2} textAnchor="middle" className="lb-v" style={{ fontSize: fs, animationDelay: `${(i * series.length + k) * 55 + 250}ms` }}>{fmt(v)}</text>
                  </g>
                );
              })}
              <text x={cx} y={h - 8} textAnchor="middle" className="lb-x" style={{ fontSize: fs }}>{lab}</text>
            </g>
          );
        })}
        {refLine && fin(refLine.value) && <line x1={L} x2={w - R} y1={y(refLine.value)} y2={y(refLine.value)} className="lb-ref" />}
        {lines.map((ln) => {
          const v = ln.data.filter(fin);
          if (!v.length) return null;
          const lmx = Math.max(...v), lmn = Math.min(...v);
          const ly = (x) => 14 + 18 * (1 - (x - lmn) / (lmx - lmn || 1));
          const pts = ln.data.map((x, i) => (fin(x) ? [L + gw * i + gw / 2, ly(x)] : null));
          return (
            <g key={ln.name}>
              <polyline points={pts.filter(Boolean).map((p) => p.join(',')).join(' ')} fill="none" stroke={ln.color} strokeWidth="2.2" />
              {pts.map((p, i) => p && (
                <g key={i}>
                  <rect x={p[0] - 21} y={p[1] - 8} width="42" height="15" rx="4" fill={ln.color} />
                  <text x={p[0]} y={p[1] + 3.5} textAnchor="middle" className="lb-lt">{lineFmt(ln.data[i])}</text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
