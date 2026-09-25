import React, { useEffect, useState } from 'react';
import { NumBox } from '../wizard/Field.jsx';
import { fetchLiveRates, validRate } from '../lib/fx.js';

/**
 * Live FX for a Yahoo pull: fetches a spot rate for every foreign currency
 * the listing(s) need, and lets the user confirm or overwrite each one. A
 * failed fetch (or a currency Yahoo can't quote) leaves the field empty — the
 * user must type the rate before anything converts. Nothing is ever assumed.
 *
 * rates = { [ccy]: { rate, source: 'live' | 'typed' | 'failed', at, pair, error } }
 */
export function useLiveRates(currencies, to) {
  const key = [...new Set(currencies || [])].sort().join(',');
  const [rates, setRates] = useState({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (!list.length) { setRates({}); return undefined; }
    let alive = true;
    setLoading(true);
    fetchLiveRates(list, to).then((r) => {
      if (!alive) return;
      setRates(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [key, to]);
  const setRate = (ccy, v) => setRates((r) => ({ ...r, [ccy]: { ...(r[ccy] || {}), rate: v, source: 'typed', at: new Date().toISOString(), error: null } }));
  const ready = !loading && (key ? key.split(',') : []).every((c) => validRate(rates[c]));
  return { rates, setRate, loading, ready };
}

/** Plain { ccy: rate } map for the mapping functions (only valid rates). */
export const rateNumbers = (rates) =>
  Object.fromEntries(Object.entries(rates || {}).filter(([, r]) => validRate(r)).map(([c, r]) => [c, { rate: Number(r.rate), source: r.source, at: r.at }]));

/** One editable rate per foreign currency, tagged live / typed / needed. */
export function FxRateFields({ currencies, to, rates, setRate, loading }) {
  if (!currencies?.length) return null;
  return (
    <div className="fx-rates">
      {currencies.map((c) => {
        const r = rates[c] || {};
        const ok = validRate(r);
        return (
          <div className={`fx-rate${ok ? '' : ' bad'}`} key={c}>
            <span className="fx-l">1 {c} =</span>
            <NumBox small value={ok ? Number(r.rate) : null} suffix={to} onChange={(v) => setRate(c, v)} />
            <span className={`fx-tag ${r.source || ''}`}>
              {loading && !r.source ? 'fetching…'
                : r.source === 'live' ? `live · ${new Date(r.at).toLocaleString()}`
                  : r.source === 'typed' ? 'typed'
                    : 'type the rate'}
            </span>
            {r.source === 'failed' && <span className="fld-e">Live rate unavailable ({r.error}) — type it.</span>}
          </div>
        );
      })}
    </div>
  );
}
