import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import CompanyLibrary from '../CompanyLibrary.jsx';
import CompanySearchBar from '../CompanySearchBar.jsx';
import { SCENARIOS } from '../../lib/engine/scenario.js';
import { useEdgeClamp } from '../../lib/ui.js';

/** Per-method Excel files (plus the full model). */
const EXPORTS = [
  { key: 'full', label: 'Full model (all methods)' },
  { key: 'dcf', label: 'DCF Analysis' },
  { key: 'ts', label: '3-Statement Model' },
  { key: 'lbo', label: 'LBO Analysis' },
  { key: 'comps', label: 'Comparable Companies' },
  { key: 'reg', label: 'Regression Analysis' },
  { key: 'precedent', label: 'Precedent Transactions' },
  { key: 'ipo', label: 'IPO Valuation' },
];

/**
 * Command bar: company identity, scenario, and every global action.
 * Model settings (currency/unit/period/years) live in the Assumptions dock.
 */
export default function TopBar({ a, set, setA, onExport, exporting, onFetch, onData, onReset, dockOpen, onToggleDock }) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  const [exportMenuRef, exportMenuPos] = useEdgeClamp(exportOpen);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  // sliding scenario indicator
  const scenRefs = useRef({});
  const [scenPill, setScenPill] = useState(null);
  const scenario = a.settings.scenario || 'base';
  useLayoutEffect(() => {
    const el = scenRefs.current[scenario];
    if (el) setScenPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [scenario]);
  useEffect(() => {
    const onResize = () => {
      const el = scenRefs.current[scenario];
      if (el) setScenPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scenario]);

  return (
    <header className="topbar">
      <CompanySearchBar
        value={a.company.name}
        onName={(v) => set('company.name', v)}
        onPick={onFetch}
      />

      <div className="scen" title="Scenario: shifts growth, margins, multiples & risk premium across every model">
        {scenPill && <div className={`scen-ind ${scenario}`} style={{ left: scenPill.left, width: scenPill.width }} />}
        {Object.entries(SCENARIOS).map(([k, v]) => (
          <button
            key={k}
            ref={(el) => (scenRefs.current[k] = el)}
            className={scenario === k ? `on ${k}` : ''}
            onClick={() => set('settings.scenario', k)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="spacer" />

      <button className="btn" onClick={onData} title="Every assumption in one form, plus JSON copy/paste">Enter Data</button>
      <CompanyLibrary a={a} onLoad={(next) => setA(next)} />
      <button className="btn ghost" onClick={onReset}>Reset</button>

      <div className="export-wrap" ref={exportRef}>
        <button className="btn primary" onClick={() => setExportOpen(!exportOpen)} disabled={exporting}>
          {exporting ? 'Building…' : 'Export Excel ▾'}
        </button>
        {exportOpen && (
          <div className="export-menu" ref={exportMenuRef} style={exportMenuPos}>
            <div className="export-head">Live-formula workbooks</div>
            {EXPORTS.map((x) => (
              <button key={x.key} className={x.key === 'full' ? 'primary-row' : ''} onClick={() => { setExportOpen(false); onExport(x.key); }}>
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className={`btn dock-toggle${dockOpen ? ' on' : ''}`}
        onClick={onToggleDock}
        title={`${dockOpen ? 'Hide' : 'Show'} the assumptions dock  ·  press A`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
          <circle cx="15.5" cy="8" r="2.2" /><circle cx="9.5" cy="16" r="2.2" />
        </svg>
        Assumptions
      </button>
    </header>
  );
}
