import React, { useMemo, useState } from 'react';
import {
  searchSymbols, fetchListing, fetchListingByQuery, fetchListingsBatch, suggestPeers,
  peerPageFromListing, requiredCurrencies,
} from '../lib/yahoo.js';
import { blankCompany } from '../lib/engine/compsCo.js';
import { useLiveRates, rateNumbers, FxRateFields } from './FxRates.jsx';

/**
 * Yahoo peers for the comps Peer step.
 *
 * A fetch is `m = { raw, rates }`: the parsed listing plus the FX rate(s) the
 * user confirmed (live, editable; a failed live fetch must be typed). The peer
 * page holds REPORTED lines only, converted into the valuation currency and
 * unit (lib/yahoo.js peerPageFromListing) — nothing estimated, no fallbacks.
 */

/**
 * Fold a Yahoo fetch into a peer page. The fetched reported lines win; the
 * user's own inputs are kept where the feed has nothing: the page id, tier,
 * ratings, description, beta, dividend, the non-recurring adjustments,
 * options / converts, and any cell the fetch leaves blank (e.g. balance-sheet
 * lines Yahoo has no one-to-one line for).
 */
export function mergePeerRow(row, m, company) {
  const base = row && row.is ? row : blankCompany({ ...(row || {}) });
  const f = peerPageFromListing(m.raw, company, m.rates || {});
  const cell = (fetched, own) => (fetched === null || fetched === undefined ? own ?? null : fetched);
  const group = (fg, own) => Object.fromEntries(Object.entries(fg).map(([k, arr]) => [k, arr.map((v, i) => cell(v, own?.[k]?.[i]))]));
  return {
    ...base,
    name: f.name || base.name,
    symbol: f.symbol,
    ticker: f.ticker,
    exchange: f.exchange || base.exchange,
    price: cell(f.price, base.price),
    high52: cell(f.high52, base.high52),
    low52: cell(f.low52, base.low52),
    taxRate: cell(f.taxRate, base.taxRate),
    fyEnd: f.fyEnd || base.fyEnd,
    stubEnd: f.stubEnd || base.stubEnd,
    basicShares: cell(f.basicShares, base.basicShares),
    grossKnown: f.grossKnown,
    is: group(f.is, base.is),
    cf: group(f.cf, base.cf),
    bs: group(f.bs, base.bs),
    _fetched: f._fetched,
  };
}

/** "RELIANCE.NS, TCS.NS INFY.NS" → ['RELIANCE.NS','TCS.NS','INFY.NS'], deduped case-insensitively. */
export function parseTickerList(text) {
  const seen = new Set();
  return text.split(/[,\s;]+/).map((t) => t.trim()).filter((t) => {
    if (!t || seen.has(t.toUpperCase())) return false;
    seen.add(t.toUpperCase());
    return true;
  });
}

