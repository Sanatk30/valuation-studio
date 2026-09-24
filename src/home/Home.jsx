import React, { useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';
import { NewCompanyForm, CompanySettings, FY_OPTIONS } from './CompanyForms.jsx';
import { METHODS } from '../methods/registry.js';
import { METHOD_META, VALUATION_ORDER, ANALYSIS_ORDER } from '../methods/labels.js';
import { useCompanyCtx } from '../wizard/MethodPage.jsx';
import { setActive, resetMethod } from '../store/store.js';
import { CURRENCIES, UNITS } from '../lib/format.js';

const ICONS = {
  dcf: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  comps: <path d="M5 20V10M12 20V4M19 20v-8" />,
  precedent: <path d="M4 21V8l6-5 6 5v13M20 21V11l-4-3M8 21v-4h4v4M2 21h20" />,
  lbo: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18" /></>,
  ipo: <><path d="M12 2c3 2.5 4.5 6 4.5 9.5L12 15l-4.5-3.5C7.5 8 9 4.5 12 2z" /><path d="M7.5 11.5L4 15l3 1 1 3 3.5-3.5" /></>,
  combined: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>,
  ts: <><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5M3 17l9 5 9-5" /></>,
  ratios: <><path d="M19 5L5 19" /><circle cx="7" cy="7" r="2.6" /><circle cx="17" cy="17" r="2.6" /></>,
};

export function TopBar({ state, record, onHome, onNew, onSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const list = Object.values(state.companies).sort((a, b) => b.updatedAt - a.updatedAt);
  const fy = record ? FY_OPTIONS.find((o) => o.value === record.fyEndMonth) : null;

  return (
    <header className="qv-top">
      <button className="qv-brand" onClick={onHome} title="All methods">
        <Logo />
        <span className="qv-word"><b>QUANT</b> VALUE</span>
      </button>
      <div className="spacer" />
      {record && (
        <div className="co-bar" ref={ref}>
          <button className="co-pill" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className="co-name">{record.name}</span>
            <span className="co-meta">{CURRENCIES[record.currency].symbol} {record.currency} · {UNITS[record.unit]} · Year 1 = {record.startYear}{fy && fy.value !== 12 ? ` · ${fy.label}` : ''}</span>
            <span className="chev">▾</span>
          </button>
          {open && (
            <div className="co-menu">
              <div className="co-menu-h">Saved companies</div>
              {list.map((c) => (
                <button key={c.id} className={c.id === record.id ? 'on' : ''} onClick={() => { setActive(c.id); setOpen(false); onHome(); }}>
                  <span>{c.name}</span><span className="co-meta">{c.currency} · {c.unit}</span>
                </button>
              ))}
              <div className="co-menu-sep" />
              <button onClick={() => { setOpen(false); onNew(); }}>+ New company</button>
              <button onClick={() => { setOpen(false); onSettings(); }}>Company settings…</button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function MethodCard({ id, record, ctx, onOpen }) {
  const def = METHODS[id];
  const meta = METHOD_META[id];
  const p = ctx.progressOf(id);
  const n = def.steps.length;
  const mstate = record.methods[id];
  const combinedLocked = id === 'combined' && !['dcf', 'comps', 'precedent', 'lbo', 'ipo'].some((m) => ctx.progressOf(m).complete);
  const status = p.complete
    ? { cls: 'done', text: 'Complete' }
    : p.started
      ? { cls: 'prog', text: `Step ${p.reachable + 1} of ${n} — ${def.steps[p.reachable]?.title}` }
      : { cls: '', text: combinedLocked ? 'Complete a valuation method first' : `${n} step${n > 1 ? 's' : ''}` };

  return (
    <div className={`m-card ${status.cls}${combinedLocked ? ' locked' : ''}`}>
      <div className="m-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[id]}</svg></div>
      <div className="m-body">
        <h3>{meta.label}</h3>
        <p>{meta.blurb}</p>
        <div className={`m-status ${status.cls}`}>{status.cls === 'done' ? '✓ ' : ''}{status.text}</div>
      </div>
      <div className="m-acts">
        <button className="btn primary sm" disabled={combinedLocked} onClick={() => onOpen(id)}>
          {p.complete ? 'View output' : p.started ? 'Continue' : 'Start'}
        </button>
        {p.started && (
          <button className="btn ghost sm" onClick={() => { if (confirm(`Start ${meta.label} over? Its inputs are cleared; other methods are untouched.`)) resetMethod(record.id, id); }}>
            Start over
          </button>
        )}
        {mstate?.updatedAt && p.started && <span className="m-when">edited {new Date(mstate.updatedAt).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}

export function Home({ record, onOpen }) {
  const ctx = useCompanyCtx(record);
  return (
    <div className="home">
      <div className="home-intro">
        <h1>Choose a valuation method</h1>
        <p>Each method is independent: it has its own inputs and its own steps. Combined weights the results of the methods you finish.</p>
      </div>
      <h2 className="home-sec">Valuation</h2>
      <div className="m-grid">{VALUATION_ORDER.map((id) => <MethodCard key={id} id={id} record={record} ctx={ctx} onOpen={onOpen} />)}</div>
      <h2 className="home-sec">Analysis</h2>
      <div className="m-grid">{ANALYSIS_ORDER.map((id) => <MethodCard key={id} id={id} record={record} ctx={ctx} onOpen={onOpen} />)}</div>
    </div>
  );
}

export function FirstRun() {
  return (
    <div className="first-run">
      <div className="fr-brand">
        <Logo size={64} />
        <div>
          <div className="fr-word"><b>QUANT</b> VALUE</div>
          <div className="fr-tag">Financial quantitative analysis &amp; value insights</div>
        </div>
      </div>
      <NewCompanyForm />
    </div>
  );
}

export { NewCompanyForm, CompanySettings };
