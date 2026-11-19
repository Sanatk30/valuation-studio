import React, { useMemo, useState } from 'react';
import { searchSymbols, fetchListing, mapListing, requiredCurrencies, yahooBusy } from '../lib/yahoo.js';
import { useLiveRates, rateNumbers, FxRateFields } from './FxRates.jsx';
import { fmtNum, fmtPct, CURRENCIES, UNITS } from '../lib/format.js';
import { YF_HINT } from '../lib/yfBase.js';

/** Where each mapped field lands, in words (for the "stays NA" list). */
const FIELD_LABEL = {
  'company.sharesOut': 'Shares outstanding',
  'company.currentPrice': 'Current share price',
  'company.grossDebt': 'Gross debt',
  'company.cash': 'Cash & equivalents',
  'company.taxRate': 'Tax rate',
  'drivers.revenue0': 'LTM revenue',
  'drivers.ebitda0': 'LTM EBITDA',
  'drivers.nwc0': 'Opening net working capital',
  'ts.startingPPE': 'Opening net PP&E',
  'ts.equity0': "Opening shareholders' equity",
  'compsTarget.revenue': 'Comps target LTM revenue',
  'compsTarget.ebitda': 'Comps target LTM EBITDA',
  'compsTarget.ebit': 'Comps target LTM EBIT',
  'compsTarget.netIncome': 'Comps target LTM net income',
  'compsTarget.priorRevenue': 'Prior fiscal-year revenue',
  'compsTarget.priorEbitda': 'Prior fiscal-year EBITDA',
  'compsTarget.grossProfit': 'LTM gross profit',
  'compsTarget.interest': 'LTM interest expense',
  'compsTarget.equity': "Shareholders' equity",
  'compsTarget.high52': '52-week high',
  'compsTarget.low52': '52-week low',
  'precedentTarget.revenue': 'Precedent target LTM revenue',
  'precedentTarget.ebitda': 'Precedent target LTM EBITDA',
};

/**
 * Listed-company search for the Company step.
 * Search box → listings → preview (reported value → value into the model,
 * with the live FX rate(s), editable) → Apply. Nothing changes until Apply;
 * Apply stays disabled until every needed rate (and the share basis, when
 * Yahoo reports two share counts) is settled.
 */
