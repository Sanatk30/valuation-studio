import React, { useState } from 'react';
import { searchSymbols, fetchPeerMetrics, fetchPeerByQuery, fetchPeersBatch, suggestPeers, UNIT_FACTOR } from '../lib/yahoo.js';
import { blankCompany } from '../lib/engine/compsCo.js';
import { FX } from '../lib/format.js';

/**
 * Fold a Yahoo peer fetch into a comps input page.
 *
 * Yahoo's peer feed carries revenue, EBITDA, D&A, capex, net income, diluted
 * shares, debt, cash, equity and the tax rate — enough for the income
 * statement down to EBIT, the estimates and the EV bridge. It does NOT carry a
 * COGS/SG&A split, a full balance sheet or cash from operations, so those are
 * left for the user rather than plugged: the page's issue badge lists exactly
 * what is still missing and which outputs read NA until it is filled.
 *
 * `settings` supplies the display currency and unit the model works in.
 */
export function mergePeerRow(row, m, settings) {
  const base = row && row.is ? row : blankCompany({ ...row, id: row?.id });
  const r = m.raw;
  if (!r) return { ...base, name: m.name || base.name, symbol: m.symbol || base.symbol };

  const fxFrom = FX[r.currency], fxTo = FX[settings?.currency || 'INR'];
  const fx = isFinite(fxFrom) && isFinite(fxTo) ? fxTo / fxFrom : 1;
  const u = UNIT_FACTOR[settings?.unit || 'Cr'] || 1;
  const money = (v) => (isFinite(v) ? (v * fx) / u : 0);   // into display currency + unit
  const cnt = (v) => (isFinite(v) ? v / u : 0);            // share counts: unit scale only
  const px = isFinite(r.price) ? r.price * fx : base.price;

  const t = isFinite(r.taxRate) ? r.taxRate : 0.25;
  const sales = r.sales.map(money);
  const ebitda = r.ebitda.map(money);
  const da = r.da.map(money);
  const ni = r.netIncome.map(money);
  const shares = r.shares.map(cnt);
  // interest is backed out of the reported tax rate: pre-tax = NI / (1 − t)
  const ebit = ebitda.map((e, i) => e - da[i]);
  const pretax = ni.map((v) => (t < 1 ? v / (1 - t) : v));
  const interest = ebit.map((e, i) => e - pretax[i]);
  const taxes = pretax.map((v, i) => v - ni[i]);
  const five = (a3) => [...a3, 0, 0];                      // no stub data from Yahoo

  const g = sales[1] > 0 ? sales[2] / sales[1] : 1;
  const est3 = (v) => [v * g, v * g ** 2, v * g ** 3].map((x) => +x.toFixed(4));
  const ltmShares = shares[2] || 1;

  return {
    ...base,
    name: m.name || base.name,
    symbol: m.symbol || base.symbol,
    ticker: m.symbol || base.ticker,
    exchange: m.exchange || base.exchange,
    price: px,
    taxRate: +(t * 100).toFixed(2),
    fyEnd: r.fyEnd || base.fyEnd,
    stubEnd: r.fyEnd || base.stubEnd,
    basicShares: shares[2],
    // Yahoo gives no COGS/SG&A split: all operating cost sits in COGS so EBIT
    // still ties, and gross profit reports NA.
    grossKnown: false,
    is: {
      ...base.is,
      sales: five(sales),
      cogs: five(sales.map((s, i) => s - ebitda[i] + da[i])),
      sga: five([0, 0, 0]),
      otherExp: five([0, 0, 0]),
      interest: five(interest),
      taxes: five(taxes),
      nci: five([0, 0, 0]),
      prefDiv: five([0, 0, 0]),
      dilutedShares: five(shares),
    },
    cf: { ...base.cf, cfo: five([0, 0, 0]), capex: five(r.capex.map(money)), da: five(da) },
    bs: {
      ...base.bs,
      cash: [money(r.cashPrior), money(r.cash)],
      prepaid: [money(r.workingCapitalPrior), money(r.workingCapital)],
      debt: [money(r.debtPrior), money(r.debt)],
      equity: [money(r.equityPrior), money(r.equity)],
    },
    est: {
      sales: est3(sales[2]),
      ebitda: est3(ebitda[2]),
      ebit: est3(ebit[2]),
      eps: est3(ni[2] / ltmShares),
      fcfPerShare: est3(0),
    },
    _fetched: { at: Date.now(), currency: r.currency, note: 'COGS/SG&A split, full balance sheet and CFO are not in the Yahoo feed' },
  };
}

