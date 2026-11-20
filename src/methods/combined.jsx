import React from 'react';
import FootballField from '../components/FootballField.jsx';
import { NumBox } from '../wizard/Field.jsx';
import { METHOD_META } from './labels.js';
import { fmtPrice, fmtPct } from '../lib/format.js';
import { includeBox, methodMarketPrice } from './figures.js';
import { YahooSearch } from '../components/PeerYahoo.jsx';

/**
 * The Combined template's six rows: DCF (FCFF, or FCFE / DDM), Comparable
 * Companies and Precedent Transactions come from their methods; the LBO
 * (sponsor's ability to pay) and the 52-week trading range are typed in.
 * IPO is not combined: an offer price prices an unlisted company, not a view
 * of a listed company's value.
 */
export const COMBINABLE = ['dcf', 'comps', 'precedent'];
export const MANUAL_ROWS = [
  { id: 'lbo', label: 'LBO (sponsor ability to pay)', figureLabel: 'Price at target IRR', rangeNote: 'typed in — e.g. prices at the low / high IRR' },
  { id: 'range52', label: '52-week trading range', figureLabel: 'Current price', rangeNote: '52-week low → high' },
];
export const rowLabel = (id) => METHOD_META[id]?.label || MANUAL_ROWS.find((m) => m.id === id)?.label || id;
const fin = Number.isFinite;

/**
 * Resolve the Combined inputs against the other methods' CURRENT results.
 * rows = [{ methodId, figure, weight }] for included entries (figure may be null
 * if it no longer exists).
 */
export function combinedRows(data, ctx) {
  const entries = data.combined?.entries || {};
  return COMBINABLE.filter((id) => entries[id]?.include).map((id) => {
    const e = entries[id];
    const complete = ctx.progressOf(id).complete;
    const figs = complete ? ctx.figuresOf(id) : [];
    return { methodId: id, complete, figures: figs, figure: figs.find((x) => x.key === e.figure) || null, weight: e.weight };
  }).concat(MANUAL_ROWS.filter((m) => entries[m.id]?.include).map((m) => {
    const e = entries[m.id];
    const v = e.value;
    const ends = [e.low, e.high].filter(fin);
    const figure = fin(v) && v > 0
      ? { key: 'manual', label: `${m.label} — ${m.figureLabel}`, value: v, low: ends.length ? Math.min(v, ...ends) : v, high: ends.length ? Math.max(v, ...ends) : v, rangeNote: m.rangeNote }
      : null;
    return { methodId: m.id, manual: true, complete: true, figures: [], figure, weight: e.weight, low: e.low, high: e.high };
  }));
}

export function combinedResult(data, ctx) {
  const rows = combinedRows(data, ctx);
  const ok = rows.length > 0 && rows.every((r) => r.figure && fin(r.weight));
  const wsum = rows.reduce((s, r) => s + (fin(r.weight) ? r.weight : 0), 0);
  const value = ok ? rows.reduce((s, r) => s + (r.weight / 100) * r.figure.value, 0) : NaN;
  const px = data.combined?.marketPrice;
  return { rows, ok, wsum, value, marketPrice: px, upside: fin(px) && px > 0 && fin(value) ? (value / px - 1) * 100 : NaN };
}