/** Rate confirmation for one or more fetched listings: resolves to m's. */
function RateConfirm({ raws, company, onConfirm, onCancel, action }) {
  const need = useMemo(() => [...new Set(raws.flatMap((r) => requiredCurrencies(r, company.currency)))], [raws, company.currency]);
  const fx = useLiveRates(need, company.currency);
  return (
    <div className="rate-confirm">
      <div className="fld-h">
        {raws.length === 1 ? `${raws[0].name} reports` : 'These peers report'} in {need.join(', ')} — confirm the rate{need.length > 1 ? 's' : ''} into {company.currency}:
      </div>
      <FxRateFields currencies={need} to={company.currency} {...fx} />
      <div className="row-btns">
        <button className="btn sm primary" disabled={!fx.ready} onClick={() => onConfirm(rateNumbers(fx.rates))}>{action}</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Per-row refresh: re-fetches the row's ticker and folds the reported lines
 * back in (after a rate confirmation when the peer reports in another currency).
 */
export function PeerRowFetch({ name, company, onFilled }) {
  const [state, setState] = useState('idle'); // idle | busy | err
  const [raw, setRaw] = useState(null);
  const [msg, setMsg] = useState('');
  const go = async () => {
    if (!name || state === 'busy') return;
    setState('busy'); setMsg('');
    try {
      const r = await fetchListingByQuery(name);
      if (requiredCurrencies(r, company.currency).length) { setRaw(r); setState('idle'); return; }
      onFilled({ raw: r, rates: {} });
      setState('idle');
    } catch (e) {
      setState('err'); setMsg(e?.message || 'fetch failed');
      setTimeout(() => setState('idle'), 3000);
    }
  };
  return (
    <span className="peer-fetch-wrap">
      <button
        className={`peer-fetch${state === 'err' ? ' err' : ''}`}
        title={state === 'err' ? `Fetch failed — ${msg}` : 'Refresh this peer’s reported figures from Yahoo Finance'}
        onClick={go} disabled={state === 'busy'}
      >
        {state === 'busy' ? '…' : state === 'err' ? '!' : '⟳'}
      </button>
      {raw && (
        <div className="peer-pop">
          <RateConfirm raws={[raw]} company={company} action="Refresh"
            onConfirm={(rates) => { onFilled({ raw, rates }); setRaw(null); }}
            onCancel={() => setRaw(null)} />
        </div>
      )}
    </span>
  );
}

/**
 * Batch builder: paste tickers (comma / space separated) and fetch every peer
 * in one go, or let Yahoo suggest co-watched names first. Per-ticker chips show
 * what landed and what failed; foreign-currency peers need one confirmed rate
 * per currency before they are added.
 */
export function PeerBatchAdd({ company, existingNames = [], onAddMany }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); // '' | fetch | suggest
  const [toks, setToks] = useState(null); // [{ q, state: ok|err|dup, detail }]
  const [pending, setPending] = useState(null); // raws awaiting rate confirmation
  const [err, setErr] = useState('');

  const fetchAll = async () => {
    const queries = parseTickerList(text);
    if (!queries.length || busy) return;
    const taken = new Set(existingNames.map((n) => String(n).toUpperCase()));
    setBusy('fetch'); setErr(''); setPending(null); setToks(queries.map((q) => ({ q, state: 'busy' })));
    try {
      const results = await fetchListingsBatch(queries);
      const raws = [];
      setToks(results.map((r) => {
        if (!r.ok) return { q: r.q, state: 'err', detail: r.error };
        const nm = String(r.raw.name || '').toUpperCase(), sym = String(r.raw.symbol || '').toUpperCase();
        if (taken.has(nm) || taken.has(sym)) return { q: r.q, state: 'dup', detail: `${r.raw.name} is already in the set` };
        taken.add(nm); taken.add(sym);
        raws.push(r.raw);
        return { q: r.q, state: 'ok', detail: `${r.raw.name} · ${r.raw.symbol}` };
      }));
      if (!raws.length) return;
      if (raws.some((r) => requiredCurrencies(r, company.currency).length)) setPending(raws);
      else add(raws, {});
    } catch (e) {
      setErr(`Batch fetch failed (${e?.message || 'error'}) — the Yahoo proxy needs the dev server (npm run dev).`);
    } finally {
      setBusy('');
    }
  };
  const add = (raws, rates) => {
    onAddMany(raws.map((raw) => mergePeerRow(blankCompany(), { raw, rates }, company)));
    setText(''); setPending(null);
  };

  const suggest = async () => {
    if (!company?.name || busy) return;
    setBusy('suggest'); setErr(''); setToks(null);
    try {
      const { suggestions } = await suggestPeers(company.name);
      const taken = new Set(existingNames.map((n) => String(n).toUpperCase()));
      const fresh = suggestions.filter((s) => !taken.has(s.toUpperCase()));
      if (!fresh.length) { setErr('Every suggested peer is already in the set.'); return; }
      setText(parseTickerList(`${text} ${fresh.join(' ')}`).join(', '));
    } catch (e) {
      setErr(e?.message || 'No suggestions — Yahoo could not match the company name to a listing.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="peer-yf">
      <div className="yf-search" style={{ marginTop: 8 }}>
        <input
          value={text}
          placeholder="Several at once — tickers separated by commas (TCS.NS, INFY.NS, WIPRO.NS…)"
          onChange={(e) => { setText(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAll(); } }}
        />
        <button className="btn" onClick={fetchAll} disabled={!!busy || !parseTickerList(text).length}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch all'}
        </button>
        <button className="btn ghost" onClick={suggest} disabled={!!busy || !company?.name}
          title={`Ask Yahoo for companies co-watched with ${company?.name || 'the target'} — prune before fetching`}>
          {busy === 'suggest' ? 'Suggesting…' : 'Suggest'}
        </button>
      </div>
      {err && <div className="fld-e" style={{ marginTop: 6 }}>{err}</div>}
      {toks && (
        <div className="yf-toks">
          {toks.map((t) => (
            <span key={t.q} className={`yf-tok ${t.state}`} title={t.detail || t.q}>
              {t.state === 'busy' ? '…' : t.state === 'ok' ? '✓' : t.state === 'dup' ? '=' : '!'} {t.q}
            </span>
          ))}
        </div>
      )}
      {pending && (
        <RateConfirm raws={pending} company={company} action={`Add ${pending.length} peer${pending.length > 1 ? 's' : ''}`}
          onConfirm={(rates) => add(pending, rates)} onCancel={() => setPending(null)} />
      )}
      <div className="fld-h" style={{ marginTop: 6 }}>
        Suggestions are Yahoo&rsquo;s co-watched names, not an industry screen — prune the list before fetching.
      </div>
    </div>
  );
}

/**
 * Search box: type a company name or ticker, pick the listing, confirm the
 * rate if it reports in another currency, and `onAdd(m)` receives the fetch.
 */
export function PeerSearchAdd({ company, onAdd, placeholder = 'Add a peer — name or ticker (RELIANCE.NS, AAPL…)' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState('');
  const [raw, setRaw] = useState(null);
  const [err, setErr] = useState('');

  const search = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr(''); setResults(null); setRaw(null);
    try {
      const r = await searchSymbols(q.trim());
      if (!r.length) setErr('No listed companies found — try the exact ticker.');
      else setResults(r.slice(0, 6));
    } catch (e) {
      setErr(`Yahoo search failed (${e.message}) — the proxy needs the dev server (npm run dev).`);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (r) => {
    setPicking(r.symbol); setErr('');
    try {
      const listing = await fetchListing(r.symbol, { search: r });
      setResults(null);
      if (requiredCurrencies(listing, company.currency).length) setRaw(listing);
      else { onAdd({ raw: listing, rates: {} }); setQ(''); }
    } catch (e) {
      setErr(`Could not load ${r.symbol}: ${e.message}`);
    } finally {
      setPicking('');
    }
  };

  return (
    <div className="peer-yf">
      <div className="yf-search" style={{ marginTop: 0 }}>
        <input
          value={q} placeholder={placeholder}
          onChange={(e) => { setQ(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        />
        <button className="btn" onClick={search} disabled={busy || !q.trim()}>{busy ? '…' : 'Search'}</button>
      </div>
      {err && <div className="fld-e" style={{ marginTop: 6 }}>{err}</div>}
      {results && (
        <div className="yf-results">
          {results.map((r) => (
            <button key={r.symbol} onClick={() => pick(r)} disabled={!!picking}>
              {picking === r.symbol ? 'Loading reported figures…' : r.name}
              <span>{r.symbol} · {r.exchange}</span>
            </button>
          ))}
        </div>
      )}
      {raw && (
        <RateConfirm raws={[raw]} company={company} action="Add peer"
          onConfirm={(rates) => { onAdd({ raw, rates }); setRaw(null); setQ(''); }}
          onCancel={() => setRaw(null)} />
      )}
    </div>
  );
}
