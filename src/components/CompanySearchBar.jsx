import React, { useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../lib/yahoo.js';

/**
 * The company name field, doubling as a live listing search.
 *
 * Typing always sets the company name — a private company is just a name you
 * type and nothing else happens. Alongside, a debounced Yahoo search offers
 * matching listings; picking one hands the symbol up so the caller can fetch it
 * and show its preview. Nothing about the model changes from typing alone.
 */
export default function CompanySearchBar({ value, onName, onPick }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hi, setHi] = useState(-1);          // keyboard-highlighted row
  const [typed, setTyped] = useState(false); // suggestions only after the user types
  const wrapRef = useRef(null);
  const seq = useRef(0);

  // close when the focus or the pointer leaves
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // debounced search — only once the user has actually typed something new
  useEffect(() => {
    if (!typed) return;
    const q = (value || '').trim();
    if (q.length < 2) { setResults([]); setErr(''); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true); setErr('');
      try {
        const r = await searchSymbols(q);
        if (seq.current !== mine) return;      // a newer keystroke won
        setResults(r);
        setHi(-1);
        if (r.length) setOpen(true);
      } catch (e) {
        if (seq.current !== mine) return;
        setResults([]);
        setErr('Listing search needs the dev server (npm run dev) — you can still type a name for a private company.');
      } finally {
        if (seq.current === mine) setBusy(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [value, typed]);

  const choose = (r) => {
    setOpen(false);
    setTyped(false);
    onPick(r.symbol);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) {
      if (e.key === 'ArrowDown' && results.length) { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { setHi((h) => Math.min(h + 1, results.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHi((h) => Math.max(h - 1, -1)); e.preventDefault(); }
    else if (e.key === 'Enter' && hi >= 0) { choose(results[hi]); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); e.preventDefault(); }
  };

  return (
    <div className="co-search" ref={wrapRef}>
      <input
        className="company-name-input"
        value={value}
        onChange={(e) => { setTyped(true); onName(e.target.value); }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder="Company name — or search a listing"
        title="Type a company name. Listed companies show matching tickers; pick one to pull its financials. Type any name for a private company."
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {busy && <span className="co-search-spin" title="Searching listings…">⋯</span>}

      {open && (results.length > 0 || err) && (
        <div className="co-search-menu">
          {err && <div className="co-search-err">{err}</div>}
          {results.length > 0 && (
            <>
              <div className="co-search-head">Listed matches — pick one to pull its financials</div>
              {results.map((r, i) => (
                <button
                  key={r.symbol}
                  className={i === hi ? 'on' : ''}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(r)}
                >
                  <b>{r.name}</b>
                  <span>{r.symbol} · {r.exchange}</span>
                </button>
              ))}
              <div className="co-search-foot">Not listed? Just keep typing — the name is all a private company needs.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
