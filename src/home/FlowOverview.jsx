import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { METHODS } from '../methods/registry.js';
import { METHOD_META } from '../methods/labels.js';
import { useCompanyCtx } from '../wizard/MethodPage.jsx';
import { CURRENCIES, UNITS, fmtPrice, fmtNum } from '../lib/format.js';
import { combinedResult, rowLabel } from '../methods/combined.jsx';
import { methodMarketPrice } from '../methods/figures.js';
import { peerSlots, isBlankPeer } from '../lib/engine/comps.js';
import { dealSlots, isBlankDeal } from '../lib/engine/precedent.js';
import FootballField from '../components/FootballField.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { areaTrendOption } from '../lib/chartkit.js';
import { useThemeMode } from '../lib/theme.js';
import { computeDcfT } from '../lib/engine/dcfTemplate.js';
import { toEngineInput } from '../store/methodModel.js';
import { effectiveYear1 } from '../lib/period.js';
import { CountUp } from '../lib/motion.jsx';

/*
 * The overview as a flow map (the layout the user picked): the company's data on
 * the left, every method in the middle, the combined value on the right, with
 * lines showing what feeds what. Click any box to open it.
 */

const fin = Number.isFinite;
const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A method's per-share result: one figure, or the median of several multiples. */
function methodResult(id, record, ctx) {
  if (id === 'combined') {
    const res = combinedResult(record.methods.combined?.data || {}, { ...ctx, record });
    return fin(res.value) ? { mid: res.value, low: res.value, high: res.value, n: 1 } : null;
  }
  const figs = ctx.figuresOf(id) || [];
  if (!figs.length) return null;
  const vals = figs.map((g) => g.value);
  return {
    mid: figs.length === 1 ? figs[0].value : median(vals),
    low: Math.min(...figs.map((g) => (fin(g.low) ? g.low : g.value))),
    high: Math.max(...figs.map((g) => (fin(g.high) ? g.high : g.value))),
    n: figs.length,
  };
}

/** The market price the completed valuations carry, else the Combined step's. */
export function marketPriceOf(record, ctx) {
  const fromMethods = ['dcf', 'comps', 'precedent', 'ipo'].map((id) => methodMarketPrice(id, record.methods[id]?.data)).find((v) => fin(v) && v > 0);
  if (fin(fromMethods)) return fromMethods;
  const c = record.methods.combined?.data?.combined?.marketPrice;
  return fin(c) && c > 0 ? c : NaN;
}

function dcfSeries(record, ctx) {
  if (!ctx.progressOf('dcf').complete) return null;
  try {
    const r = computeDcfT(toEngineInput(ctx.company, record.methods.dcf.data));
    return { labels: [...r.labels.hist, ...r.labels.fcst], nHist: r.n, rev: r.F.rev, ebitda: r.F.ebitda };
  } catch { return null; }
}

/** Which data each method reads (the wires on the left). */
const FEEDS = {
  dcf: ['hist', 'mkt'], comps: ['mkt', 'peers'], precedent: ['deals'],
  lbo: ['hist'], ipo: ['hist'], ts: ['hist'], ratios: ['hist', 'mkt'],
};
const MID = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'ts', 'ratios'];
const SHORT = { dcf: 'DCF', comps: 'COMP', precedent: 'PREC', lbo: 'LBO', ipo: 'IPO', ts: '3ST', ratios: 'RAT' };

