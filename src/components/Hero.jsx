import React from 'react';
import { Anim } from '../lib/anim.jsx';

/**
 * Big cinematic headline block: eyebrow label, huge animated number,
 * narrative sub-line, and metric chips that flow with the model.
 * chips: { label, value?, fmt?, tone? 'pos'|'neg'|'warn', text? }
 */
export default function Hero({ eyebrow, value, fmt, sub, chips = [] }) {
  return (
    <div className="hero">
      <div className="eyebrow">{eyebrow}</div>
      <div className="hero-num">
        <Anim value={value} fmt={fmt} />
      </div>
      {sub ? <div className="hero-sub">{sub}</div> : null}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c, i) => (
            <span key={i} className={`chip${c.tone ? ` ${c.tone}` : ''}`}>
              {c.label}
              {c.value !== undefined ? (
                <b>
                  <Anim value={c.value} fmt={c.fmt || ((v) => v)} />
                </b>
              ) : c.text !== undefined ? (
                <b>{c.text}</b>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
