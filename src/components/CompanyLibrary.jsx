import React, { useEffect, useRef, useState } from 'react';
import { mergeAssumptions } from '../lib/defaults.js';
import { readLib, saveCompany, deleteCompany } from '../lib/companyStore.js';
import { useEdgeClamp } from '../lib/ui.js';

/**
 * Saved-company library. Save snapshots the full assumption set under the
 * company name; once saved, every later edit auto-updates the entry (App
 * debounces updateExistingCompany), so entered data is never lost. Load swaps
 * the whole model to that company.
 */
export default function CompanyLibrary({ a, onLoad }) {
  const [open, setOpen] = useState(false);
  const [lib, setLib] = useState(readLib);
  const [savedFlash, setSavedFlash] = useState(false);
  const ref = useRef(null);
  const [menuRef, menuPos] = useEdgeClamp(open);

  useEffect(() => {
    if (!open) return;
    setLib(readLib()); // pick up auto-saved updates
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const names = Object.keys(lib).sort((x, y) => x.localeCompare(y));
  const currentName = (a.company.name || '').trim() || 'Untitled company';

  const save = () => {
    saveCompany(a);
    setLib(readLib());
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };
  const load = (name) => {
    if (!lib[name]) return;
    onLoad(mergeAssumptions(lib[name].data));
    setOpen(false);
  };
  const remove = (name) => {
    if (!confirm(`Delete the saved data for "${name}"? This cannot be undone.`)) return;
    deleteCompany(name);
    setLib(readLib());
  };

  const fmtDate = (t) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="complib" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} title="Saved companies — load or manage">
        Companies{names.length ? ` (${names.length})` : ''}
      </button>
      <button
        className="btn"
        onClick={save}
        title={`Save every assumption under "${currentName}" — after that, edits keep it up to date automatically`}
      >
        {savedFlash ? 'Saved ✓' : 'Save'}
      </button>
      {open && (
        <div className="complib-menu" ref={menuRef} style={menuPos}>
          <div className="complib-head">
            Saved companies
            <span>
              Load swaps the whole model. Once a company is saved, everything you enter keeps it updated
              automatically — Save again only to add a new name.
            </span>
          </div>
          {names.length === 0 && (
            <div className="complib-empty">
              Nothing saved yet. Enter a company's data, then hit Save — from then on it stays saved as you work.
            </div>
          )}
          {names.map((name) => (
            <div className="complib-row" key={name}>
              <button className="complib-load" onClick={() => load(name)} title="Load this company into the model">
                <b>{name}</b>
                <span>{fmtDate(lib[name].updatedAt ?? lib[name].savedAt)}</span>
              </button>
              <button className="peer-del" onClick={() => remove(name)} title="Delete this saved company">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
