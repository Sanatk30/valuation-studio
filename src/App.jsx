import React, { useEffect, useState } from 'react';
import { useStore } from './store/store.js';
import { METHODS } from './methods/registry.js';
import { routeOf } from './methods/labels.js';
import MethodPage from './wizard/MethodPage.jsx';
import { TopBar, Home, FirstRun, NewCompanyForm, CompanySettings } from './home/Home.jsx';

/** `#/dcf` opens a method; `#/` (or nothing, or anything unknown) is the method picker. */
const readRoute = () => routeOf(window.location.hash);

export default function App() {
  const state = useStore();
  const record = state.companies[state.activeId] || null;
  const [method, setMethod] = useState(readRoute);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setMethod(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const open = (id) => { window.location.hash = id ? `/${id}` : '/'; setMethod(id); };

  useEffect(() => {
    document.title = record ? `${record.name}${method ? ` · ${METHODS[method].short}` : ''} — Quant Value` : 'Quant Value';
  }, [record, method]);

  return (
    <div className="qv">
      <TopBar
        state={state} record={record}
        onHome={() => open(null)}
        onNew={() => setNewOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="qv-main">
        {!record ? <FirstRun />
          : method ? <MethodPage key={`${record.id}-${method}`} record={record} methodId={method} onHome={() => open(null)} />
            : <Home record={record} onOpen={open} />}
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
  );
}