export default function FlowOverview({ record, onOpen }) {
  const ctx = useCompanyCtx(record);
  const theme = useThemeMode();
  const c = ctx.company;
  const sym = CURRENCIES[c.currency]?.symbol || '';
  const px = marketPriceOf(record, ctx);
  const pf = (v, dp = 2) => fmtPrice(v, c, dp);
  const gapOf = (v) => (fin(v) && fin(px) && px > 0 ? v / px - 1 : NaN);
  const gapTxt = (g) => `${g >= 0 ? '+' : '−'}${Math.abs(g * 100).toFixed(1)}%`;

  const prog = Object.fromEntries([...MID, 'combined'].map((id) => [id, ctx.progressOf(id)]));
  const results = Object.fromEntries([...MID, 'combined'].map((id) => [id, prog[id].complete ? methodResult(id, record, ctx) : null]));

  // the combined value and its weights
  let comb = null;
  if (prog.combined.complete) {
    try { comb = combinedResult(record.methods.combined?.data || {}, { ...ctx, record }); } catch { comb = null; }
  }
  const weightOf = (id) => {
    const r = comb?.rows?.find((x) => x.methodId === id);
    return r && fin(r.weight) ? r.weight : 0;
  };

  // the data boxes
  const peers = peerSlots(record.methods.comps?.data?.comps || {}).filter((p) => !isBlankPeer(p));
  const deals = dealSlots(record.methods.precedent?.data?.precedent || {}).filter((d) => !isBlankDeal(d));
  // the methods with a historicals step (IPO has none: its step 2 is the operating forecast)
  const histDone = ['dcf', 'lbo', 'ts', 'ratios'].filter((id) => (prog[id].states?.[1] === 'valid'));
  const year1 = effectiveYear1(record.startYear, record.fyEndMonth);
  const data = [
    { id: 'co', ic: (record.name || 'QV').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(), t: 'Company profile', s: `${c.currency} ${UNITS[c.unit]} · FY ends ${MON[(record.fyEndMonth || 12) - 1]} · Year 1 ${year1} · used by every method`, ok: true },
    { id: 'hist', ic: '▤', t: 'Historicals', s: histDone.length ? `filled in ${histDone.map((id) => METHOD_META[id].short).join(', ')}` : 'not filled yet', ok: histDone.length > 0 },
    { id: 'mkt', ic: sym || '₹', t: 'Market data', s: fin(px) ? `price ${pf(px)}` : 'no share price yet', ok: fin(px) },
    { id: 'peers', ic: '◫', t: 'Peers', s: peers.length ? `${peers.length} companies · ${peers.filter((p) => p.include !== 0).length} included` : 'none yet — open Comps', ok: peers.length > 0, open: 'comps' },
    { id: 'deals', ic: '⇄', t: 'Deals', s: deals.length ? `${deals.length} transaction${deals.length === 1 ? '' : 's'}` : 'none yet — open Precedent', ok: deals.length > 0, open: 'precedent' },
  ];

  // wires
  const wrap = useRef(null);
  const [paths, setPaths] = useState([]);
  const sig = JSON.stringify([MID.map((id) => [prog[id].complete, prog[id].started, weightOf(id)]), data.map((d) => d.ok)]);
  useLayoutEffect(() => {
    const draw = () => {
      const box = wrap.current;
      if (!box) return;
      const cv = box.getBoundingClientRect();
      const el = (id) => box.querySelector(`[data-node="${id}"]`);
      const pt = (id, right) => {
        const e = el(id);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return [right ? r.right - cv.left : r.left - cv.left, r.top - cv.top + r.height / 2];
      };
      const out = [];
      MID.forEach((m) => {
        FEEDS[m].forEach((d) => {
          const a = pt(d, true), b = pt(m, false);
          if (a && b) out.push({ a, b, k: `${d}-${m}`, hot: prog[m].complete && weightOf(m) > 0, w: 1.3 });
        });
        const w = weightOf(m);
        if (['dcf', 'comps', 'precedent', 'lbo', 'ipo'].includes(m)) {
          const a = pt(m, true), b = pt('combined', false);
          if (a && b) out.push({ a, b, k: `${m}-c`, hot: w > 0, w: w > 0 ? 1.6 + w / 12 : 1.3, dash: !(w > 0) });
        }
      });
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrap.current) ro.observe(wrap.current);
    window.addEventListener('resize', draw);
    return () => { ro.disconnect(); window.removeEventListener('resize', draw); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // charts below
  const rows = ['dcf', 'comps', 'precedent', 'ipo', 'combined'].map((id) => results[id] && fin(results[id].mid)
    ? { label: id === 'combined' ? 'Combined' : METHOD_META[id].short, low: results[id].low, mid: results[id].mid, high: results[id].high, highlight: id === 'combined' } : null).filter(Boolean);
  const dcf = dcfSeries(record, ctx);
  const num0 = (v) => fmtNum(v, 0, CURRENCIES[c.currency]?.locale);
  const trend = useMemo(() => (dcf ? areaTrendOption(dcf.labels, [{ name: 'Revenue', data: dcf.rev }, { name: 'EBITDA', data: dcf.ebitda }], { fmt: num0, nHist: dcf.nHist }) : null), [dcf && JSON.stringify([dcf.labels, dcf.rev, dcf.ebitda]), c.currency, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const cv = comb && fin(comb.value) ? comb.value : NaN;
  const cg = gapOf(cv);

  return (
    <div className="fo anim-page">
      <div className="fo-head">
        <div>
          <h1>{record.name}</h1>
          <p>Your data → every method → one combined value. Click any box to open it; lines show what feeds what.</p>
        </div>
      </div>

      <div className="fo-map" ref={wrap}>
        <svg className="fo-wires" aria-hidden="true">
          {paths.map(({ a, b, k, hot, w, dash }) => (
            <path key={k} d={`M${a[0]},${a[1]} C${(a[0] + b[0]) / 2},${a[1]} ${(a[0] + b[0]) / 2},${b[1]} ${b[0]},${b[1]}`}
              className={hot ? 'hot draw' : ''} pathLength={hot ? 1 : undefined} strokeWidth={w} strokeDasharray={dash ? '4 5' : undefined} />
          ))}
        </svg>

        <div className="fo-col">
          <h5>1 · Your data</h5>
          {data.map((d) => (
            <button key={d.id} data-node={d.id} className={`fo-node${d.ok ? '' : ' off'}`} onClick={() => (d.open ? onOpen(d.open) : onOpen(d.id === 'co' ? null : 'dcf'))} title={d.open ? `Open ${METHOD_META[d.open].label}` : ''}>
              <span className="fo-ic">{d.ic}</span>
              <span className="fo-tx"><b>{d.t}</b><small>{d.s}</small></span>
            </button>
          ))}
        </div>

        <div className="fo-col">
          <h5>2 · Methods</h5>
          {MID.map((id) => {
            const p = prog[id], r = results[id], g = gapOf(r?.mid);
            const n = METHODS[id].steps.length;
            return (
              <button key={id} data-node={id} className={`fo-node fo-m${p.complete ? '' : ' off'}`} onClick={() => onOpen(id)}>
                <span className="fo-ic">{SHORT[id]}</span>
                <span className="fo-tx"><b>{METHOD_META[id].label}</b><small>{p.complete ? (id === 'lbo' ? 'sponsor IRR and MOIC' : id === 'ts' ? 'linked statements' : id === 'ratios' ? 'ratios past and forecast' : r?.n > 1 ? `median of ${r.n} multiples` : METHOD_META[id].short) : p.started ? `step ${p.reachable + 1} of ${n} · ${METHODS[id].steps[p.reachable]?.title || ''}` : 'not started'}</small></span>
                <span className="fo-val">
                  {r && fin(r.mid) ? <><b><CountUp>{pf(r.mid)}</CountUp></b>{fin(g) && <em className={g >= 0 ? 'pos' : 'neg'}>{gapTxt(g)}</em>}</>
                    : <span className={`fo-st ${p.complete ? 'done' : p.started ? 'prog' : 'none'}`}>{p.complete ? 'Open' : p.started ? 'Resume' : 'Start'}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="fo-col fo-right">
          <h5>3 · Result</h5>
          <button data-node="combined" className="fo-comb" onClick={() => onOpen('combined')}>
            <span className="fo-comb-l">Combined fair value</span>
            <b className="fo-comb-v"><CountUp>{fin(cv) ? pf(cv) : '—'}</CountUp></b>
            <span className="fo-comb-g">{fin(cg) ? `${cg >= 0 ? '▲' : '▼'} ${Math.abs(cg * 100).toFixed(1)}% vs ${pf(px)}` : prog.combined.started ? 'finish Combined to see it' : 'weight the methods you finish'}</span>
            {comb && comb.rows.filter((r) => fin(r.weight) && r.weight > 0).map((r) => (
              <span className="fo-w" key={r.methodId}><span>{METHOD_META[r.methodId]?.short || rowLabel(r.methodId)}</span><b>{r.weight.toFixed(0)}% · {r.figure && fin(r.figure.value) ? pf(r.figure.value) : '—'}</b></span>
            ))}
            <span className="fo-comb-btn">{prog.combined.complete ? 'Change weights' : 'Open Combined'}</span>
          </button>
        </div>
      </div>

      <div className="fo-below">
        <section className="card">
          <div className="card-h"><h3>Valuation range</h3><span className="card-sub">{sym} per share{fin(px) ? ' · dashed line = market price' : ''}</span></div>
          <div className="card-b">
            {rows.length
              ? <FootballField items={rows} currentPrice={fin(px) ? px : NaN} fmt={(v) => fmtPrice(v, c, 0)} />
              : <div className="empty-s">Finish a valuation method — its range shows here next to the others and the market price.</div>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Revenue and EBITDA</h3><span className="card-sub">from the DCF · {sym} {UNITS[c.unit]}</span></div>
          <div className="card-b">{trend ? <LiveChart option={trend} height={300} /> : <div className="empty-s">Finish the DCF to see its revenue and EBITDA, actual and forecast.</div>}</div>
        </section>
      </div>
    </div>
  );
}