const BLANK_ROW = { name: '' };

/** "RELIANCE.NS, TCS.NS INFY.NS" → ['RELIANCE.NS','TCS.NS','INFY.NS'], deduped case-insensitively. */
export function parseTickerList(text) {
  const seen = new Set();
  return text.split(/[,\s;]+/).map((t) => t.trim()).filter((t) => {
    if (!t || seen.has(t.toUpperCase())) return false;
    seen.add(t.toUpperCase());
    return true;
  });
}

/**
 * Per-row fetch: looks the row's name/ticker up on Yahoo and fills its
 * multiples. Shows a spinner glyph while busy, an error mark on failure.
 */
export function PeerRowFetch({ name, onFilled }) {
  const [state, setState] = useState('idle'); // idle | busy | err
  const go = async () => {
    if (!name || state === 'busy') return;
    setState('busy');
    try {
      const m = await fetchPeerByQuery(name);
      onFilled(m);
      setState('idle');
    } catch {
      setState('err');
      setTimeout(() => setState('idle'), 2200);
    }
  };
  return (
    <button
      className={`peer-fetch${state === 'err' ? ' err' : ''}`}
      title={state === 'err' ? 'Fetch failed — check the name/ticker (needs the dev server for the Yahoo proxy)' : 'Fetch multiples from Yahoo Finance by this name/ticker'}
      onClick={go}
      disabled={state === 'busy'}
    >
      {state === 'busy' ? '…' : state === 'err' ? '!' : '⟳'}
    </button>
  );
}

/**
 * Batch builder: paste 4–5 tickers (comma/space separated) and fetch every
 * peer's multiples in one click, or let Yahoo suggest similar names for the
 * current company first. Per-ticker chips show what landed and what failed;
 * successes are handed to onAddMany as ready-to-use peer rows.
 */
