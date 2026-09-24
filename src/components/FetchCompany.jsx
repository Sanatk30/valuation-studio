import React, { useEffect, useState } from 'react';
import { searchSymbols, fetchCompanyData, fetchStatementHistory, mapToAssumptions } from '../lib/yahoo.js';

/**
 * Live data fetch: type a listed company's name or its ticker, pick the
 * match, see exactly what Yahoo Finance reports and how it maps into the
 * model, then apply. Runs through the dev-server proxy (see vite.config.js).
 */
export default function FetchCompany({ a, onApply, onClose, symbol = null }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(null); // { data, mapped }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // opened from the top-bar search with a listing already chosen: skip straight
  // to its preview, so the only step left is Apply
  useEffect(() => {
    if (symbol) pick(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const search = async () => {
    if (!q.trim()) return;
    setBusy('Searching…');
    setErr('');
    setPicked(null);
    try {
      const r = await searchSymbols(q.trim());
      setResults(r);
      if (!r.length) setErr('No listed matches — try the exact ticker (e.g. RELIANCE.NS, AAPL, TCS.BO).');
    } catch (e) {
      setErr(`Search failed: ${e.message}. The fetch runs through the dev server — make sure you're on npm run dev.`);
    } finally {
      setBusy('');
    }
  };

  const pick = async (symbol) => {
    setBusy(`Fetching ${symbol}…`);
    setErr('');
    try {
      // Full statement history rides along for the 3-Statement "Past" view;
      // its failure must not block the main fetch.
      const [data, statements] = await Promise.all([
        fetchCompanyData(symbol),
        fetchStatementHistory(symbol).catch(() => null),
      ]);
      const mapped = mapToAssumptions(a, data);
      if (statements) {
        statements.currency = data.currency;
        statements.name = data.name;
        mapped.patch.history = statements;
      }
      setPicked({ data, mapped, statements });
    } catch (e) {
      setErr(`Fetch failed for ${symbol}: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  const fmtH = (v) => (isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal" style={{ width: 'min(860px, 96vw)' }}>
        <div className="bulk-head">
          <h2>Fetch live company data</h2>
          <div className="sub">Financials come straight from Yahoo Finance. Nothing changes until you Apply.</div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ fontSize: 16, padding: '4px 10px' }}>✕</button>
        </div>

        {!symbol && <div className="yf-search">
          <input
            type="text"
            value={q}
            autoFocus
            placeholder="e.g. Reliance, TCS.BO, AAPL, Infosys…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          />
          <button className="btn primary" onClick={search} disabled={!!busy}>{busy || 'Search'}</button>
        </div>}
        {symbol && busy && <div className="sec-note" style={{ marginTop: 12 }}>{busy}</div>}
        {err && <div className="warn" style={{ marginTop: 12 }}>{err}</div>}

        {results && !picked && (
          <div className="yf-results">
            {results.map((r) => (
              <button key={r.symbol} onClick={() => pick(r.symbol)} disabled={!!busy}>
                <b>{r.name}</b>
                <span>{r.symbol} · {r.exchange}</span>
              </button>
            ))}
          </div>
        )}

        {picked && (
          <>
            <div className="bulk-sec">
              <h4>{picked.data.name} ({picked.data.symbol}) — what Yahoo reports → what lands in the model</h4>
              <div className="sec-note">
                Figures convert to {picked.mapped.currency} {picked.mapped.unit}. Lines marked “kept as-is” had no data and keep your current value.
              </div>
              <div className="tablewrap">
                <table className="fin">
                  <thead><tr><th>Item</th><th>Yahoo (latest FY, {picked.data.currency})</th><th>Into the model</th></tr></thead>
                  <tbody>
                    {picked.mapped.preview.map(([k, raw, mapped]) => (
                      <tr key={k}><td>{k}</td><td>{raw}</td><td>{mapped}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {picked.statements && (
              <div className="sec-note" style={{ marginTop: 8 }}>
                Full reported statements captured: {Object.keys(picked.statements.annual).length} annual line items
                ({(picked.statements.annual.TotalRevenue || []).length} yrs)
                {Object.keys(picked.statements.quarterly).length ? `, ${Object.keys(picked.statements.quarterly).length} quarterly` : ''}
                — powers the 3-Statement “Past” view after Apply.
              </div>
            )}
            {picked.mapped.history.length > 1 && (
              <div className="bulk-sec">
                <h4>Reported history ({picked.mapped.currency} {picked.mapped.unit})</h4>
                <div className="tablewrap">
                  <table className="fin">
                    <thead>
                      <tr><th></th>{picked.mapped.history.map((h) => <th key={h.date}>{h.date.slice(0, 4)}</th>)}</tr>
                    </thead>
                    <tbody>
                      <tr><td>Revenue</td>{picked.mapped.history.map((h) => <td key={h.date}>{fmtH(h.revenue)}</td>)}</tr>
                      <tr><td>EBITDA</td>{picked.mapped.history.map((h) => <td key={h.date}>{fmtH(h.ebitda)}</td>)}</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div className="bulk-foot">
          {picked && !symbol && <button className="btn" onClick={() => setPicked(null)}>Back to results</button>}
          <span className="berr">{busy && picked ? busy : ''}</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {picked && (
            <button className="btn primary" onClick={() => onApply(picked.mapped.patch)}>
              Apply to model
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
