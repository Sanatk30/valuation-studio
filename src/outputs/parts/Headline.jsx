import React from 'react';
import { Anim } from '../../lib/anim.jsx';
import { fin } from './format.js';
import './outputs.css';

/**
 * The answer, on top of every output page: a one-line description (the
 * method and its basis, then the explanation), any warnings, a row of KPI
 * cards — the headline figure first, with an accent — and the page's main
 * charts, each in its own widget.
 *
 * value: the headline figure (optional; its label is `valueLabel`, else the
 *        part of the eyebrow after "—"). Without it, the KPI marked `hero` leads.
 * kpis: [{ label, value?, fmt?, text?, sub?, tone?: 'pos'|'neg'|'muted', hero? }]
 *   A KPI with neither a finite `value` nor `text` renders "—".
 */
export default function Headline({ eyebrow, value, valueLabel, fmt = (v) => v, sub, kpis = [], warnings = [], children }) {
  const list = kpis.filter(Boolean);
  const lead = value !== undefined
    ? { label: valueLabel || cap(String(eyebrow || '').split(' — ').pop()), value, fmt, lead: true, na: 'NA' }
    : null;
  const cells = lead ? [lead, ...list.map((k) => ({ ...k, lead: false }))] : [...list].sort((x, y) => (y.hero ? 1 : 0) - (x.hero ? 1 : 0)).map((k, i) => ({ ...k, lead: i === 0 && !!k.hero }));
  return (
    <div className="qo-headline">
      {(eyebrow || sub) && <p className="out-desc">{eyebrow ? <b>{eyebrow}. </b> : null}{sub}</p>}
      {warnings.filter(Boolean).map((w, i) => <div className="warn" key={i}>{w}</div>)}
      {cells.length > 0 && (
        <div className="kpis">
          {cells.map((k, i) => (
            <div className={`kpi${k.lead ? ' lead' : ''}`} key={i}>
              <span>{k.label}</span>
              <b className={k.lead ? '' : k.tone || ''}>
                {k.text !== undefined
                  ? k.text
                  : fin(k.value)
                    ? <Anim value={k.value} fmt={k.fmt || ((v) => v)} />
                    : (k.na || '—')}
              </b>
              {k.sub ? <em className={k.tone && k.lead ? k.tone : ''}>{k.sub}</em> : null}
            </div>
          ))}
        </div>
      )}
      {children ? <div className="qo-charts">{children}</div> : null}
    </div>
  );
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
