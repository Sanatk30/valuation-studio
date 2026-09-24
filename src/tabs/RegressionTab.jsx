import React, { useMemo, useState } from 'react';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { Anim } from '../lib/anim.jsx';
import { themed, COL, xCat, yVal, vgrad } from '../lib/chartkit.js';
import { runRegression, allVars } from '../lib/engine/regressionModel.js';
import { PeerRowFetch, PeerSearchAdd, mergePeerRow } from '../components/PeerYahoo.jsx';
import { compsPeerRows } from '../lib/engine/comps.js';
import { blankCompany } from '../lib/engine/compsCo.js';
import { fmtPct, fmtX, fmtNum, fmtPrice, CURRENCIES } from '../lib/format.js';

const TRANSFORMS = [{ v: 'lin', label: 'x' }, { v: 'ln', label: 'ln x' }];
const DEGREES = [1, 2, 3];

/** significance stars from the two-tailed p-value */
const stars = (p) => (!isFinite(p) ? '' : p < 0.01 ? '***' : p < 0.05 ? '**' : p < 0.1 ? '*' : '');

export default function RegressionTab({ a, set }) {
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const R = useMemo(() => runRegression(a), [a]);
  const vars = allVars(a);
  const spec = a.regression || {};
  const yVar = R.yVar;
  const fit = R.fit;
  const peers = compsPeerRows(a);
  const [newVar, setNewVar] = useState('');

  const vFmt = (fmt) => (v) =>
    v == null || !isFinite(v) ? '—'
      : fmt === 'x' ? fmtX(v, 2) : fmt === 'pct' ? fmtPct(v, 1) : fmtNum(v, v >= 100 ? 0 : 2, locale);
  const fmtOf = (key) => vFmt((vars.find((v) => v.key === key) || {}).fmt || 'num');

  const activeX = spec.xVars || [];
  const xOf = (key) => activeX.find((x) => x.key === key);
  const setSpec = (patch) => set('regression', { ...spec, ...patch });
  const toggleX = (key) =>
    setSpec({ xVars: xOf(key) ? activeX.filter((x) => x.key !== key) : [...activeX, { key, transform: 'lin', degree: 1 }] });
  const editX = (key, patch) => setSpec({ xVars: activeX.map((x) => (x.key === key ? { ...x, ...patch } : x)) });

  // built-in variables are computed from each peer's input page; only custom
  // regression variables are stored on (and edited through) the peer object
  const setPeer = (i, key, value) => set('comps.peers', (rows) => rows.map((p, j) => (j === i ? { ...p, [key]: value } : p)));
  const delPeer = (i) => set('comps.peers', (rows) => rows.filter((_, j) => j !== i));
  const addCustomVar = () => {
    const label = newVar.trim();
    if (!label) return;
    const key = 'c_' + label.replace(/\W+/g, '_').toLowerCase();
    if (vars.some((v) => v.key === key)) return;
    setSpec({ customVars: [...(spec.customVars || []), { key, label, fmt: 'num' }] });
    setNewVar('');
  };
  const delCustomVar = (key) => setSpec({
    customVars: (spec.customVars || []).filter((v) => v.key !== key),
    xVars: activeX.filter((x) => x.key !== key),
    ...(yVar === key ? { yVar: 'evEbitda' } : {}),
  });

  // model-term columns first, then everything else
  const usedKeys = new Set([yVar, ...activeX.map((x) => x.key)]);
  const orderedVars = [...vars.filter((v) => usedKeys.has(v.key)), ...vars.filter((v) => !usedKeys.has(v.key))];

  /* ---------------- charts ---------------- */
  const singleTerm = fit?.ok && fit.cols.length === 1 ? fit.cols[0] : null;
  const scatterOpt = useMemo(() => {
    if (!fit?.ok) return null;
    if (singleTerm) {
      // x-scatter with the fitted curve sampled across the x range (works for ln/poly too)
      const key = singleTerm.key;
      const raw = fit.rows.map((r) => {
        const peer = peers.find((p) => p.name === r.name);
        return { x: Number(peer?.[key]), y: r.yRaw, name: r.name };
      }).filter((p) => isFinite(p.x));
      const tx = R.target[key];
      const xs = raw.map((p) => p.x).concat(isFinite(tx) ? [tx] : []);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const pad = (hi - lo || 1) * 0.08;
      const samples = [];
      for (let i = 0; i <= 40; i++) {
        const x = lo - pad + ((hi - lo + 2 * pad) * i) / 40;
        const v = singleTerm.transform === 'ln' ? (x > 0 ? Math.log(x) : NaN) : x;
        if (!isFinite(v)) continue;
        const yT = fit.beta[0] + fit.beta[1] * Math.pow(v, singleTerm.power);
        samples.push([+x.toFixed(4), +(fit.yLog ? Math.exp(yT) : yT).toFixed(4)]);
      }
      const fy = fmtOf(yVar), fx = fmtOf(key);
      return themed({
        tooltip: { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 },
          formatter: (p) => (p.data[2] ? `<b>${p.data[2]}</b><br/>${fx(p.data[0])} → ${fy(p.data[1])}` : `${fx(p.data[0])} → ${fy(p.data[1])}`) },
        legend: { show: false },
        grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
        xAxis: { type: 'value', scale: true, name: singleTerm.label, nameTextStyle: { color: COL.axis, fontSize: 10.5 }, axisLabel: { color: COL.axis, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        yAxis: { type: 'value', scale: true, name: (R.yDef || {}).label || yVar, nameTextStyle: { color: COL.axis, fontSize: 10.5 }, axisLabel: { color: COL.axis, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
        series: [
          { name: 'Fit', type: 'line', symbol: 'none', silent: true, smooth: true, lineStyle: { width: 2, color: COL.gold, type: 'dashed' }, data: samples },
          { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: '#0B0E14', borderWidth: 1 },
            label: { show: true, position: 'top', color: COL.axisStrong, fontSize: 9.5, formatter: (p) => p.data[2] },
            data: raw.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3), p.name]) },
          ...(isFinite(tx) && R.pred?.ok ? [{
            name: 'Target', type: 'scatter', symbol: 'diamond', symbolSize: 16, itemStyle: { color: COL.green, borderColor: '#0B0E14', borderWidth: 1 },
            label: { show: true, position: 'bottom', color: COL.green, fontSize: 10, fontWeight: 700, formatter: (p) => p.data[2] },
            data: [[+tx.toFixed(3), +R.pred.yHat.toFixed(3), a.company.name]],
          }] : []),
        ],
      });
    }
    // multivariate: actual vs fitted with the 45° line
    const pts = fit.rows.map((r) => [+r.fittedRaw.toFixed(4), +r.yRaw.toFixed(4), r.name]);
    const all = pts.flatMap((p) => [p[0], p[1]]);
    const lo = Math.min(...all), hi = Math.max(...all);
    const fy = fmtOf(yVar);
    return themed({
      tooltip: { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 },
        formatter: (p) => `<b>${p.data[2] || ''}</b><br/>fitted ${fy(p.data[0])} · actual ${fy(p.data[1])}` },
      legend: { show: false },
      grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
      xAxis: { type: 'value', scale: true, name: 'fitted', nameTextStyle: { color: COL.axis, fontSize: 10.5 }, axisLabel: { color: COL.axis, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      yAxis: { type: 'value', scale: true, name: 'actual', nameTextStyle: { color: COL.axis, fontSize: 10.5 }, axisLabel: { color: COL.axis, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      series: [
        { name: 'Perfect fit', type: 'line', symbol: 'none', silent: true, lineStyle: { width: 1.5, color: COL.gold, type: 'dashed' }, data: [[lo, lo], [hi, hi]] },
        { name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: '#0B0E14', borderWidth: 1 },
          label: { show: true, position: 'top', color: COL.axisStrong, fontSize: 9.5, formatter: (p) => p.data[2] }, data: pts },
      ],
    });
  }, [fit, singleTerm, peers, R, a.company.name, yVar]);

  const residOpt = useMemo(() => {
    if (!fit?.ok) return null;
    const fy = fmtOf(yVar);
    const resRaw = fit.rows.map((r) => r.yRaw - r.fittedRaw);
    return themed({
      tooltip: { trigger: 'axis', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 },
        formatter: (ps) => `<b>${ps[0].name}</b><br/>residual ${fy(ps[0].value)}` },
      legend: { show: false },
      grid: { left: 8, right: 20, top: 24, bottom: 8, containLabel: true },
      xAxis: xCat(fit.rows.map((r) => r.name), { axisLabel: { color: COL.axis, fontSize: 10, rotate: fit.rows.length > 6 ? 25 : 0 } }),
      yAxis: yVal({ axisLabel: { color: COL.axis, fontSize: 11 } }),
      series: [{
        name: 'Residual', type: 'bar', barMaxWidth: 26,
        itemStyle: { color: (p) => (p.value >= 0 ? vgrad(COL.green) : vgrad(COL.red)), borderRadius: [3, 3, 0, 0] },
        data: resRaw.map((v) => +v.toFixed(4)),
      }],
    });
  }, [fit, yVar]);

  const price = R.price;
  const mkt = a.company.currentPrice;

  return (
    <div className="view">
      <Hero
        eyebrow="Regression lab — cross-sectional over the peer set"
        value={price ? price.mid : fit?.ok ? fit.r2 * 100 : 0}
        fmt={price ? (v) => fmtPrice(v, s) : (v) => `${fmtNum(v, 1, locale)}% R²`}
        sub={fit?.ok
          ? `${(R.yDef || {}).label || yVar}${spec.yLog ? ' (ln)' : ''} ~ ${fit.cols.map((c) => c.label).join(' + ')} over ${fit.n} peers — R² ${fmtPct(fit.r2 * 100, 1)}, adj ${fmtPct(fit.adjR2 * 100, 1)}. ${price ? `Predicted multiple ${fmtX(R.pred.yHat, 2)} → implied ${fmtPrice(price.mid, s)} (±1 SE ${fmtPrice(price.lo, s)}–${fmtPrice(price.hi, s)}).` : 'Pick an EV/Sales, EV/EBITDA or P/E dependent to bridge the prediction to a share price.'}`
          : `Model not estimable: ${fit?.reason || 'add peers / variables'}. The data table below feeds every fit — fetch peers from Yahoo or type values in.`}
        chips={[
          { label: 'R²', value: fit?.ok ? fit.r2 * 100 : null, fmt: (v) => fmtPct(v, 1) },
          { label: 'adj R²', value: fit?.ok ? fit.adjR2 * 100 : null, fmt: (v) => fmtPct(v, 1) },
          { label: 'peers used', text: fit?.ok ? `${fit.n}` : '—' },
          ...(price ? [{ label: 'vs market', value: mkt > 0 ? (price.mid / mkt - 1) * 100 : null, fmt: (v) => fmtPct(v, 1), tone: price.mid >= mkt ? 'pos' : 'neg' }] : []),
        ]}
      />

      {/* ---------------- model builder ---------------- */}
      <div className="stmt-block">
        <div className="stmt-head">
          <span className="stmt-tag">MODEL</span>
          <h3>Model builder</h3>
          <span className="stmt-note">y ~ β₀ + Σ βᵢ·xᵢ — every change refits instantly</span>
        </div>
        <div className="reg-spec">
          <div className="reg-y">
            <label>Dependent (y)</label>
            <select value={yVar} onChange={(e) => setSpec({ yVar: e.target.value, xVars: activeX.filter((x) => x.key !== e.target.value) })}>
              {vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <label className="reg-ck" title="Fit ln(y) — power-law / elasticity form; the prediction is back-transformed">
              <input type="checkbox" checked={!!spec.yLog} onChange={(e) => setSpec({ yLog: e.target.checked })} /> ln(y)
            </label>
          </div>
          <div className="reg-x">
            <label>Regressors (x)</label>
            <div className="reg-chips">
              {vars.filter((v) => v.key !== yVar).map((v) => {
                const on = xOf(v.key);
                return (
                  <div key={v.key} className={`reg-chip${on ? ' on' : ''}`}>
                    <button className="reg-chip-main" onClick={() => toggleX(v.key)}>{on ? '✓ ' : '+ '}{v.label}</button>
                    {on && (
                      <>
                        <select value={on.transform || 'lin'} onChange={(e) => editX(v.key, { transform: e.target.value })} title="linear or natural-log transform">
                          {TRANSFORMS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                        </select>
                        <select value={on.degree || 1} onChange={(e) => editX(v.key, { degree: +e.target.value })} title="polynomial degree — 2 adds x², 3 adds x³">
                          {DEGREES.map((d) => <option key={d} value={d}>{d === 1 ? 'x¹' : d === 2 ? '+x²' : '+x³'}</option>)}
                        </select>
                      </>
                    )}
                    {v.custom && <button className="peer-del" title="Delete this custom variable" onClick={() => delCustomVar(v.key)}>×</button>}
                  </div>
                );
              })}
              <div className="reg-newvar">
                <input placeholder="Add your own variable…" value={newVar} onChange={(e) => setNewVar(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustomVar(); }} />
                <button className="btn" onClick={addCustomVar} disabled={!newVar.trim()}>+ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- data table ---------------- */}
      <div className="stmt-block">
        <div className="stmt-head">
          <span className="stmt-tag">DATA</span>
          <h3>Peer data</h3>
          <span className="stmt-note">built-in columns are derived from each peer's input page (read-only here) · custom columns are editable · ⟳ refetches a row from Yahoo · highlighted columns are in the model</span>
        </div>
        <div className="tablewrap">
          <table className="fin reg-data">
            <thead>
              <tr>
                <th>Peer</th>
                {orderedVars.map((v) => (
                  <th key={v.key} className={usedKeys.has(v.key) ? 'reg-used' : ''}>
                    {v.label}{v.key === yVar ? ' (y)' : xOf(v.key) ? ' (x)' : ''}
                  </th>
                ))}
                <th colSpan={2} />
              </tr>
            </thead>
            <tbody>
              {peers.map((p, i) => (
                <tr key={i}>
                  <td><input className="pname" value={p.name} onChange={(e) => setPeer(i, 'name', e.target.value)} /></td>
                  {orderedVars.map((v) => (
                    <td key={v.key} className={usedKeys.has(v.key) ? 'reg-used' : ''}>
                      {/* Built-in variables are derived from the peer's input page and
                          overwrite anything stored on the row, so typing here would be
                          silently discarded. Only custom columns are editable. */}
                      <input
                        type="number" step="0.1" className="reg-cell"
                        readOnly={!v.custom}
                        title={v.custom ? undefined : `Derived from ${p.name || 'this peer'}'s input page — edit it in Comps → Input pages`}
                        value={isFinite(p[v.key]) ? +Number(p[v.key]).toFixed(2) : ''}
                        placeholder="—"
                        onChange={(e) => v.custom && setPeer(i, v.key, e.target.value === '' ? NaN : parseFloat(e.target.value))}
                      />
                    </td>
                  ))}
                  <td><PeerRowFetch name={p.symbol || p.name} onFilled={(m) => set('comps.peers', (rows) => rows.map((r, j) => (j === i ? mergePeerRow(r, m, a.settings) : r)))} /></td>
                  <td><button className="peer-del" onClick={() => delPeer(i)} title="Remove peer">×</button></td>
                </tr>
              ))}
              <tr className="reg-target">
                <td><b>{a.company.name} (target)</b></td>
                {orderedVars.map((v) => {
                  const derived = R.target[v.key];
                  const ov = spec.targetOverrides?.[v.key];
                  return (
                    <td key={v.key} className={usedKeys.has(v.key) ? 'reg-used' : ''}>
                      <input
                        type="number" step="0.1" className={`reg-cell${isFinite(ov) ? ' reg-ov' : ''}`}
                        value={isFinite(ov) ? ov : isFinite(derived) ? +Number(derived).toFixed(2) : ''}
                        placeholder="—"
                        title={isFinite(ov) ? 'Manual override — clear with ↺' : 'Derived from the model — type to override'}
                        onChange={(e) => setSpec({ targetOverrides: { ...spec.targetOverrides, [v.key]: e.target.value === '' ? null : parseFloat(e.target.value) } })}
                      />
                    </td>
                  );
                })}
                <td colSpan={2}>
                  {Object.values(spec.targetOverrides || {}).some((v) => isFinite(v)) &&
                    <button className="peer-del" title="Clear all target overrides" onClick={() => setSpec({ targetOverrides: {} })}>↺</button>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, maxWidth: 560 }}>
          <PeerSearchAdd onAdd={(m) => set('comps.peers', (rows) => [...rows, mergePeerRow(blankCompany({ name: '' }), m, a.settings)])} />
        </div>
        {fit?.dropped?.length > 0 && (
          <div className="sec-note" style={{ marginTop: 8 }}>
            Excluded from the fit (missing a used variable): {fit.dropped.join(', ')}
          </div>
        )}
      </div>

      {/* ---------------- fit results ---------------- */}
      {fit?.ok && (
        <div className="stmt-block">
          <div className="stmt-head">
            <span className="stmt-tag">FIT</span>
            <h3>Estimates & diagnostics</h3>
            <span className="stmt-note">*** p&lt;1% · ** p&lt;5% · * p&lt;10%</span>
          </div>
          <div className="cards" style={{ marginBottom: 14 }}>
            <div className="card"><div className="k">R² / adj R²</div><div className="v"><Anim value={fit.r2 * 100} fmt={(v) => fmtPct(v, 1)} /></div><div className="s">adjusted {fmtPct(fit.adjR2 * 100, 1)}</div></div>
            <div className="card"><div className="k">SE of regression</div><div className="v">{fmtNum(fit.seReg, 3, locale)}</div><div className="s">{spec.yLog ? 'in ln(y) units' : `in ${(R.yDef || {}).label || 'y'} units`}</div></div>
            <div className="card"><div className="k">F-statistic</div><div className="v">{fmtNum(fit.fStat, 2, locale)}</div><div className="s">k = {fit.k}, df = {fit.df}</div></div>
            <div className="card"><div className="k">Observations</div><div className="v">{fit.n}</div><div className="s">{fit.dropped.length ? `${fit.dropped.length} dropped` : 'all peers used'}</div></div>
          </div>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Term</th><th>Coefficient</th><th>Std error</th><th>t-stat</th><th>p-value</th><th></th></tr></thead>
              <tbody>
                {['Intercept', ...fit.cols.map((c) => c.label)].map((label, i) => (
                  <tr key={label} className={i === 0 ? 'sub' : ''}>
                    <td>{label}</td>
                    <td>{fmtNum(fit.beta[i], 4, locale)}</td>
                    <td>{fmtNum(fit.se[i], 4, locale)}</td>
                    <td>{fmtNum(fit.tStats[i], 2, locale)}</td>
                    <td>{isFinite(fit.pVals[i]) ? fit.pVals[i].toFixed(4) : '—'}</td>
                    <td style={{ color: COL.gold, fontWeight: 700 }}>{stars(fit.pVals[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="charts2">
            <div className="chartbox">
              <div className="ct">{singleTerm ? `${(R.yDef || {}).label} vs ${singleTerm.label} — fit ${spec.yLog ? '(ln y) ' : ''}` : 'Actual vs fitted'}</div>
              <LiveChart option={scatterOpt} height={280} />
            </div>
            <div className="chartbox">
              <div className="ct">Residuals by peer{spec.yLog ? ' (raw scale)' : ''}</div>
              <LiveChart option={residOpt} height={280} />
            </div>
          </div>
          <div className="tablewrap" style={{ marginTop: 14 }}>
            <table className="fin">
              <thead><tr><th>Peer</th><th>Actual</th><th>Fitted</th><th>Residual</th></tr></thead>
              <tbody>
                {fit.rows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{fmtOf(yVar)(r.yRaw)}</td>
                    <td>{fmtOf(yVar)(r.fittedRaw)}</td>
                    <td className={r.yRaw - r.fittedRaw < 0 ? 'neg' : ''}>{fmtOf(yVar)(r.yRaw - r.fittedRaw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- implied price ---------------- */}
      {fit?.ok && (
        price ? (
          <div className="stmt-block">
            <div className="stmt-head">
              <span className="stmt-tag">PRICE</span>
              <h3>Implied share price</h3>
              <span className="stmt-note">predicted {R.yDef.label} applied to the model's NTM metrics · band = ±1 SE of the mean prediction</span>
            </div>
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th></th><th>−1 SE</th><th>Prediction</th><th>+1 SE</th></tr></thead>
                <tbody>
                  <tr><td>Predicted {R.yDef.label}</td><td>{fmtX(R.pred.lo, 2)}</td><td className="bold">{fmtX(R.pred.yHat, 2)}</td><td>{fmtX(R.pred.hi, 2)}</td></tr>
                  <tr className="sub"><td>× {price.metricLabel}</td><td colSpan={3}>{fmtNum(price.metric, 0, locale)}</td></tr>
                  {R.yDef.multiple === 'ev' && <tr className="sub"><td>− Net debt</td><td colSpan={3}>{fmtNum(price.netDebt, 0, locale)}</td></tr>}
                  <tr className="sub"><td>÷ Shares outstanding</td><td colSpan={3}>{fmtNum(price.shares, 2, locale)}</td></tr>
                  <tr className="bold"><td>Implied share price</td><td>{fmtPrice(price.lo, s)}</td><td>{fmtPrice(price.mid, s)}</td><td>{fmtPrice(price.hi, s)}</td></tr>
                  {mkt > 0 && <tr className="sub"><td>vs market ({fmtPrice(mkt, s)})</td><td>{fmtPct((price.lo / mkt - 1) * 100, 1)}</td><td>{fmtPct((price.mid / mkt - 1) * 100, 1)}</td><td>{fmtPct((price.hi / mkt - 1) * 100, 1)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="edit-note">
            The dependent variable isn't a valuation multiple, so there is no price bridge — the prediction
            {R.pred?.ok ? ` (${fmtOf(yVar)(R.pred.yHat)})` : ''} stands on its own. Set y to EV/Sales, EV/EBITDA or P/E to value the company off the fit.
          </div>
        )
      )}

      <div className="footer-note">
        Cross-sectional OLS over the comps peer set: each peer is one observation. Variables come from the Yahoo peer
        fetch (multiples, growth, margin, leverage, ROE, USD size) or your own custom columns; ln transforms fit
        power-law relationships and polynomial terms capture curvature. The fit is exact (normal equations), standard
        errors classical; with few peers, treat significance as indicative. The target's x-values derive from this
        model's own drivers — type in the target row to override them.
      </div>
    </div>
  );
}
