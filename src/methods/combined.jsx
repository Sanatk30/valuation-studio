import React, { useLayoutEffect, useRef, useState } from 'react';
import FootballField from '../components/FootballField.jsx';
import Headline from '../outputs/parts/Headline.jsx';
import { NumBox } from '../wizard/Field.jsx';
import { METHOD_META } from './labels.js';
import { fmtPrice, fmtPct } from '../lib/format.js';
import { includeBox, methodMarketPrice } from './figures.js';
import { YahooSearch } from '../components/PeerYahoo.jsx';
import { CountUp } from '../lib/motion.jsx';

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

/** Methods & weights exactly as the approved sample (A + C): cards with weight sliders, wired into the combined value. */
function CombinedLayout({ data, setData, company, ctx }) {
  const entries = data.combined?.entries || {};
  const setEntry = (id, patch) => setData((d) => ({
    ...d, combined: { ...d.combined, entries: { ...d.combined.entries, [id]: { include: false, figure: null, weight: null, ...d.combined.entries?.[id], ...patch } } },
  }));
  const res = combinedResult(data, ctx);
  const px = data.combined?.marketPrice;
  const ids = [...COMBINABLE, ...MANUAL_ROWS.map((m) => m.id)];
  const wrap = useRef(null);
  const [paths, setPaths] = useState([]);
  const sig = JSON.stringify(ids.map((id) => [entries[id]?.include, entries[id]?.weight]));
  useLayoutEffect(() => {
    const draw = () => {
      const box = wrap.current; if (!box) return;
      const cv = box.getBoundingClientRect();
      const tgt = box.querySelector('[data-cb="res"]'); if (!tgt) return;
      const t = tgt.getBoundingClientRect();
      const x2 = t.left - cv.left, y2 = t.top - cv.top + Math.min(t.height / 2, 90);
      setPaths(ids.map((id) => {
        const e = box.querySelector(`[data-cb="${id}"]`); if (!e) return null;
        const r = e.getBoundingClientRect();
        const x1 = r.right - cv.left, y1 = r.top - cv.top + r.height / 2;
        const w = entries[id]?.include && fin(entries[id]?.weight) ? entries[id].weight : 0;
        return { id, w, d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}` };
      }).filter(Boolean));
    };
    draw();
    const ro = new ResizeObserver(draw); if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const equal = () => {
    const on = ids.filter((id) => entries[id]?.include);
    if (!on.length) return;
    const w = Math.floor((100 / on.length) * 100) / 100;
    setData((d) => {
      const next = { ...d.combined.entries };
      on.forEach((id, i) => { next[id] = { ...next[id], weight: i === on.length - 1 ? Math.round((100 - w * (on.length - 1)) * 100) / 100 : w }; });
      return { ...d, combined: { ...d.combined, entries: next } };
    });
  };
  const card = (id) => {
    const manual = MANUAL_ROWS.find((m) => m.id === id);
    const p = manual ? { complete: true } : ctx.progressOf(id);
    const e = entries[id] || {};
    const figs = !manual && p.complete ? ctx.figuresOf(id) : [];
    const fig = manual ? (fin(e.value) ? { value: e.value } : null) : figs.find((x) => x.key === e.figure);
    const on = !!e.include;
    const can = manual || p.complete;
    const gap = fig && fin(px) && px > 0 ? fig.value / px - 1 : null;
    const w = fin(e.weight) ? e.weight : 0;
    return (
      <div key={id} data-cb={id} className={`cbc${on ? '' : ' off'}`}>
        <div className="cbc-h"><b>{rowLabel(id)}</b><span style={{ flex: 1 }} />
          <button type="button" role="switch" aria-checked={on} aria-label={`Include ${rowLabel(id)}`} className={`sw${on ? ' on' : ''}`} disabled={!can && !on}
            title={can ? '' : 'Finish this method first'} onClick={() => setEntry(id, { include: !on })} /></div>
        <div className="cbc-v">
          <span className="cbc-n"><CountUp>{fig ? fmtPrice(fig.value, company, 2) : '—'}</CountUp></span>
          {gap !== null && <span className={gap >= 0 ? 'up' : 'dn'}>{gap >= 0 ? '+' : '−'}{Math.abs(gap * 100).toFixed(1)}%</span>}
          <span style={{ flex: 1 }} />
          {!can ? <span className="fa">{p.started ? 'in progress' : 'not started'}</span>
            : manual ? (on && <span className="cbc-man"><NumBox small value={e.low ?? null} placeholder="low" onChange={(v) => setEntry(id, { low: v })} /><NumBox small value={e.value ?? null} placeholder={manual.figureLabel} onChange={(v) => setEntry(id, { value: v })} /><NumBox small value={e.high ?? null} placeholder="high" onChange={(v) => setEntry(id, { high: v })} /></span>)
              : on && <select className="chipsel" value={e.figure || ''} onChange={(ev) => setEntry(id, { figure: ev.target.value || null })}><option value="">choose…</option>{figs.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>}
        </div>
        {on && (
          <div className="cbc-w">
            <input type="range" min="0" max="100" step="1" value={w} onChange={(ev) => setEntry(id, { weight: Number(ev.target.value) })} aria-label={`${rowLabel(id)} weight`} style={{ '--p': `${w}%` }} />
            <NumBox small value={e.weight ?? null} suffix="%" onChange={(v) => setEntry(id, { weight: v })} />
          </div>
        )}
        {manual && on && id === 'range52' && (
          <div className="cbc-y"><YahooSearch company={company} action="Use its 52-week range"
            onPick={({ raw, rates }) => {
              const cur = raw.price?.currency;
              const r = cur === company.currency ? 1 : Number(typeof rates?.[cur] === 'object' ? rates[cur]?.rate : rates?.[cur]);
              const cv = (v) => (fin(v) && fin(r) && r > 0 ? v * r : null);
              setEntry('range52', { low: cv(raw.price?.low52), value: cv(raw.price?.value), high: cv(raw.price?.high52) });
            }} /></div>
        )}
      </div>
    );
  };
  const okW = Math.abs(res.wsum - 100) < 0.005;
  const prices = COMBINABLE.filter((id) => entries[id]?.include).map((id) => ({ id, px: methodMarketPrice(id, ctx.record.methods[id]?.data) })).filter((x) => fin(x.px) && x.px > 0);
  return (
    <div className="cbw" ref={wrap}>
      <svg className="cm-wires" aria-hidden="true">{paths.map((p) => <path key={p.id} d={p.d} pathLength={p.w > 0 ? 1 : undefined} className={p.w > 0 ? 'hot draw' : ''} style={{ strokeWidth: p.w > 0 ? 1.6 + p.w / 7 : 1.2, strokeDasharray: p.w > 0 ? undefined : '4 5' }} />)}</svg>
      <div className="cbw-l">{ids.map(card)}</div>
      <div />
      <div className="col16 cbw-r">
        <div className="cm-res" data-cb="res">
          <span className="cm-res-l">Combined fair value</span>
          <b className="cm-res-v"><CountUp>{fin(res.value) ? fmtPrice(res.value, company, 2) : '—'}</CountUp></b>
          <span className={`cm-res-s ${fin(res.upside) ? (res.upside >= 0 ? 'up' : 'dn') : ''}`}>{fin(res.upside) ? `${res.upside >= 0 ? '▲' : '▼'} ${Math.abs(res.upside).toFixed(1)}% vs ${fmtPrice(px, company, 2)}` : 'enter a market price to compare'}</span>
          <span className="cm-res-r"><span>Weights add to</span><b>{fmtPct(res.wsum, 1)} {okW ? '✓' : '✕'}</b></span>
          <button type="button" className="cm-res-b" onClick={equal}>Make weights equal</button>
        </div>
        <div className="box2">
          <h3>Contribution</h3>
          {res.rows.filter((r) => r.figure && fin(r.weight)).map((r) => <div className="kv3" key={r.methodId}><span>{rowLabel(r.methodId)}</span><b>{fmtPrice((r.weight / 100) * r.figure.value, company, 2)}</b></div>)}
          {!res.rows.length && <div className="fa">Switch a method on to see its share.</div>}
        </div>
        <div className="box2">
          <h3>Market price per share <span className="fa" style={{ fontWeight: 500 }}>optional</span></h3>
          <NumBox value={px ?? null} suffix={company.currency} onChange={(v) => setData((d) => ({ ...d, combined: { ...d.combined, marketPrice: v } }))} />
          <div className="chips2" style={{ marginTop: 8 }}>{prices.map((x) => <button type="button" key={x.id} onClick={() => setData((d) => ({ ...d, combined: { ...d.combined, marketPrice: x.px } }))}>Use {METHOD_META[x.id].short}’s {fmtPrice(x.px, company)}</button>)}</div>
        </div>
      </div>
    </div>
  );
}

export const combinedStep = () => ({
  id: 'pick',
  title: 'Methods & weights',
  blurb: 'Choose which completed methods to combine, which result each contributes, and how much weight it gets.',
  Extra: CombinedPicker,
  Layout: CombinedLayout,
  summary: (data, ctx) => { const r = combinedResult(data, ctx); return r.rows.length ? `${r.rows.length} methods · ${fmtPct(r.wsum, 0)}` : null; },
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
  const hasPx = fin(px) && px > 0;
  const items = res.rows.map((r) => ({
    label: `${rowLabel(r.methodId)} · ${fmtPct(r.weight, 0)}`,
    low: r.figure.low, mid: r.figure.value, high: r.figure.high,
  }));
  if (fin(res.value)) items.push({ label: 'Combined (weighted)', low: res.value, mid: res.value, high: res.value, highlight: true });
  const lows = res.rows.map((r) => r.figure.low).filter(fin);
  const highs = res.rows.map((r) => r.figure.high).filter(fin);
  const top = [...res.rows].sort((x, y) => y.weight - x.weight)[0];
  const left = [...COMBINABLE, ...MANUAL_ROWS.map((m) => m.id)].filter((id) => !res.rows.some((r) => r.methodId === id));
  const sorted = [...res.rows].filter((r) => r.figure).sort((x, y) => x.figure.value - y.figure.value);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const close = hasPx ? res.rows.filter((r) => r.figure && Math.abs(r.figure.value / px - 1) < 0.1) : [];
  const verdict = !hasPx ? null : Math.abs(res.upside) < 10 ? 'fairly priced' : res.upside > 0 ? 'undervalued' : 'overvalued';
  const DON = ['#1F646C', '#2B7C85', '#7FB7BC', '#E0A33A', '#7C4DCC'];
  let acc = 0;
  return (
    <div className="qo">
      <div className="gLb" style={{ marginBottom: 18 }}>
        <div className="box2 summ">
          <div className="lbl">Fair value per share</div>
          <div className="summ-v">{fin(res.value) ? fmtPrice(res.value, company, 2) : '—'}</div>
          <p>
            Weighting {res.rows.length} method{res.rows.length === 1 ? '' : 's'} puts {company.name} at <b>{fmtPrice(res.value, company, 2)}</b>
            {hasPx && <>, <b className={res.upside >= 0 ? 'up' : 'dn'}>{fmtPct(Math.abs(res.upside), 1)} {res.upside >= 0 ? 'above' : 'below'}</b> today’s {fmtPrice(px, company, 2)} — the share looks <b>{verdict}</b></>}.
            {close.length > 0 && <> {close.map((r) => `${rowLabel(r.methodId)} (${fmtPrice(r.figure.value, company, 0)})`).join(' and ')} {close.length === 1 ? 'sits' : 'sit'} close to the price.</>}
            {lo && hi && lo !== hi && <> The range runs from {rowLabel(lo.methodId)} at {fmtPrice(lo.figure.value, company, 0)} to {rowLabel(hi.methodId)} at {fmtPrice(hi.figure.value, company, 0)}.</>}
          </p>
          <FootballField items={items} currentPrice={hasPx ? px : NaN} fmt={(v) => fmtPrice(v, company)} />
        </div>
        <div className="col16">
          <div className="box2">
            <h3>Weights</h3>
            <svg viewBox="0 0 160 160" className="wd-donut" style={{ width: 160, height: 160 }} aria-hidden="true">
              {res.rows.filter((r) => fin(r.weight) && r.weight > 0).map((r, i) => {
                const c = 2 * Math.PI * 56, len = (r.weight / 100) * c;
                const el = <circle key={r.methodId} cx="80" cy="80" r="56" fill="none" stroke={DON[i % DON.length]} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)" />;
                acc += len; return el;
              })}
              <text x="80" y="78" textAnchor="middle" className="dn-c">{fin(res.value) ? fmtPrice(res.value, company, 0) : '—'}</text>
              <text x="80" y="96" textAnchor="middle" className="dn-s">combined</text>
            </svg>
            {res.rows.map((r, i) => <div className="kv3" key={r.methodId}><span><i className="dot2" style={{ background: DON[i % DON.length] }} />{rowLabel(r.methodId)}</span><b>{fmtPct(r.weight, 0)}</b></div>)}
          </div>
          {left.length > 0 && (
            <div className="box2"><h3>Left out</h3>{left.map((id) => <div className="kv3" key={id}><span>{rowLabel(id)}</span><b className="fa">weight 0%</b></div>)}</div>
          )}
        </div>
      </div>
      <div className="tablewrap">
        <table className="fin">
          <thead><tr><th>Method</th><th className="txt">Figure</th><th>Low</th><th>Value</th><th>High</th><th className="txt">Range basis</th><th>Weight</th><th>Contribution</th></tr></thead>
          <tbody>
            {res.rows.map((r) => (
              <tr key={r.methodId}>
                <td>{rowLabel(r.methodId)}</td>
                <td className="txt">{r.figure.label}</td>
                <td>{fmtPrice(r.figure.low, company, 2)}</td>
                <td><b>{fmtPrice(r.figure.value, company, 2)}</b></td>
                <td>{fmtPrice(r.figure.high, company, 2)}</td>
                <td className="txt muted-cell">{r.figure.rangeNote}</td>
                <td>
                  <span className="wbar"><span style={{ width: `${Math.max(0, Math.min(100, r.weight))}%` }} /></span>
                  {fmtPct(r.weight, 1)}
                </td>
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