export function PeerBatchAdd({ companyName, existingNames = [], onAddMany, settings }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); // '' | fetch | suggest
  const [toks, setToks] = useState(null); // [{ q, state: ok|err|dup, detail }]
  const [err, setErr] = useState('');

  const taken = new Set(existingNames.map((n) => String(n).toUpperCase()));

  const fetchAll = async () => {
    const queries = parseTickerList(text);
    if (!queries.length || busy) return;
    setBusy('fetch'); setErr(''); setToks(queries.map((q) => ({ q, state: 'busy' })));
    try {
      const results = await fetchPeersBatch(queries);
      const rows = [];
      setToks(results.map((r) => {
        if (!r.ok) return { q: r.q, state: 'err', detail: r.error };
        if (taken.has(r.m.name.toUpperCase()) || taken.has((r.m.symbol || '').toUpperCase())) {
          return { q: r.q, state: 'dup', detail: `${r.m.name} is already in the set` };
        }
        taken.add(r.m.name.toUpperCase());
        if (r.m.symbol) taken.add(r.m.symbol.toUpperCase());
        rows.push(mergePeerRow({ ...BLANK_ROW }, r.m, settings));
        return { q: r.q, state: 'ok', detail: `${r.m.name} · ${r.m.symbol}` };
      }));
      if (rows.length) {
        onAddMany(rows);
        setText('');
      }
    } catch {
      setErr('Batch fetch failed — the Yahoo proxy needs the dev server (npm run dev).');
    } finally {
      setBusy('');
    }
  };

  const suggest = async () => {
    if (!companyName || busy) return;
    setBusy('suggest'); setErr(''); setToks(null);
    try {
      const { suggestions } = await suggestPeers(companyName);
      const fresh = suggestions.filter((s) => !taken.has(s.toUpperCase()));
      if (!fresh.length) { setErr('Every suggested peer is already in the set.'); return; }
      setText(parseTickerList(`${text} ${fresh.join(' ')}`).join(', '));
    } catch (e) {
      setErr(e?.message || 'No suggestions — try fetching the company first so the name matches a listing.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="peer-yf">
      <div className="yf-search" style={{ marginTop: 0 }}>
        <input
          value={text}
          placeholder="Build peer set — tickers separated by commas (TCS.NS, INFY.NS, WIPRO.NS…)"
          onChange={(e) => { setText(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fetchAll(); } }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={fetchAll} disabled={!!busy || !parseTickerList(text).length}>
          {busy === 'fetch' ? 'Fetching…' : 'Fetch all multiples'}
        </button>
        <button
          className="btn" style={{ flex: 1 }} onClick={suggest} disabled={!!busy || !companyName}
          title={`Ask Yahoo for companies similar to ${companyName || 'the target'} and drop them into the list — prune before fetching`}
        >
          {busy === 'suggest' ? 'Suggesting…' : 'Suggest peers'}
        </button>
      </div>
      {err && <div className="berr" style={{ marginTop: 6 }}>{err}</div>}
      {toks && (
        <div className="yf-toks">
          {toks.map((t) => (
            <span key={t.q} className={`yf-tok ${t.state}`} title={t.detail || t.q}>
              {t.state === 'busy' ? '…' : t.state === 'ok' ? '✓' : t.state === 'dup' ? '=' : '!'} {t.q}
            </span>
          ))}
        </div>
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        Suggestions are Yahoo's co-watched names, not an industry screen — prune the list before fetching.
        Failed tickers stay in the chips; hover one for the reason.
      </div>
    </div>
  );
}

/**
 * Search box: type a company name or ticker, pick the listing, and a fully
 * populated peer row (EV/S, EV/EBITDA, P/E, growth) is handed to onAdd.
 */
export function PeerSearchAdd({ onAdd, placeholder = 'Add peer from Yahoo — name or ticker (RELIANCE.NS, AAPL…)' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState('');
  const [err, setErr] = useState('');

  const search = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr(''); setResults(null);
    try {
      const r = await searchSymbols(q.trim());
      if (!r.length) setErr('No listed companies found — try the exact ticker.');
      else setResults(r.slice(0, 6));
    } catch {
      setErr('Yahoo search failed — the proxy needs the dev server (npm run dev).');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (sym) => {
    setPicking(sym); setErr('');
    try {
      const m = await fetchPeerMetrics(sym);
      onAdd(m);
      setQ(''); setResults(null);
    } catch {
      setErr(`Could not compute multiples for ${sym} — fundamentals missing.`);
    } finally {
      setPicking('');
    }
  };

  return (
    <div className="peer-yf">
      <div className="yf-search" style={{ marginTop: 0 }}>
        <input
          value={q}
          placeholder={placeholder}
          onChange={(e) => { setQ(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        />
        <button className="btn" onClick={search} disabled={busy}>{busy ? '…' : 'Search'}</button>
      </div>
      {err && <div className="berr" style={{ marginTop: 6 }}>{err}</div>}
      {results && (
        <div className="yf-results">
          {results.map((r) => (
            <button key={r.symbol} onClick={() => pick(r.symbol)} disabled={!!picking}>
              {picking === r.symbol ? 'Computing multiples…' : r.name}
              <span>{r.symbol} · {r.exchange}</span>
            </button>
          ))}
        </div>
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        Multiples from live price × latest annual financials; growth = revenue CAGR (edit to your forward view).
        Prefer the local listing — ADR prices can mismatch the reporting currency.
      </div>
    </div>
  );
}
