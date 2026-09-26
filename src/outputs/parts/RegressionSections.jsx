import React, { useMemo } from 'react';
import * as REG from '../../lib/engine/regressionModel.js';
import Collapsible from './Collapsible.jsx';
import ChartBox from './ChartBox.jsx';
import { fin, upsidePct } from './format.js';
import { themed, xCat, yVal, vgrad, COL } from './charts.js';

const DASH = '—';
/** significance stars from a two-tailed p-value */
const stars = (p) => (!fin(p) ? '' : p < 0.01 ? '***' : p < 0.05 ? '**' : p < 0.1 ? '*' : '');

/** Regression results, charts, worksheet and price bridge (only when the step wasn't skipped). */
export default function RegressionSections({ a, f, R, px }) {
  const hasPx = fin(px) && px > 0;
  const vars = REG.allVars(a);
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
  const obs = useMemo(() => REG.observations(a), [a]);
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
        <div className="qo-note">The target's x-values come from its own Comps Summary row{Object.values(a.regression?.targetOverrides || {}).some(fin) ? ' (with the overrides you typed in the Regression step)' : ''}.</div>
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
                {R.yDef?.multiple === 'ev' && <tr className="sub"><td>Less: non-controlling interest</td><td colSpan={3}>{f.num(price.nci)}</td></tr>}
                <tr className="sub"><td>÷ Diluted shares</td><td colSpan={3}>{f.shares(price.shares)}</td></tr>
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
