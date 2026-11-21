import React, { useEffect, useState } from 'react';
import { useStore, resetMethod } from './store/store.js';
import { METHODS } from './methods/registry.js';
import { routeOf } from './methods/labels.js';
import MethodPage from './wizard/MethodPage.jsx';
import { TopBar, Home, FirstRun, NewCompanyForm, CompanySettings } from './home/Home.jsx';
import { ThemeContext, useThemeState } from './lib/theme.js';

/** `#/dcf` opens a method; `#/` (or nothing, or anything unknown) is the method picker. */
const readRoute = () => routeOf(window.location.hash);

/**
 * A view that throws while rendering shows this instead of a blank page. It
 * resets when the route or company changes (it is keyed on both). In a method,
 * Start over clears that method's inputs — the way out when saved inputs are
 * in a shape the steps cannot read.
 */
class ViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { record, method, onHome } = this.props;
    return (
      <div className="step-card view-error">
        <h2>This page could not be shown</h2>
        <ul className="step-errs"><li>{String(error?.message || error)}</li></ul>
        <div className="step-foot">
          {method && <button className="btn ghost" onClick={onHome}>← All methods</button>}
          <button className="btn ghost" onClick={() => window.location.reload()}>Reload</button>
          <div className="spacer" />
          {method && record && (
            <button className="btn" onClick={() => { if (confirm(`Start ${METHODS[method].label} over? Every input in this method is cleared (other methods are untouched).`)) { resetMethod(record.id, method); this.setState({ error: null }); } }}>
              Start {METHODS[method].short} over
            </button>
          )}
        </div>
      </div>
    );
  }
}

export default function App() {
  const state = useStore();
  const record = state.companies[state.activeId] || null;
  const [method, setMethod] = useState(readRoute);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, toggleTheme] = useThemeState();

  useEffect(() => {
    const onHash = () => setMethod(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const open = (id) => { window.location.hash = id ? `/${id}` : '/'; setMethod(id); };

  useEffect(() => {
    document.title = record ? `${record.name}${method ? ` · ${METHODS[method].short}` : ''} — Quant Value` : 'Quant Value';
  }, [record, method]);

  if (!record) {
    return (
      <ThemeContext.Provider value={theme}>
        <FirstRun state={state} />
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
    <div className="qv">
      <TopBar
        state={state} record={record} theme={theme} onTheme={toggleTheme} method={method} onOpen={open}
        onHome={() => open(null)}
        onNew={() => setNewOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="qv-main">
        <ViewBoundary key={`${record?.id}-${method}`} record={record} method={method} onHome={() => open(null)}>
          {method ? <MethodPage key={`${record.id}-${method}`} record={record} methodId={method} onHome={() => open(null)} />
              : <Home record={record} onOpen={open} />}
        </ViewBoundary>
      </main>

      {newOpen && (
        <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewOpen(false); }}>
          <div className="bulk-modal settings-modal">
            <NewCompanyForm onDone={() => { setNewOpen(false); open(null); }} onCancel={() => setNewOpen(false)} />
          </div>
        </div>
      )}
      {settingsOpen && record && <CompanySettings record={record} onClose={() => setSettingsOpen(false)} />}
    </div>
    </ThemeContext.Provider>
  );
}
