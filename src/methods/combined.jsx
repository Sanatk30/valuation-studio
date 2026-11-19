import React from 'react';
import FootballField from '../components/FootballField.jsx';
import { NumBox } from '../wizard/Field.jsx';
import { METHOD_META } from './labels.js';
import { fmtPrice, fmtPct } from '../lib/format.js';
import { includeBox, methodMarketPrice } from './figures.js';

/** Methods that can feed the Combined valuation. */
export const COMBINABLE = ['dcf', 'comps', 'precedent', 'ipo'];
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
  });
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
            <tr className="bold">
              <td colSpan={5}>Total weight</td>
              <td className={Math.abs(res.wsum - 100) < 0.005 ? 'pos' : 'neg'}>{fmtPct(res.wsum, 1)}</td>
            </tr>
          </tbody>
        </table>
        <div className="fld-h">Only completed methods can be included. Results update when you change a method.</div>
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
      const name = METHOD_META[r.methodId].label;
      if (!r.complete) errs.push(`${name} is no longer complete — finish it or untick it.`);
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
                <td>{METHOD_META[r.methodId].label}</td>
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
