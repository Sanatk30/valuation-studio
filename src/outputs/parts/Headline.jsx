import React from 'react';
import { Anim } from '../../lib/anim.jsx';
import { fin } from './format.js';
import './outputs.css';

/**
 * The answer, on top of every output page: an eyebrow, the headline figure
 * (optional — a method without a single answer shows only its KPI cards),
 * a one-line explanation, then KPI cards.
 *
 * kpis: [{ label, value?, fmt?, text?, sub?, tone?: 'pos'|'neg'|'muted', hero? }]
 *   A KPI with neither a finite `value` nor `text` renders "—".
 */
export default function Headline({ eyebrow, value, fmt = (v) => v, sub, kpis = [], warnings = [], children }) {
  const hasValue = value !== undefined;
  return (
    <div className="qo-headline">
      <div className="hero">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        {hasValue && (
          <div className="hero-num">
            {fin(value) ? <Anim value={value} fmt={fmt} /> : <span className="qo-hero-na">NA</span>}
          </div>
        )}
        {sub ? <div className="hero-sub">{sub}</div> : null}
      </div>
      {warnings.filter(Boolean).map((w, i) => <div className="warn" key={i}>{w}</div>)}
      {kpis.length > 0 && (
        <div className="qo-kpis">
          {kpis.filter(Boolean).map((k, i) => (
            <div className={`card${k.hero ? ' hero' : ''}`} key={i}>
              <div className="k">{k.label}</div>
              <div className={`v${k.tone ? ` ${k.tone}` : ''}`}>
                {k.text !== undefined
                  ? k.text
                  : fin(k.value)
                    ? <Anim value={k.value} fmt={k.fmt || ((v) => v)} />
                    : '—'}
              </div>
              {k.sub ? <div className="s">{k.sub}</div> : null}
            </div>
          ))}
        </div>
      )}
      {children ? <div className="qo-charts">{children}</div> : null}
    </div>
  );
}
