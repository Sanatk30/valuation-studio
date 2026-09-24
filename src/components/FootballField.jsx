import React, { useMemo } from 'react';
import { useTweenedArray } from '../lib/anim.jsx';

/**
 * Football-field valuation chart (SVG). Bars spring-animate to new positions
 * as assumptions move. items: { label, low, mid, high, color? }.
 */
export default function FootballField({ items, currentPrice, fmt }) {
  const valid = items.filter((it) => isFinite(it.low) && isFinite(it.high));
  const target = useMemo(
    () => [
      ...valid.map((it) => it.low),
      ...valid.map((it) => it.mid),
      ...valid.map((it) => it.high),
      isFinite(currentPrice) ? currentPrice : 0,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid.map((it) => `${it.low}|${it.mid}|${it.high}`).join(','), currentPrice]
  );
  const tw = useTweenedArray(target);
  const m = valid.length;
  if (!m) return <div className="sec-note">No valid ranges to plot.</div>;
  const lows = tw.slice(0, m), mids = tw.slice(m, 2 * m), highs = tw.slice(2 * m, 3 * m);
  const px = tw[3 * m];

  const allVals = [...lows, ...highs];
  if (isFinite(currentPrice) && currentPrice > 0) allVals.push(px);
  let lo = Math.min(...allVals);
  let hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
  lo -= pad; hi += pad;

  const W = 780, labelW = 178, rightW = 24, rowH = 46, topH = 34;
  const H = topH + m * rowH + 28;
  const plotW = W - labelW - rightW;
  const x = (v) => labelW + ((v - lo) / (hi - lo)) * plotW;

  const ticks = 5;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        {valid.map((it, i) => {
          const c = it.color || '#6C8CFF';
          return (
            <linearGradient key={i} id={`ffg${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={c} stopOpacity="0.18" />
              <stop offset="50%" stopColor={c} stopOpacity="0.5" />
              <stop offset="100%" stopColor={c} stopOpacity="0.18" />
            </linearGradient>
          );
        })}
      </defs>
      {tickVals.map((tv, i) => (
        <g key={i}>
          <line x1={x(tv)} y1={topH - 8} x2={x(tv)} y2={H - 24} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
          <text x={x(tv)} y={H - 8} fill="#6E7889" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif">
            {fmt(tv)}
          </text>
        </g>
      ))}
      {valid.map((it, i) => {
        const y = topH + i * rowH + rowH / 2;
        const bx = x(lows[i]), bw = Math.max(3, x(highs[i]) - x(lows[i]));
        const color = it.color || '#6C8CFF';
        return (
          <g key={i}>
            <text x={0} y={y + 4} fill="#C6CFDD" fontSize="12.5" fontFamily="Inter, sans-serif" fontWeight="500">{it.label}</text>
            <rect x={bx} y={y - 12} width={bw} height={24} rx={8} fill={`url(#ffg${i})`} />
            <rect x={bx} y={y - 12} width={bw} height={24} rx={8} fill="none" stroke={color} strokeOpacity="0.75" strokeWidth="1.4" />
            {isFinite(mids[i]) && (
              <g>
                <line x1={x(mids[i])} y1={y - 14} x2={x(mids[i])} y2={y + 14} stroke={color} strokeWidth="3.2" strokeLinecap="round" />
                <circle cx={x(mids[i])} cy={y - 17} r="2.2" fill={color} />
              </g>
            )}
            <text x={bx - 7} y={y + 4} fill="#6E7889" fontSize="10.5" textAnchor="end" fontFamily="Inter, sans-serif">{fmt(lows[i])}</text>
            <text x={bx + bw + 7} y={y + 4} fill="#C6CFDD" fontSize="10.5" fontFamily="Inter, sans-serif">{fmt(highs[i])}</text>
          </g>
        );
      })}
      {isFinite(currentPrice) && currentPrice > 0 && (
        <g>
          <line x1={x(px)} y1={topH - 10} x2={x(px)} y2={H - 24} stroke="#FBBF24" strokeWidth="2" strokeDasharray="6 5" />
          <rect x={x(px) - 52} y={topH - 30} width="104" height="18" rx="9" fill="rgba(255,206,84,0.14)" stroke="rgba(255,206,84,0.6)" strokeWidth="1" />
          <text x={x(px)} y={topH - 17} fill="#FBBF24" fontSize="10.5" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700">
            Mkt {fmt(px)}
          </text>
        </g>
      )}
    </svg>
  );
}
