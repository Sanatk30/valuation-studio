import React, { useMemo, useState } from 'react';
import {
  searchSymbols, fetchListing, fetchListingByQuery, fetchListingsBatch, templateFromListing, requiredCurrencies,
} from '../lib/yahoo.js';
import { blankPage, mergeFetchedPage } from '../lib/engine/companyPage.js';
import { useLiveRates, rateNumbers, FxRateFields } from './FxRates.jsx';
import PeerFinder from './PeerFinder.jsx';
import { YF_HINT } from '../lib/yfBase.js';

/**
 * Yahoo fills for the template pages (comps target and peers, precedent
 * company and deal targets).
 *
 * A fetch is `m = { raw, rates }`: the parsed listing plus the FX rate(s) the
 * user confirmed (live, editable; a failed live fetch must be typed). The page
 * gets REPORTED figures only, converted into the valuation currency and unit
 * (lib/yahoo.js templateFromListing).
 */

/**
 * Fold a Yahoo fetch into a slot { name, ticker, sector, price, shares, page }.
 * Each fiscal year Yahoo reports is taken as a whole (its balancing "other"
 * lines only tie to Yahoo's EBITDA, pre-tax income and totals with the other
 * fetched lines beside them); the user's own entries are kept everywhere the
 * fetch has nothing — the years it does not report, the YTD columns, include
 * flag, tier, … A slot last filled from a DIFFERENT listing starts from a
 * blank page, so no figure of the old company stays behind.
 *   opts.n       fiscal years on the page
 *   opts.before  deal pages: only fiscal years ending before this ISO date
 *   opts.labels  true → the page takes the fetched period labels (precedent pages)
 *   opts.market  false → leave price / shares alone (deal targets are priced by the deal)
 */
export function mergeFetch(slot, m, company, { n, before = null, labels = false, market = true } = {}) {
  const f = templateFromListing(m.raw, company, m.rates || {}, { n, before });
  const was = String(slot._fetched?.symbol || '').toUpperCase();
  const other = was && String(f.ticker || '').toUpperCase() !== was;
  const own = other ? blankPage() : (slot.page || { lines: {} });
  const covered = f.fyDates.length;
  const reported = Array.from({ length: n }, (_, i) => i >= n - covered);
  const page = mergeFetchedPage(own, f.page, n, reported);
  if (labels) page.labels = { ...(own.labels || {}), fy: f.page.labels.fy };
  const keep = (v, mine) => (v === null || v === undefined || v === '' ? mine ?? null : v);
  const prev = other ? {} : slot;   // the old listing's sector / price / shares do not carry over
  return {
    ...slot,
    name: f.name || slot.name,
    ticker: f.ticker || slot.ticker,
    sector: keep(f.sector, prev.sector) || '',
    ...(market ? { price: keep(f.price, prev.price), shares: keep(f.shares, prev.shares) } : {}),
    page,
    _fetched: { ...f.fetched, warnings: f.warnings, fyDates: f.fyDates },
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
        {raws.length === 1 ? `${raws[0].name} reports` : 'These companies report'} in {need.join(', ')} — confirm the rate{need.length > 1 ? 's' : ''} into {company.currency}:
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
 * Refresh button: re-fetches `query` (a ticker) and hands the fetch to
 * `onFilled` (after a rate confirmation when the company reports in another
 * currency).
 */
export function RowFetch({ query, company, onFilled, title = 'Fill this page from Yahoo Finance' }) {
  const [state, setState] = useState('idle'); // idle | busy | err
  const [raw, setRaw] = useState(null);
  const [msg, setMsg] = useState('');
  const go = async () => {
    if (!query || state === 'busy') return;
    setState('busy'); setMsg('');
    try {
      const r = await fetchListingByQuery(query);
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
        title={state === 'err' ? `Fetch failed — ${msg}` : title}
        onClick={go} disabled={state === 'busy' || !query}
      >
        {state === 'busy' ? '…' : state === 'err' ? '!' : '⟳'}
      </button>
      {raw && (
        <div className="peer-pop">
          <RateConfirm raws={[raw]} company={company} action="Fill"
            onConfirm={(rates) => { onFilled({ raw, rates }); setRaw(null); }}
            onCancel={() => setRaw(null)} />
        </div>
      )}
    </span>
  );
}

/**
 * Batch builder for the peer slots: paste tickers (comma / space separated)
 * and fetch every peer in one go, or open the peer finder (ranked, explained
 * candidates) and fetch the ticked ones. Foreign-currency peers need one
 * confirmed rate per currency before they are added.
 * `finder` = { inputs, seed } — the target's figures and default seed.
 */
export function PeerBatchAdd({ company, existingNames = [], onAddMany, finder = {} }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); // '' | fetch
  const [finding, setFinding] = useState(false);
  const [toks, setToks] = useState(null); // [{ q, state: ok|err|dup, detail }]
  const [pending, setPending] = useState(null); // raws awaiting rate confirmation
  const [err, setErr] = useState('');

  const fetchAll = async (list) => {
    const queries = list || parseTickerList(text);
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
      setErr(`Batch fetch failed (${e?.message || 'error'}) — ${YF_HINT}.`);
    } finally {
      setBusy('');
    }
  };
  const add = (raws, rates) => {
    onAddMany(raws.map((raw) => ({ raw, rates })));
    setText(''); setPending(null);
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
        <button className="btn" onClick={() => fetchAll()} disabled={!!busy || !parseTickerList(text).length}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch all'}
        </button>
        <button className="btn ghost" onClick={() => setFinding((f) => !f)} disabled={!!busy}
          title="Rank candidate peers on industry, market, size, margin and growth, then tick which to fetch">
          Find peers
        </button>
      </div>
      {finding && (
        <PeerFinder
          company={company} inputs={finder.inputs} defaultSeed={finder.seed || ''} exclude={existingNames}
          onClose={() => setFinding(false)}
          onFetch={(symbols) => { setFinding(false); fetchAll(symbols); }}
        />
      )}
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
        <RateConfirm raws={pending} company={company} action={`Add ${pending.length} compan${pending.length > 1 ? 'ies' : 'y'}`}
          onConfirm={(rates) => add(pending, rates)} onCancel={() => setPending(null)} />
      )}
    </div>
  );
}

/**
 * Search box: type a company name or ticker, pick the listing, confirm the
 * rate if it reports in another currency, and `onPick(m)` receives the fetch.
 */
export function YahooSearch({ company, onPick, placeholder = 'Name or ticker (RELIANCE.NS, AAPL…)', action = 'Fill' }) {
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
      setErr(`Yahoo search failed (${e.message}) — ${YF_HINT}.`);
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
      else { onPick({ raw: listing, rates: {} }); setQ(''); }
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
        <RateConfirm raws={[raw]} company={company} action={action}
          onConfirm={(rates) => { onPick({ raw, rates }); setRaw(null); setQ(''); }}
          onCancel={() => setRaw(null)} />
      )}
    </div>
  );
}
