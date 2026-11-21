import React, { useEffect, useRef, useState } from 'react';
import FlowOverview from './FlowOverview.jsx';
import { NewCompanyForm, CompanySettings } from './CompanyForms.jsx';
import { METHOD_META, VALUATION_ORDER, ANALYSIS_ORDER } from '../methods/labels.js';
import { setActive } from '../store/store.js';
import { UNITS } from '../lib/format.js';
import { effectiveYear1 } from '../lib/period.js';

const SunIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
const MoonIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>;

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

const SETTINGS_ICON = <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>;
const Icon = ({ d }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

/**
 * The app frame: one top bar (the layout the user picked with the flow-map
 * overview) — the logo, Overview / method with a method switcher, the company
 * menu, the theme and company settings. No sidebar: the overview map is the
 * way into every method.
 */
export function TopBar({ state, record, method, onOpen, onHome, onNew, onSettings, theme, onTheme }) {
  const [open, setOpen] = useState(null);   // 'co' | 'm' | null
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const list = Object.values(state.companies).sort((a, b) => b.updatedAt - a.updatedAt);
  const initials = (record?.name || 'QV').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const Chevron = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>;
  return (
    <header className="tb" ref={ref}>
      <button className="tb-logo" onClick={onHome} title="Overview">
        <i aria-hidden="true">QV</i><span>Quant Value</span>
      </button>
      {record && (
        <nav className="tb-crumb" aria-label="Breadcrumb">
          {method ? <button onClick={onHome}>Overview</button> : <b>Overview</b>}
          <span className="tb-sep">/</span>
          <div className="tb-dd">
            <button className={`tb-m${method ? ' on' : ''}`} onClick={() => setOpen(open === 'm' ? null : 'm')} aria-expanded={open === 'm'}>
              {method ? METHOD_META[method].label : 'Open a method'} <Chevron />
            </button>
            {open === 'm' && (
              <div className="tb-menu">
                <div className="tb-menu-h">Valuation</div>
                {VALUATION_ORDER.map((id) => <button key={id} className={method === id ? 'on' : ''} onClick={() => { setOpen(null); onOpen(id); }}><Icon d={ICONS[id]} />{METHOD_META[id].label}</button>)}
                <div className="tb-menu-h">Analysis</div>
                {ANALYSIS_ORDER.map((id) => <button key={id} className={method === id ? 'on' : ''} onClick={() => { setOpen(null); onOpen(id); }}><Icon d={ICONS[id]} />{METHOD_META[id].label}</button>)}
              </div>
            )}
          </div>
        </nav>
      )}
      <span className="spacer" />
      <div id="tb-slot" className="tb-slot" />
      {record && (
        <div className="tb-dd">
          <button className="tb-co" onClick={() => setOpen(open === 'co' ? null : 'co')} aria-expanded={open === 'co'} title="Switch company">
            <i aria-hidden="true">{initials}</i>
            <span><b>{record.name}</b><small>{record.currency} {UNITS[record.unit]} · FY ends {new Date(2000, (record.fyEndMonth || 12) - 1, 1).toLocaleString('en', { month: 'short' })} · Year 1 {effectiveYear1(record.startYear, record.fyEndMonth)}</small></span>
            <Chevron />
          </button>
          {open === 'co' && (
            <div className="tb-menu right">
              <div className="tb-menu-h">Saved companies</div>
              {list.map((c) => (
                <button key={c.id} className={c.id === record.id ? 'on' : ''} onClick={() => { setActive(c.id); setOpen(null); onHome(); }}>
                  <span>{c.name}</span><span className="co-meta">{c.currency} · {c.unit}</span>
                </button>
              ))}
              <div className="tb-menu-sep" />
              <button onClick={() => { setOpen(null); onNew(); }}>+ New company</button>
              <button onClick={() => { setOpen(null); onSettings(); }}>Company settings…</button>
            </div>
          )}
        </div>
      )}
      {onTheme && (
        <button className="tb-ic" onClick={onTheme} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      )}
      {record && <button className="tb-ic" onClick={onSettings} title="Company settings" aria-label="Company settings"><Icon d={SETTINGS_ICON} /></button>}
    </header>
  );
}

/** The overview: the flow map the user picked (data → methods → combined value). */
export function Home({ record, onOpen }) {
  return <FlowOverview record={record} onOpen={onOpen} />;
}

/** First launch (or no company open): the split screen the user approved. */
export function FirstRun({ state }) {
  const others = Object.values(state?.companies || {}).sort((a, b) => b.updatedAt - a.updatedAt);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  const meth = ['DCF', 'Comps', 'Precedent', 'LBO', 'IPO', '3-Statement', 'Ratios'];
  return (
    <div className="fr2">
      <aside className="fr2-side">
        <div className="fr2-brand"><i>QV</i><div><b>Quant Value</b><small>Financial quantitative analysis &amp; value insights</small></div></div>
        <h2>Enter the company once.<br />Value it every way.</h2>
        <p>Every method reads the same figures, and their answers meet in one combined value.</p>
        <svg className="fr2-map" viewBox="0 0 420 330" aria-hidden="true">
          {meth.map((m, i) => {
            const y = 14 + i * 46;
            return (
              <g key={m}>
                <path d={`M118,165 C150,165 150,${y + 15} 182,${y + 15}`} className="w" />
                <path d={`M282,${y + 15} C300,${y + 15} 300,165 304,165`} className="w2" />
                <rect x="182" y={y} width="100" height="30" rx="8" className="n" />
                <text x="194" y={y + 19.5}>{m}</text>
              </g>
            );
          })}
          <rect x="0" y="140" width="118" height="50" rx="11" className="n" />
          <text x="12" y="160" className="s">Your company</text>
          <text x="12" y="178" className="b">one set of figures</text>
          <rect x="304" y="128" width="116" height="74" rx="13" className="r" />
          <text x="316" y="150" className="rs">Combined</text>
          <text x="316" y="172" className="rb">value</text>
          <text x="316" y="191" className="rs">appears as you go</text>
        </svg>
        <div className="fr2-feat"><span>✓ Yahoo Finance fill</span><span>✓ Paste from Excel</span><span>✓ Excel download</span></div>
      </aside>
      <main className="fr2-main">
        {others.length > 0 && (
          <div className="fr2-top">
            <span>Already have one?</span>
            <div className="tb-dd" ref={menuRef}>
              <button className="btn sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>Open recent ▾</button>
              {menu && (
                <div className="tb-menu right">
                  {others.map((c) => <button key={c.id} onClick={() => { setActive(c.id); setMenu(false); }}><span>{c.name}</span><span className="co-meta">{c.currency} · {c.unit}</span></button>)}
                </div>
              )}
            </div>
          </div>
        )}
        <NewCompanyForm />
      </main>
    </div>
  );
}

export { NewCompanyForm, CompanySettings };