export default function ListingSearch({ company, onApply }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState(null);

  const search = async () => {
    if (!q.trim() || busy) return;
    setBusy('search'); setErr(''); setResults(null);
    try {
      const r = await searchSymbols(q.trim());
      if (!r.length) setErr('No listed company found — try the exact ticker (e.g. RELIANCE.NS, AAPL).');
      else setResults(r.slice(0, 8));
    } catch (e) {
      // the relay / proxy hint only when it can be the cause — not when Yahoo refused the query itself (e.g. 400)
      setErr(yahooBusy(e) ? `Yahoo search failed (${e.message}). ${YF_HINT[0].toUpperCase() + YF_HINT.slice(1)}.` : `Yahoo could not search for that (${e.message}). Try a company name or ticker in Latin letters.`);
    } finally {
      setBusy('');
    }
  };

  const pick = async (r) => {
    setBusy(r.symbol); setErr('');
    try {
      setRaw(await fetchListing(r.symbol, { search: r }));
      setResults(null);
    } catch (e) {
      setErr(`Could not load ${r.symbol}: ${e.message}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="ls">
      <div className="yf-search" style={{ marginTop: 0 }}>
        <input
          value={q} placeholder="Company name or ticker — RELIANCE.NS, AAPL, VOD.L…"
          onChange={(e) => { setQ(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        />
        <button className="btn" onClick={search} disabled={!!busy || !q.trim()}>{busy === 'search' ? '…' : 'Search'}</button>
      </div>
      {err && <div className="fld-e" style={{ marginTop: 6 }}>{err}</div>}
      {results && (
        <div className="yf-results">
          {results.map((r) => (
            <button key={r.symbol} onClick={() => pick(r)} disabled={!!busy}>
              {busy === r.symbol ? 'Loading reported figures…' : r.name}
              <span>{r.symbol} · {r.exchange}</span>
            </button>
          ))}
        </div>
      )}
      {raw && (
        <ListingPreview
          raw={raw} company={company}
          onCancel={() => setRaw(null)}
          onApply={(mapped) => { onApply(mapped); setRaw(null); setQ(''); }}
        />
      )}
    </div>
  );
}

function ListingPreview({ raw, company, onCancel, onApply }) {
  const need = useMemo(() => requiredCurrencies(raw, company.currency), [raw, company.currency]);
  const fx = useLiveRates(need, company.currency);
  const [shareBasis, setShareBasis] = useState(null);
  const mapped = useMemo(
    () => mapListing(raw, company, rateNumbers(fx.rates), { shareBasis: shareBasis || undefined }),
    [raw, company, fx.rates, shareBasis],
  );
  const ready = fx.ready && mapped.ready;
  const locale = CURRENCIES[company.currency]?.locale;
  const unit = UNITS[company.unit];

  const fmtReported = (r) => {
    if (r.reported === null || r.reported === undefined) return <span className="na">NA</span>;
    if (r.reportedKind === 'text') return r.reported;
    if (r.reportedKind === 'pct') return fmtPct(r.reported, 1);
    if (r.reportedKind === 'shares') return fmtNum(r.reported, 0, 'en-US');
    if (r.reportedKind === 'pershare') return `${fmtNum(r.reported, 2, 'en-US')} ${r.reportedCcy || ''}`;
    return `${fmtNum(r.reported, 0, 'en-US')} ${r.reportedCcy || ''}`;
  };
  const fmtValue = (r) => {
    if (r.value === null || r.value === undefined) return <span className="na">NA</span>;
    if (r.kind === 'text') return r.value;
    if (r.kind === 'pct') return fmtPct(r.value, 1);
    if (r.kind === 'shares') return `${fmtNum(r.value, 4, locale)} ${unit}`;
    if (r.kind === 'pershare') return `${fmtNum(r.value, 2, locale)} ${company.currency}`;
    return `${fmtNum(r.value, 2, locale)} ${company.currency} ${unit}`;
  };
  const groups = [...new Set(mapped.preview.map((r) => r.group))];
  const L = mapped.listing;

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bulk-modal ls-modal">
        <div className="bulk-head">
          <h2>{raw.name} <span className="h-tag">{raw.symbol}</span></h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        </div>
        <div className="fld-h">
          {raw.exchange} · LTM: <b>{L.ltmLabel || 'not reported'}</b> · balance sheet {L.bsDate ? `as of ${L.bsDate}` : 'not reported'} ·
          financials in {raw.financialCurrency || 'unknown currency'}, price in {raw.price?.currency || 'unknown currency'}.
          Values below are what lands in the model, in {company.currency} {unit}. Reported facts only — nothing estimated.
        </div>

        {need.length > 0 && (
          <section className="set-sec">
            <h3>Exchange rate{need.length > 1 ? 's' : ''} into {company.currency}</h3>
            <FxRateFields currencies={need} to={company.currency} {...fx} />
            <div className="fld-h">One spot rate per currency for the P&amp;L, balance sheet and price. Edit it to use your own rate.</div>
          </section>
        )}

        {mapped.needs.shareBasis && (
          <section className="set-sec">
            <h3>Which share count?</h3>
            <div className="seg fld-seg">
              {L.shareOptions.map((o) => (
                <button key={o.id} className={shareBasis === o.id ? 'on' : ''} onClick={() => setShareBasis(o.id)}>{o.label}</button>
              ))}
            </div>
            <div className="fld-h">Yahoo reports both; choose the one to use as shares outstanding.</div>
          </section>
        )}
        {!mapped.needs.shareBasis && L.shareOptions?.length > 1 && (
          <div className="fld-h">
            Share count: {L.shareOptions.find((o) => o.id === L.shareBasis)?.label}.{' '}
            <button className="btn ghost sm" onClick={() => setShareBasis(null)}>Change</button>
          </div>
        )}

        {mapped.warnings.length > 0 && (
          <ul className="cp-issues">{mapped.warnings.map((w) => <li key={w} className="warn">{w}</li>)}</ul>
        )}

        <div className="tablewrap">
          <table className="fin compact ls-table">
            <thead><tr><th>Line</th><th>Basis</th><th>Reported</th><th>Into the model</th><th>Note</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g}>
                  <tr className="grp"><td colSpan={5}>{g}</td></tr>
                  {mapped.preview.filter((r) => r.group === g).map((r, i) => (
                    <tr key={`${g}${i}`} className={`${r.sub ? 'sub' : ''}${r.ref ? ' ref' : ''}`}>
                      <td>{r.label}</td>
                      <td className="muted">{r.basis}</td>
                      <td>{fmtReported(r)}</td>
                      <td>{fmtValue(r)}</td>
                      <td className="muted">{r.note}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {mapped.missing.length > 0 && (
          <div className="fld-h" style={{ marginTop: 8 }}>
            <b>Stays blank (NA) after Apply</b> — not reported by Yahoo: {mapped.missing.map((f) => FIELD_LABEL[f] || f).join(', ')}. Type these yourself.
          </div>
        )}

        <div className="step-foot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <div className="spacer" />
          {!ready && <span className="fld-h">{!fx.ready ? 'Confirm the exchange rate first.' : 'Choose the share count first.'}</span>}
          <button className="btn primary" disabled={!ready} onClick={() => onApply(mapped)}>Apply to this method</button>
        </div>
      </div>
    </div>
  );
}