function CombinedPicker({ data, setData, company, ctx }) {
  const entries = data.combined.entries || {};
  const setEntry = (id, patch) => setData((d) => ({
    ...d, combined: { ...d.combined, entries: { ...d.combined.entries, [id]: { include: false, figure: null, weight: null, ...d.combined.entries?.[id], ...patch } } },
  }));
  const res = combinedResult(data, ctx);

  // market-price suggestions from the included methods' own Company steps
  const prices = COMBINABLE.filter((id) => entries[id]?.include)
    .map((id) => {
      return { id, px: methodMarketPrice(id, ctx.record.methods[id]?.data) };
    })
    .filter((x) => fin(x.px) && x.px > 0);

  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Methods</div>
        <table className="fin comb-pick">
          <thead><tr><th>Method</th><th>Status</th><th>Include</th><th>Figure</th><th>Value / share</th><th>Weight</th></tr></thead>
          <tbody>
            {COMBINABLE.map((id) => {
              const p = ctx.progressOf(id);
              const e = entries[id] || {};
              const figs = p.complete ? ctx.figuresOf(id) : [];
              const fig = figs.find((x) => x.key === e.figure);
              return (
                <tr key={id} className={p.complete ? '' : 'muted'}>
                  <td>{METHOD_META[id].label}</td>
                  <td>{p.complete ? <span className="pill ok">complete</span> : <span className="pill">{p.started ? 'in progress' : 'not started'}</span>}</td>
                  <td>
                    <input type="checkbox" {...includeBox(p, e)}
                      onChange={(ev) => setEntry(id, { include: ev.target.checked })} />
                  </td>
                  <td>
                    {p.complete && e.include ? (
                      <select className="fld-in" value={e.figure || ''} onChange={(ev) => setEntry(id, { figure: ev.target.value || null })}>
                        <option value="">choose…</option>
                        {figs.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    ) : '—'}
                  </td>
                  <td className="calc">{fig ? fmtPrice(fig.value, company) : '—'}</td>
                  <td>{p.complete && e.include ? <NumBox small value={e.weight ?? null} suffix="%" onChange={(v) => setEntry(id, { weight: v })} /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="fld-h">Only completed methods can be included. Results update when you change a method.</div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Typed-in rows <span className="fld-opt">optional — the template's LBO and 52-week rows</span></div>
        <div className="tablewrap">
        <table className="fin comb-pick">
          <thead><tr><th>Row</th><th>Include</th><th>Low</th><th>Value / share</th><th>High</th><th>Weight</th></tr></thead>
          <tbody>
            {MANUAL_ROWS.map((m) => {
              const e = entries[m.id] || {};
              const box = (key, extra = {}) => <NumBox small value={e[key] ?? null} {...extra} onChange={(v) => setEntry(m.id, { [key]: v })} />;
              return (
                <tr key={m.id}>
                  <td>{m.label}<div className="fld-h">{m.figureLabel}</div></td>
                  <td><input type="checkbox" checked={!!e.include} onChange={(ev) => setEntry(m.id, { include: ev.target.checked })} /></td>
                  <td>{e.include ? box('low') : '—'}</td>
                  <td>{e.include ? box('value') : '—'}</td>
                  <td>{e.include ? box('high') : '—'}</td>
                  <td>{e.include ? box('weight', { suffix: '%' }) : '—'}</td>
                </tr>
              );
            })}
            <tr className="bold">
              <td colSpan={5}>Total weight (all rows)</td>
              <td className={Math.abs(res.wsum - 100) < 0.005 ? 'pos' : 'neg'}>{fmtPct(res.wsum, 1)}</td>
            </tr>
          </tbody>
        </table>
        </div>
        {entries.range52?.include && (
          <div style={{ marginTop: 8 }}>
            <div className="fld-h">Fill the 52-week row from Yahoo Finance (low, current price, high):</div>
            <YahooSearch company={company} action="Use its 52-week range"
              onPick={({ raw, rates }) => {
                const cur = raw.price?.currency;
                const r = cur === company.currency ? 1 : Number(typeof rates?.[cur] === 'object' ? rates[cur]?.rate : rates?.[cur]);
                const cv = (v) => (fin(v) && fin(r) && r > 0 ? v * r : null);
                setEntry('range52', { low: cv(raw.price?.low52), value: cv(raw.price?.value), high: cv(raw.price?.high52) });
              }} />
          </div>
        )}
        <div className="fld-h">LBO: the price per share a financial sponsor could pay at its target IRR (e.g. from the LBO output at the low / high IRR). 52-week: the trading range for context. Leave a row unticked to drop it.</div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Market price per share <span className="fld-opt">optional</span></div>
        <div className="fld-box-row">
          <NumBox value={data.combined.marketPrice ?? null} suffix={company.currency} onChange={(v) => setData((d) => ({ ...d, combined: { ...d.combined, marketPrice: v } }))} />
          {prices.map((x) => (
            <button key={x.id} className="btn sm" onClick={() => setData((d) => ({ ...d, combined: { ...d.combined, marketPrice: x.px } }))}>
              Use {METHOD_META[x.id].short}’s {fmtPrice(x.px, company)}
            </button>
          ))}
        </div>
        <div className="fld-h">Shows upside / downside against the combined value. Leave blank to hide it.</div>
      </div>
    </div>
  );
}

export const combinedStep = () => ({
  id: 'pick',
  title: 'Methods & weights',
  blurb: 'Choose which completed methods to combine, which result each contributes, and how much weight it gets.',
  Extra: CombinedPicker,
  fields: () => [],
  startedWhen: (data) => Object.values(data.combined?.entries || {}).some((e) => e?.include),
  validate: (data, ctx) => {
    const d = data.combined || {};
    const res = combinedResult(data, ctx);
    const errs = [];
    if (!res.rows.length) errs.push('Include at least one completed method.');
    for (const r of res.rows) {
      const name = rowLabel(r.methodId);
      const typed = MANUAL_ROWS.find((m) => m.id === r.methodId);
      if (typed) {
        if (!r.figure) errs.push(`Enter the ${typed.figureLabel.toLowerCase()} (above 0) for ${name}.`);
        if (fin(r.low) && fin(r.high) && r.low > r.high) errs.push(`${name}: the low is above the high.`);
      } else if (!r.complete) errs.push(`${name} is no longer complete — finish it or untick it.`);
      else if (!r.figure) errs.push(`Choose the figure ${name} contributes.`);
      if (!fin(r.weight) || r.weight <= 0) errs.push(`Give ${name} a weight above 0.`);
    }
    if (res.rows.length && Math.abs(res.wsum - 100) >= 0.005) errs.push(`Weights add up to ${fmtPct(res.wsum, 2)} — they must total 100 %.`);
    if (d.marketPrice !== null && d.marketPrice !== undefined && !(d.marketPrice > 0)) errs.push('Market price must be above 0, or blank.');
    return errs;
  },
});

/** Combined output page. */
export function CombinedOutput({ data, company, ctx }) {
  const res = combinedResult(data, ctx);
  const px = res.marketPrice;
  const items = res.rows.map((r) => ({
    label: `${r.figure.label} · ${fmtPct(r.weight, 0)}`,
    low: r.figure.low, mid: r.figure.value, high: r.figure.high,
  }));
  return (
    <div className="out">
      <div className="headline">
        <div className="hl-eyebrow">{company.name} — combined value per share ({res.rows.length} method{res.rows.length > 1 ? 's' : ''})</div>
        <div className="hl-num">{fmtPrice(res.value, company, 2)}</div>
        <div className="hl-chips">
          {fin(res.upside) && <span className={`chip ${res.upside >= 0 ? 'pos' : 'neg'}`}>vs market {fmtPrice(px, company, 2)} <b>{res.upside >= 0 ? '+' : ''}{fmtPct(res.upside, 1)}</b></span>}
          <span className="chip">weights <b>{fmtPct(res.wsum, 0)}</b></span>
        </div>
      </div>
      <div className="chartbox">
        <div className="ct">Football field — each method’s range, with its contributed value</div>
        <FootballField items={items} currentPrice={fin(px) ? px : NaN} fmt={(v) => fmtPrice(v, company)} />
      </div>
      <div className="tablewrap">
        <table className="fin">
          <thead><tr><th>Method</th><th>Figure</th><th>Low</th><th>Value</th><th>High</th><th>Range basis</th><th>Weight</th><th>Contribution</th></tr></thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.methodId}>
                <td>{rowLabel(r.methodId)}</td>
                <td>{r.figure.label}</td>
                <td>{fmtPrice(r.figure.low, company, 2)}</td>
                <td><b>{fmtPrice(r.figure.value, company, 2)}</b></td>
                <td>{fmtPrice(r.figure.high, company, 2)}</td>
                <td className="muted">{r.figure.rangeNote}</td>
                <td>{fmtPct(r.weight, 1)}</td>
                <td>{fmtPrice((r.weight / 100) * r.figure.value, company, 2)}</td>
              </tr>
            ))}
            <tr className="bold"><td colSpan={6}>Combined value per share</td><td>{fmtPct(res.wsum, 1)}</td><td>{fmtPrice(res.value, company, 2)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="footer-note">
        Each figure is taken live from its method’s own inputs — the methods stay independent; change one and its contribution updates here.
      </div>
    </div>
  );
}
