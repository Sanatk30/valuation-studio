import React, { useMemo } from 'react';
import FootballField from '../components/FootballField.jsx';
import BenchmarkTable from '../components/BenchmarkTable.jsx';
import * as COMPS from '../lib/engine/comps.js';
import * as REG from '../lib/engine/regressionModel.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, upsidePct, upsideText, attempt, tone } from './parts/format.js';
import { themed, xCat, yVal, vgrad, COL, bandBarsOption, boxOption } from './parts/charts.js';

const DASH = '—';
/** significance stars from a two-tailed p-value */
const stars = (p) => (!fin(p) ? '' : p < 0.01 ? '***' : p < 0.05 ? '**' : p < 0.1 ? '*' : '');

/** A peer page's LTM multiple for an implied-price row. */
function peerMultiple(row, page) {
  if (typeof row.pick === 'function') return row.pick(page);
  const m = page.multiples?.[row.key];
  if (Array.isArray(m?.values)) return m.values[0];
  return fin(m?.value) ? m.value : NaN;
}

/**
 * Trading comparables output — LTM only.
 * Props: { a, set, company, skipped } — `skipped.regression` hides every
 * regression figure. Nothing on this page is editable.
 */
export default function CompsOutput({ a, skipped = {} }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const showReg = !skipped.regression;
  const model = useMemo(() => attempt(() => ({
    comps: COMPS.computeComps(a),
    reg: showReg && typeof REG.runRegression === 'function' ? REG.runRegression(a) : null,
  })), [a, showReg]);
  if (model.error) return <div className="qo"><EngineError what="The comparable companies analysis" error={model.error} /></div>;
  return <CompsPage a={a} f={f} comps={model.value.comps} R={model.value.reg} showReg={showReg} />;
}

