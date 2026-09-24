import React, { useEffect, useRef, useState } from 'react';
import { Anim } from '../../lib/anim.jsx';
import { fmtPrice, fmtPct } from '../../lib/format.js';

/** Animated price that flashes green/red on direction of change. */
function Px({ value, settings }) {
  const prev = useRef(value);
  const [dir, setDir] = useState('');
  useEffect(() => {
    if (!isFinite(value) || !isFinite(prev.current) || value === prev.current) {
      prev.current = value;
      return;
    }
    setDir(value > prev.current ? 'up' : 'down');
    prev.current = value;
    const t = setTimeout(() => setDir(''), 650);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <b className={`tk-px ${dir}`}>
      <Anim value={value} fmt={(v) => fmtPrice(v, settings)} />
    </b>
  );
}

/**
 * Always-visible valuation tape: blended value, market price, and every
 * method's implied share price — live, animated, click-to-jump.
 */
export default function TickerStrip({ summary, a, activeView, onSelect }) {
  const s = a.settings;
  const px = a.company.currentPrice;
  const { methods, blended, upside } = summary;

  const vs = (p) => (px > 0 && isFinite(p) ? (p / px - 1) * 100 : NaN);

  return (
    <div className="ticker" role="toolbar" aria-label="Live valuations">
      <button className={`tk tk-blend${activeView === 'summary' ? ' on' : ''}`} onClick={() => onSelect('summary')} title="Blended mid across every method — open Summary">
        <span className="tk-name">Blended</span>
        <Px value={blended} settings={s} />
        {isFinite(upside) && (
          <span className={`tk-d ${upside >= 0 ? 'pos' : 'neg'}`}>
            {upside >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(upside), 1)}
          </span>
        )}
      </button>

      {px > 0 && (
        <span className="tk tk-mkt" title="Current market price (Company & Market panel)">
          <span className="tk-name">Market</span>
          <b className="tk-px">{fmtPrice(px, s)}</b>
        </span>
      )}

      <span className="tk-sep" />

      {methods.map((m) => {
        const d = vs(m.price);
        return (
          <button key={m.id} className={`tk${activeView === m.view ? ' on' : ''}`} onClick={() => onSelect(m.view)} title={`Open ${m.label}`}>
            <span className="tk-name">{m.label}</span>
            <Px value={m.price} settings={s} />
            {isFinite(d) && (
              <span className={`tk-d ${d >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(d), 0)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
