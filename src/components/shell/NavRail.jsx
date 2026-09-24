import React from 'react';

/** Minimal geometric icons, one per view — stroke inherits currentColor. */
const ICONS = {
  summary: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  ),
  dcf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" />
    </svg>
  ),
  ts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" />
    </svg>
  ),
  ratios: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5L5 19" /><circle cx="7" cy="7" r="2.6" /><circle cx="17" cy="17" r="2.6" />
    </svg>
  ),
  lbo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M3 13h18" />
    </svg>
  ),
  comps: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20V10M12 20V4M19 20v-8" />
    </svg>
  ),
  reg: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20L20 6" /><circle cx="7" cy="14" r="1.4" /><circle cx="11" cy="16" r="1.4" /><circle cx="13" cy="9" r="1.4" /><circle cx="17" cy="11" r="1.4" /><path d="M3 3v18h18" />
    </svg>
  ),
  prec: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V8l6-5 6 5v13" /><path d="M20 21V11l-4-3" /><path d="M8 21v-4h4v4" /><path d="M2 21h20" />
    </svg>
  ),
  ipo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c3 2.5 4.5 6 4.5 9.5L12 15l-4.5-3.5C7.5 8 9 4.5 12 2z" /><path d="M7.5 11.5L4 15l3 1 1 3 3.5-3.5" /><circle cx="12" cy="8.5" r="1.4" />
    </svg>
  ),
  charts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.2 15.9A10 10 0 118.1 2.8" /><path d="M22 12A10 10 0 0012 2v10z" />
    </svg>
  ),
};

/** Sidebar grouping — mirrors how the methods relate, not just their order. */
const GROUPS = [
  { label: 'Overview', ids: ['summary', 'charts'] },
  { label: 'Model', ids: ['dcf', 'ts', 'ratios'] },
  { label: 'Deal methods', ids: ['lbo', 'comps', 'reg', 'prec', 'ipo'] },
];

/**
 * Persistent left navigation — the spine of the workspace.
 * Grouped sections, collapsible to icons; each item deep-links (?view=) and
 * shows its keyboard number. Footer card confirms the model is live.
 */
export default function NavRail({ tabs, active, onSelect, collapsed, onToggleCollapse }) {
  const grouped = new Set(GROUPS.flatMap((g) => g.ids));
  const extras = tabs.filter((t) => !grouped.has(t.id));
  const sections = [
    ...GROUPS.map((g) => ({ ...g, items: g.ids.map((id) => tabs.find((t) => t.id === id)).filter(Boolean) })),
    ...(extras.length ? [{ label: 'More', items: extras }] : []),
  ];
  const item = (t) => {
    const i = tabs.indexOf(t);
    return (
      <button
        key={t.id}
        className={`rail-item${active === t.id ? ' active' : ''}`}
        onClick={() => onSelect(t.id)}
        title={collapsed ? `${t.label}  ·  press ${i + 1}` : `Press ${i + 1}`}
      >
        <span className="rail-ico">{ICONS[t.id]}</span>
        {!collapsed && <span className="rail-label">{t.label}</span>}
        {!collapsed && <kbd>{i + 1}</kbd>}
      </button>
    );
  };
  return (
    <nav className={`rail${collapsed ? ' collapsed' : ''}`} aria-label="Methods">
      <div className="rail-brand" onClick={onToggleCollapse} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
        <div className="mark">V</div>
        {!collapsed && (
          <div className="rail-brand-name">
            Valuation Studio
            <small>Live modeling suite</small>
          </div>
        )}
      </div>

      <div className="rail-items">
        {sections.map((sec) => (
          <React.Fragment key={sec.label}>
            <div className="rail-sect">{collapsed ? '·' : sec.label}</div>
            {sec.items.map(item)}
          </React.Fragment>
        ))}
      </div>

      <div className="rail-foot" title="Balance sheet ties — the model recalculates on every input">
        <b><span className="dot" />{!collapsed && 'Model live'}</b>
        {!collapsed && <span>Balance ties · recalculates on every input</span>}
      </div>

      <button className="rail-collapse" onClick={onToggleCollapse} title={collapsed ? 'Expand' : 'Collapse'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {!collapsed && <span>Collapse</span>}
      </button>
    </nav>
  );
}