function CompsPage({ a, f, comps, R, showReg }) {
  const px = a.company.currentPrice;
  const hasPx = fin(px) && px > 0;
  const netDebt = comps.netDebt;
  const shares = comps.shares ?? a.company.sharesOut;
  const rows = comps.rows || [];
  const nPeers = (comps.pages || []).length;
  const regPrice = R?.fit?.ok ? R.price : null;

  /** Implied EV and equity at a multiple, per row type. */
  const bridge = (r, m) => {
    const isPe = r.key === 'pe';
    const eq = isPe ? m * r.metric : m * r.metric - netDebt;
    const ev = isPe ? eq + netDebt : m * r.metric;
    return { ev, eq };
  };

  const ffItems = [
    ...rows.map((r) => ({ label: r.label, low: r.impliedLow, mid: r.impliedMedian, high: r.impliedHigh })),
    ...(regPrice ? [{ label: `Regression (${R.yDef?.label || R.yVar}, ±1 SE)`, low: regPrice.lo, mid: regPrice.mid, high: regPrice.hi, color: '#22D3EE' }] : []),
  ];
  const ffOk = ffItems.some((it) => fin(it.low) && fin(it.high));

  const boxOpt = useMemo(() => boxOption(rows.map((r) => ({
    label: r.label, values: (comps.pages || []).map((p) => peerMultiple(r, p)),
  }))), [comps]); // eslint-disable-line react-hooks/exhaustive-deps
  const evEbitdaRow = rows.find((r) => r.key === 'evEbitda');
  const peerBars = useMemo(() => (evEbitdaRow
    ? bandBarsOption((comps.pages || []).map((p) => ({ name: p.co.name, value: peerMultiple(evEbitdaRow, p) })), { name: evEbitdaRow.label })
    : null), [comps]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = a.comps?.target || {};
  const ltmNote = t.ltmLabel ? ` (${t.ltmLabel})` : '';

  return (
    <div className="qo">
      {/* OPEN QUESTION: comps has four implied-price rows and the spec doesn't say which one is
          "the" comps answer, so the headline shows all four side by side instead of one big figure. */}
      <Headline
        eyebrow={`Trading comparables — implied share price from ${nPeers} peers' LTM multiples`}
        sub={`Peer median LTM multiple × the target's LTM metric${ltmNote}; the range is the peer 25th–75th percentile. EV multiples bridge to equity through net debt of ${f.money(netDebt)}.${hasPx ? ` Market price ${f.price(px)}.` : ''}`}
        kpis={[
          ...rows.map((r) => {
            const b = bridge(r, r.median);
            const up = upsideText(r.impliedMedian, px);
            return {
              label: `${r.label} — implied price`,
              value: r.impliedMedian, fmt: (v) => f.price(v),
              tone: hasPx && fin(r.impliedMedian) ? tone(upsidePct(r.impliedMedian, px)) : undefined,
              sub: `${f.price(r.impliedLow)} – ${f.price(r.impliedHigh)} · EV ${f.money(b.ev)} · equity ${f.money(b.eq)}${up ? ` · ${up}` : ''}`,
            };
          }),
          regPrice && {
            label: `Regression — implied price`, value: regPrice.mid, fmt: (v) => f.price(v), hero: true,
            tone: hasPx ? tone(upsidePct(regPrice.mid, px)) : undefined,
            sub: `${f.price(regPrice.lo)} – ${f.price(regPrice.hi)} (±1 SE) · R² ${f.dec(R.fit.r2, 2)}${upsideText(regPrice.mid, px) ? ` · ${upsideText(regPrice.mid, px)}` : ''}`,
          },
        ]}
      >
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Implied share price ranges ({f.sym}) — 25th to 75th percentile, median marked</div>
            {ffOk
              ? <FootballField items={ffItems} currentPrice={hasPx ? px : NaN} fmt={f.gridPrice} />
              : <div className="sec-note">No implied range could be computed — check the peer multiples below.</div>}
          </div>
          <ChartBox title="Peer LTM multiples — distribution (box & whisker)" option={boxOpt} empty="No peer has a meaningful LTM multiple." />
        </div>
      </Headline>

      <Sections>
        <Collapsible title={`Bottom-up: peer multiple → implied share price (${f.sym})`} tag="PRICE">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th /><th>25th pct</th><th>Median</th><th>75th pct</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const steps = [r.q1, r.median, r.q3];
                  const isPe = r.key === 'pe';
                  const prices = [r.impliedLow, r.impliedMedian, r.impliedHigh];
                  return (
                    <React.Fragment key={r.key}>
                      <tr className="sechead"><td colSpan={4}>{r.label} × {r.metricLabel || 'target LTM metric'} ({f.money(r.metric)})</td></tr>
                      <tr className="sub"><td>Peer multiple</td>{steps.map((m, i) => <td key={i}>{f.x(m)}</td>)}</tr>
                      {!isPe && <tr><td>Implied enterprise value</td>{steps.map((m, i) => <td key={i}>{f.num(bridge(r, m).ev)}</td>)}</tr>}
                      {!isPe && <tr className="sub"><td>Less: net debt</td>{steps.map((_, i) => <td key={i} className="neg">{f.num(-netDebt)}</td>)}</tr>}
                      <tr><td>Implied equity value</td>{steps.map((m, i) => <td key={i}>{f.num(bridge(r, m).eq)}</td>)}</tr>
                      <tr className="sub"><td>÷ Shares outstanding</td>{steps.map((_, i) => <td key={i}>{f.shares(shares)}</td>)}</tr>
                      <tr className="bold"><td>Implied share price</td>{prices.map((v, i) => <td key={i}>{f.price(v)}</td>)}</tr>
                      {hasPx && <tr className="sub"><td>vs market ({f.price(px)})</td>{prices.map((v, i) => <td key={i}>{f.pct(upsidePct(v, px))}</td>)}</tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="qo-note">Money in {f.unitLabel}. P/E applies straight to LTM net income, so it needs no debt bridge.</div>
        </Collapsible>

        <Collapsible title="Peer multiple statistics — quartiles" tag="STATS" note={`${nPeers} peers`}>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>LTM multiple</th><th>Peers used</th><th>Low</th><th>25th pct</th><th>Median</th><th>Mean</th><th>75th pct</th><th>High</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td>{fin(r.n) ? r.n : DASH}</td>
                    <td>{f.x(r.low)}</td><td>{f.x(r.q1)}</td><td className="bold">{f.x(r.median)}</td>
                    <td>{f.x(r.mean)}</td><td>{f.x(r.q3)}</td><td>{f.x(r.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qo-note">A multiple on a zero or negative denominator is not meaningful (NM) and is left out of every statistic.</div>
          <ChartBox title={`Peer ${evEbitdaRow?.label || 'EV / EBITDA'} vs median and the quartile band`} option={peerBars} empty="No peer has a meaningful EV / EBITDA." />
        </Collapsible>

        <Collapsible title="Trading multiples — LTM, by tier" tag="OUTPUT">
          <div className="qo-note">The target on top, each tier with its own mean and median, then the overall mean / median / high / low.</div>
          <BenchmarkTable groups={comps.cols.output} comps={comps} settings={a.settings} />
        </Collapsible>

        <Collapsible title="Benchmarking — market valuation, LTM financials, margins, growth" tag="BENCH 1">
          <BenchmarkTable groups={comps.cols.bench1} comps={comps} settings={a.settings} />
        </Collapsible>

        <Collapsible title="Benchmarking — returns, leverage, coverage, credit ratings" tag="BENCH 2">
          <BenchmarkTable groups={comps.cols.bench2} comps={comps} settings={a.settings} />
        </Collapsible>

        <Collapsible title="Peer list" tag="LIST">
          <div className="tablewrap bm">
            <table className="fin">
              <thead><tr>{comps.cols.list.map((c) => <th key={c.key} className={c.kind === 'text' ? 'txt' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {[comps.targetPage, ...(comps.pages || [])].map((p, i) => (
                  <tr key={p.co.id ?? i} className={i === 0 ? 'bold bm-target' : ''}>
                    {comps.cols.list.map((c) => {
                      const v = c.get(p);
                      return <td key={c.key} className={c.kind === 'text' ? 'txt' : ''}>{c.kind === 'money' ? (fin(v) ? f.num(v) : 'NA') : (v || DASH)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>

        {showReg && <RegressionSections a={a} f={f} R={R} px={px} />}
      </Sections>
    </div>
  );
}

/** Regression results, charts, worksheet and price bridge (only when the step wasn't skipped). */
function RegressionSections({ a, f, R, px }) {
  const hasPx = fin(px) && px > 0;
  const vars = typeof REG.allVars === 'function' ? REG.allVars(a) : [];
  const varOf = (key) => vars.find((v) => v.key === key) || { key, label: key, fmt: 'num' };
  const vFmt = (key) => {
    const kind = varOf(key).fmt;
    return (v) => (!fin(v) ? DASH : kind === 'x' ? f.x(v) : kind === 'pct' ? f.pct(v) : f.num2(v));
  };
  const colLabel = (c) => {
    const base = varOf(c.key).label;
    const tr = c.transform === 'ln' ? `ln(${base})` : base;
    return c.power > 1 ? `${tr}${c.power === 2 ? '²' : '³'}` : tr;
  };

  const fit = R?.fit;
  const yVar = R?.yVar;
  const yLabel = R?.yDef?.label || yVar;
  const obs = useMemo(() => (typeof REG.observations === 'function' ? REG.observations(a) : []), [a]);
  const usedKeys = [...new Set((fit?.cols || []).map((c) => c.key))];

  const single = fit?.ok && fit.cols.length === 1 ? fit.cols[0] : null;
  const scatterOpt = useMemo(() => {
    if (!fit?.ok) return null;
    const tip = { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 } };
    const valAxis = (name) => ({ type: 'value', scale: true, name, nameTextStyle: { color: COL.axis, fontSize: 10.5 }, axisLabel: { color: COL.axis, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } });
    const fy = vFmt(yVar);
    if (single) {
      const key = single.key;
      const fx = vFmt(key);
      const raw = fit.rows.map((r) => {
        const ob = obs.find((o) => o.name === r.name);
        return { x: Number(ob?.values?.[key]), y: r.yRaw, name: r.name };
      }).filter((p) => fin(p.x));
      const tx = R.target?.[key];
      const xs = raw.map((p) => p.x).concat(fin(tx) ? [tx] : []);
      if (!xs.length) return null;
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const pad = (hi - lo || 1) * 0.08;
      const samples = [];
      for (let i = 0; i <= 40; i++) {
        const x = lo - pad + ((hi - lo + 2 * pad) * i) / 40;
        const v = single.transform === 'ln' ? (x > 0 ? Math.log(x) : NaN) : x;
        if (!fin(v)) continue;
        const yT = fit.beta[0] + fit.beta[1] * Math.pow(v, single.power);
        samples.push([+x.toFixed(4), +(fit.yLog ? Math.exp(yT) : yT).toFixed(4)]);
      }
      return themed({
        tooltip: { ...tip, formatter: (p) => (p.data[2] ? `<b>${p.data[2]}</b><br/>${fx(p.data[0])} → ${fy(p.data[1])}` : `${fx(p.data[0])} → ${fy(p.data[1])}`) },
        legend: { show: false },
        grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
        xAxis: valAxis(colLabel(single)), yAxis: valAxis(yLabel),
        series: [
          { name: 'Fit', type: 'line', symbol: 'none', silent: true, smooth: true, lineStyle: { width: 2, color: COL.gold, type: 'dashed' }, data: samples },
          { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: '#0B0E14', borderWidth: 1 }, label: { show: true, position: 'top', color: COL.axisStrong, fontSize: 9.5, formatter: (p) => p.data[2] }, data: raw.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3), p.name]) },
          ...(fin(tx) && R.pred?.ok ? [{ name: 'Target', type: 'scatter', symbol: 'diamond', symbolSize: 16, itemStyle: { color: COL.green, borderColor: '#0B0E14', borderWidth: 1 }, label: { show: true, position: 'bottom', color: COL.green, fontSize: 10, fontWeight: 700, formatter: (p) => p.data[2] }, data: [[+tx.toFixed(3), +R.pred.yHat.toFixed(3), a.company.name || 'Target']] }] : []),
        ],
      });
    }
    // several terms: actual vs fitted around the 45° line
    const pts = fit.rows.map((r) => [+r.fittedRaw.toFixed(4), +r.yRaw.toFixed(4), r.name]);
    const all = pts.flatMap((p) => [p[0], p[1]]);
    const lo = Math.min(...all), hi = Math.max(...all);
    return themed({
      tooltip: { ...tip, formatter: (p) => `<b>${p.data[2] || ''}</b><br/>fitted ${fy(p.data[0])} · actual ${fy(p.data[1])}` },
      legend: { show: false },
      grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
      xAxis: valAxis('fitted'), yAxis: valAxis('actual'),
      series: [
        { name: 'Perfect fit', type: 'line', symbol: 'none', silent: true, lineStyle: { width: 1.5, color: COL.gold, type: 'dashed' }, data: [[lo, lo], [hi, hi]] },
        { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: '#0B0E14', borderWidth: 1 }, label: { show: true, position: 'top', color: COL.axisStrong, fontSize: 9.5, formatter: (p) => p.data[2] }, data: pts },
      ],
    });
  }, [fit, single, obs, R, a.company.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const residOpt = useMemo(() => {
    if (!fit?.ok) return null;
    const fy = vFmt(yVar);
    return themed({
      tooltip: { trigger: 'axis', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 }, formatter: (ps) => `<b>${ps[0].name}</b><br/>residual ${fy(ps[0].value)}` },
      legend: { show: false },
      grid: { left: 8, right: 20, top: 24, bottom: 8, containLabel: true },
      xAxis: xCat(fit.rows.map((r) => r.name), { axisLabel: { color: COL.axis, fontSize: 10, rotate: fit.rows.length > 6 ? 25 : 0 } }),
      yAxis: yVal(),
      series: [{
        name: 'Residual', type: 'bar', barMaxWidth: 26,
        itemStyle: { color: (p) => (p.value >= 0 ? vgrad(COL.green) : vgrad(COL.red)), borderRadius: [3, 3, 0, 0] },
        data: fit.rows.map((r) => +(r.yRaw - r.fittedRaw).toFixed(4)),
      }],
    });
  }, [fit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!R) return null;
  if (!fit?.ok) {
    return (
      <Collapsible title="Regression" tag="REG" note="not estimable">
        <div className="sec-note">The regression can't be estimated: {fit?.reason || 'no regressors were chosen'}. Use Edit on the Regression step to change the model.</div>
      </Collapsible>
    );
  }
  const price = R.price;
  const eq = `${yLabel}${fit.yLog ? ' (ln)' : ''} = β₀ + ${fit.cols.map((c, i) => `β${i + 1}·${colLabel(c)}`).join(' + ')}`;

  return (
    <>
      <Collapsible title="Regression — results" tag="REG" note={`R² ${f.pct(fit.r2 * 100)} · ${fit.n} peers`}>
        <div className="qo-note">{eq}</div>
        <div className="cards">
          <div className="card"><div className="k">R² / adjusted R²</div><div className="v">{f.pct(fit.r2 * 100)}</div><div className="s">adjusted {f.pct(fit.adjR2 * 100)}</div></div>
          <div className="card"><div className="k">SE of regression</div><div className="v">{f.dec(fit.seReg, 3)}</div><div className="s">{fit.yLog ? 'in ln(y) units' : `in ${yLabel} units`}</div></div>
          <div className="card"><div className="k">F-statistic</div><div className="v">{f.dec(fit.fStat, 2)}</div><div className="s">k = {fit.k}, df = {fit.df}</div></div>
          <div className="card"><div className="k">Observations</div><div className="v">{fit.n}</div><div className="s">{fit.dropped?.length ? `${fit.dropped.length} excluded (missing a variable)` : 'every peer used'}</div></div>
        </div>
        <div className="tablewrap">
          <table className="fin">
            <thead><tr><th>Term</th><th>Coefficient</th><th>Std error</th><th>t-stat</th><th>p-value</th><th /></tr></thead>
            <tbody>
              {['Intercept', ...fit.cols.map(colLabel)].map((label, i) => (
                <tr key={`${label}${i}`} className={i === 0 ? 'sub' : ''}>
                  <td>{label}</td>
                  <td>{f.dec(fit.beta[i], 4)}</td>
                  <td>{f.dec(fit.se[i], 4)}</td>
                  <td>{f.dec(fit.tStats[i], 2)}</td>
                  <td>{fin(fit.pVals[i]) ? fit.pVals[i].toFixed(4) : DASH}</td>
                  <td style={{ color: COL.gold, fontWeight: 700 }}>{stars(fit.pVals[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="qo-note">*** p &lt; 1% · ** p &lt; 5% · * p &lt; 10%. With few peers, treat significance as indicative.{fit.dropped?.length ? ` Excluded: ${fit.dropped.join(', ')}.` : ''}</div>
      </Collapsible>

      <Collapsible title="Regression — fit and residual charts" tag="REG">
        <div className="grid2">
          <ChartBox title={single ? `${yLabel} vs ${colLabel(single)} — fitted curve, target ◆` : 'Actual vs fitted'} option={scatterOpt} height={290} />
          <ChartBox title={`Residuals by peer${fit.yLog ? ' (raw scale)' : ''}`} option={residOpt} height={290} />
        </div>
      </Collapsible>

      <Collapsible title="Regression — worksheet" tag="REG" note="observations, fitted values, residuals">
        <div className="tablewrap">
          <table className="fin">
            <thead>
              <tr>
                <th>Peer</th>
                <th>{yLabel} (y)</th>
                {usedKeys.map((k) => <th key={k}>{varOf(k).label} (x)</th>)}
                <th>In fit</th>
              </tr>
            </thead>
            <tbody>
              {obs.map((o, i) => (
                <tr key={`${o.name}${i}`}>
                  <td className="txt">{o.name || DASH}</td>
                  <td>{vFmt(yVar)(Number(o.values?.[yVar]))}</td>
                  {usedKeys.map((k) => <td key={k}>{vFmt(k)(Number(o.values?.[k]))}</td>)}
                  <td>{fit.dropped?.includes(o.name) ? 'no' : 'yes'}</td>
                </tr>
              ))}
              <tr className="bold">
                <td className="txt">{a.company.name || 'Target'} (target)</td>
                <td>{R.pred?.ok ? vFmt(yVar)(R.pred.yHat) : DASH}</td>
                {usedKeys.map((k) => <td key={k}>{vFmt(k)(R.target?.[k])}</td>)}
                <td>predicted</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="tablewrap">
          <table className="fin">
            <thead><tr><th>Peer</th><th>Actual</th><th>Fitted</th><th>Residual</th></tr></thead>
            <tbody>
              {fit.rows.map((r, i) => {
                const e = r.yRaw - r.fittedRaw;
                return (
                  <tr key={`${r.name}${i}`}>
                    <td className="txt">{r.name}</td>
                    <td>{vFmt(yVar)(r.yRaw)}</td>
                    <td>{vFmt(yVar)(r.fittedRaw)}</td>
                    <td className={e < 0 ? 'neg' : ''}>{vFmt(yVar)(e)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="qo-note">The target's x-values come from its LTM figures{Object.values(a.regression?.targetOverrides || {}).some(fin) ? ' (with the overrides you typed in the Regression step)' : ''}.</div>
      </Collapsible>

      <Collapsible title="Regression — implied share price" tag="REG">
        {price ? (
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th /><th>−1 SE</th><th>Prediction</th><th>+1 SE</th></tr></thead>
              <tbody>
                <tr><td>Predicted {yLabel}</td><td>{f.x(R.pred.lo)}</td><td className="bold">{f.x(R.pred.yHat)}</td><td>{f.x(R.pred.hi)}</td></tr>
                <tr className="sub"><td>× {price.metricLabel}</td><td colSpan={3}>{f.num(price.metric)}</td></tr>
                {R.yDef?.multiple === 'ev' && <tr className="sub"><td>Less: net debt</td><td colSpan={3}>{f.num(price.netDebt)}</td></tr>}
                <tr className="sub"><td>÷ Shares outstanding</td><td colSpan={3}>{f.shares(price.shares)}</td></tr>
                <tr className="bold"><td>Implied share price</td><td>{f.price(price.lo)}</td><td>{f.price(price.mid)}</td><td>{f.price(price.hi)}</td></tr>
                {hasPx && <tr className="sub"><td>vs market ({f.price(px)})</td><td>{f.pct(upsidePct(price.lo, px))}</td><td>{f.pct(upsidePct(price.mid, px))}</td><td>{f.pct(upsidePct(price.hi, px))}</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sec-note">
            The dependent variable ({yLabel}) isn't a valuation multiple, so there is no price bridge
            {R.pred?.ok ? ` — the prediction (${vFmt(yVar)(R.pred.yHat)}) stands on its own` : ''}.
          </div>
        )}
        <div className="qo-note">The ±1 SE band is the standard error of the mean prediction.</div>
      </Collapsible>
    </>
  );
}
