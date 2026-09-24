import React, { useMemo, useState } from 'react';
import FootballField from '../components/FootballField.jsx';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { themed, COL } from '../lib/chartkit.js';
import { Anim } from '../lib/anim.jsx';
import { applyScenario } from '../lib/engine/scenario.js';
import { computeComps } from '../lib/engine/comps.js';
import BenchmarkTable from '../components/BenchmarkTable.jsx';
import CompanyPageEditor from '../components/CompanyPageEditor.jsx';
import { computeRegression } from '../lib/engine/regression.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES } from '../lib/format.js';

export default function CompsTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const comps = useMemo(() => computeComps(am), [am]);
  const reg = useMemo(() => computeRegression(am), [am]);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const peers = a.comps.peers;
  const tiers = a.comps.tiers || [];
  const [view, setView] = useState('bench1');
  const [openId, setOpenId] = useState(peers[0]?.id ?? null);
  const setPeer = (id, next) => set('comps.peers', (rows) => rows.map((p) => (p.id === id ? next : p)));
  const delPeer = (id) => set('comps.peers', (rows) => rows.filter((p) => p.id !== id));
  const openCo = peers.find((p) => p.id === openId) || peers[0];

  // regression chart: peers scattered with name labels, OLS fit, ±1 SE band, target diamond
  const regOpt = useMemo(() => {
    if (!reg.ok) return null;
    const xs = [...reg.pts.map((p) => p.x), reg.targetGrowth];
    const lo = Math.floor(Math.min(...xs) - 1.5), hi = Math.ceil(Math.max(...xs) + 1.5);
    const axis = (label) => ({
      type: 'value',
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } }, axisTick: { show: false },
      axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      name: label, nameTextStyle: { color: COL.axis, fontSize: 10.5 },
    });
    const pt = (p) => `<div style="font-weight:700;color:#6C8CFF;font-size:11px;margin-bottom:4px;font-family:Inter,sans-serif">${p.data[2]}</div>` +
      `<span style="color:#AAB4C5;font-size:11.5px">growth </span><b style="font-family:Inter,sans-serif">${fmtPct(p.data[0], 1)}</b>` +
      `<span style="color:#AAB4C5;font-size:11.5px;margin-left:10px">EV/EBITDA </span><b style="font-family:Inter,sans-serif">${fmtX(p.data[1], 2)}</b>`;
    return themed({
      tooltip: { trigger: 'item', backgroundColor: '#161B25', borderColor: '#2A3242', borderWidth: 1, padding: [9, 12], textStyle: { color: COL.text, fontSize: 12 }, formatter: pt },
      legend: { show: false },
      grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
      xAxis: { ...axis('growth %'), min: lo, max: hi, axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 11, formatter: '{value}%' } },
      yAxis: { ...axis('EV/EBITDA'), scale: true, axisLabel: { color: COL.axis, fontFamily: 'Inter, sans-serif', fontSize: 11, formatter: '{value}x' } },
      series: [
        { name: '_lo', type: 'line', stack: 'se', silent: true, symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false }, data: [[lo, +(reg.line(lo) - reg.se).toFixed(3)], [hi, +(reg.line(hi) - reg.se).toFixed(3)]] },
        { name: '±1 SE', type: 'line', stack: 'se', silent: true, symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(34,211,238,0.09)' }, tooltip: { show: false }, data: [[lo, +(2 * reg.se).toFixed(3)], [hi, +(2 * reg.se).toFixed(3)]] },
        { name: 'OLS fit', type: 'line', symbol: 'none', silent: true, lineStyle: { width: 2, color: COL.gold, type: 'dashed' }, tooltip: { show: false }, data: [[lo, +reg.line(lo).toFixed(3)], [hi, +reg.line(hi).toFixed(3)]] },
        {
          name: 'Peers', type: 'scatter', symbolSize: 11, itemStyle: { color: COL.teal, borderColor: '#0B0E14', borderWidth: 1 },
          label: { show: true, position: 'top', color: COL.axisStrong, fontSize: 9.5, fontFamily: 'Inter, sans-serif', formatter: (p) => p.data[2] },
          data: reg.pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), p.name]),
        },
        {
          name: 'Target', type: 'scatter', symbol: 'diamond', symbolSize: 16, itemStyle: { color: COL.green, borderColor: '#0B0E14', borderWidth: 1 },
          label: { show: true, position: 'bottom', color: COL.green, fontSize: 10, fontWeight: 700, fontFamily: 'Inter, sans-serif', formatter: (p) => p.data[2] },
          data: [[+reg.targetGrowth.toFixed(2), +reg.impliedMultiple.toFixed(2), a.company.name]],
        },
      ],
    });
  }, [reg, a.company.name]);

  return (
    <div className="view">
        <Hero
          eyebrow="Trading comparables & regression — implied share price"
          value={reg.ok ? reg.impliedPrice : comps.rows[1].impliedMedian}
          fmt={(v) => fmtPrice(v, s)}
          sub={reg.ok
            ? `The regression prices the target's own ${fmtPct(reg.targetGrowth, 1)} growth on the peer line (R² ${fmtNum(reg.r2, 2, 'en-US')}) instead of assuming it deserves the median multiple. Quartile ranges below.`
            : 'Add growth estimates to at least 3 peers to unlock the regression method.'}
          chips={[
            { label: 'EV/EBITDA med', value: comps.rows[1].impliedMedian, fmt: (v) => fmtPrice(v, s) },
            { label: 'P/E med', value: comps.rows[2].impliedMedian, fmt: (v) => fmtPrice(v, s) },
            ...(reg.ok ? [{ label: 'reg multiple', value: reg.impliedMultiple, fmt: (v) => fmtX(v, 2), tone: 'pos' }] : []),
          ]}
        />
        <div className="cards">
          {comps.rows.map((r) => (
            <div className="card" key={r.key}>
              <div className="k">{r.label} — implied price</div>
              <div className="v"><Anim value={r.impliedMedian} fmt={(v) => fmtPrice(v, s)} /></div>
              <div className="s">{fmtPrice(r.impliedLow, s)} – {fmtPrice(r.impliedHigh, s)} (25th–75th pct)</div>
            </div>
          ))}
          <div className="card hero">
            <div className="k">Regression — implied price</div>
            <div className="v">{reg.ok ? <Anim value={reg.impliedPrice} fmt={(v) => fmtPrice(v, s)} /> : 'n/m'}</div>
            <div className="s">
              {reg.ok
                ? `${fmtX(reg.impliedMultiple, 2)} EV/EBITDA @ ${fmtPct(reg.targetGrowth, 1)} growth · R² ${fmtNum(reg.r2, 2, 'en-US')}`
                : reg.reason}
            </div>
          </div>
        </div>

        <h3 className="blocktitle">
          Comparable companies
          <span className="viewtabs">
            {[['bench1', 'Benchmarking 1'], ['bench2', 'Benchmarking 2'], ['output', 'Trading multiples'], ['list', 'List'], ['pages', 'Input pages']].map(([k, lab]) => (
              <button key={k} className={`vt${view === k ? ' on' : ''}`} onClick={() => setView(k)}>{lab}</button>
            ))}
          </span>
        </h3>

        {view === 'bench1' && (
          <>
            <div className="sec-note">Market valuation, LTM financial statistics, profitability margins and growth — the target benchmarked against every tier.</div>
            <BenchmarkTable groups={comps.cols.bench1} comps={comps} settings={s} onPick={(id) => { setOpenId(id); setView('pages'); }} />
          </>
        )}
        {view === 'bench2' && (
          <>
            <div className="sec-note">Returns on investment, leverage, coverage and credit ratings.</div>
            <BenchmarkTable groups={comps.cols.bench2} comps={comps} settings={s} onPick={(id) => { setOpenId(id); setView('pages'); }} />
          </>
        )}
        {view === 'output' && (
          <>
            <div className="sec-note">Trading multiples on LTM and the two forward estimate years, tiered, with Mean / Median / High / Low.</div>
            <BenchmarkTable groups={comps.cols.output} comps={comps} settings={s} onPick={(id) => { setOpenId(id); setView('pages'); }} />
          </>
        )}
        {view === 'list' && (
          <div className="tablewrap bm">
            <table className="fin">
              <thead><tr>{comps.cols.list.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                <tr className="bold">{comps.cols.list.map((c) => <td key={c.key} className={c.kind === 'text' ? 'txt' : ''}>{c.kind === 'money' ? fmtNum(c.get(comps.targetPage), 0, locale) : (c.get(comps.targetPage) || '—')}</td>)}</tr>
                {comps.pages.map((p) => (
                  <tr key={p.co.id} className="clickable" onClick={() => { setOpenId(p.co.id); setView('pages'); }}>
                    {comps.cols.list.map((c) => <td key={c.key} className={c.kind === 'text' ? 'txt' : ''}>{c.kind === 'money' ? fmtNum(c.get(p), 0, locale) : (c.get(p) || '—')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'pages' && (
          <div className="cp-wrap">
            <div className="cp-list">
              <div className="cp-list-h">Target</div>
              <button className={`cp-pick${openId === '__target__' ? ' on' : ''}`} onClick={() => setOpenId('__target__')}>
                {comps.targetPage.co.name} <span className="cp-pick-s">from the model</span>
              </button>
              {tiers.map((t) => {
                const inTier = peers.filter((p) => p.tierId === t.id);
                if (!inTier.length) return null;
                return (
                  <React.Fragment key={t.id}>
                    <div className="cp-list-h">{t.name}</div>
                    {inTier.map((p) => (
                      <button key={p.id} className={`cp-pick${openId === p.id ? ' on' : ''}`} onClick={() => setOpenId(p.id)}>{p.name}</button>
                    ))}
                  </React.Fragment>
                );
              })}
              {peers.some((p) => !tiers.find((t) => t.id === p.tierId)) && (
                <>
                  <div className="cp-list-h">Unassigned</div>
                  {peers.filter((p) => !tiers.find((t) => t.id === p.tierId)).map((p) => (
                    <button key={p.id} className={`cp-pick${openId === p.id ? ' on' : ''}`} onClick={() => setOpenId(p.id)}>{p.name}</button>
                  ))}
                </>
              )}
              <div className="sec-note" style={{ padding: '8px 4px 0' }}>Add, remove and re-tier peers in the Assumptions dock (press A).</div>
            </div>
            <div className="cp-body">
              {openId === '__target__' ? (
                <>
                  <div className="sec-note">
                    The target is derived from the shared model — company, drivers and the 3-statement — so it always
                    agrees with the DCF, LBO and IPO tabs. Edit it through the Assumptions dock, not here.
                  </div>
                  <CompanyPageEditor co={comps.targetPage.co} settings={s} onChange={() => {}} readOnly />
                </>
              ) : openCo ? (
                <CompanyPageEditor
                  co={openCo} settings={s} tiers={tiers}
                  onChange={(next) => setPeer(openCo.id, next)}
                  onDelete={() => { delPeer(openCo.id); setOpenId(peers.find((p) => p.id !== openCo.id)?.id ?? null); }}
                />
              ) : (
                <div className="sec-note">No peers yet — add one in the Assumptions dock (press A).</div>
              )}
            </div>
          </div>
        )}

        <h3 className="blocktitle">Bottom-up: peer multiple → implied share price ({CURRENCIES[s.currency].symbol})</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <thead>
              <tr><th></th><th>25th pct</th><th>Median</th><th>75th pct</th></tr>
            </thead>
            <tbody>
              {comps.rows.map((r) => {
                const steps = [r.q1, r.median, r.q3];
                const isPe = r.key === 'pe';
                const evs = steps.map((m) => m * r.metric);
                const eqs = steps.map((m) => (isPe ? m * r.metric : m * r.metric - comps.netDebt));
                return (
                  <React.Fragment key={r.key}>
                    <tr className="sechead"><td colSpan={4}>{r.label} × {r.metricLabel} ({fmtMoney(r.metric, s)})</td></tr>
                    <tr className="sub"><td>Multiple</td>{steps.map((m, i) => <td key={i}>{fmtX(m, 2)}</td>)}</tr>
                    {!isPe && <tr><td>Implied enterprise value</td>{evs.map((v, i) => <td key={i}>{fmtNum(v, 0, locale)}</td>)}</tr>}
                    {!isPe && <tr className="sub"><td>Less: Net debt</td>{steps.map((_, i) => <td key={i} className="neg">{fmtNum(-comps.netDebt, 0, locale)}</td>)}</tr>}
                    <tr><td>Implied equity value</td>{eqs.map((v, i) => <td key={i}>{fmtNum(v, 0, locale)}</td>)}</tr>
                    <tr className="sub"><td>÷ Shares outstanding</td>{steps.map((_, i) => <td key={i}>{fmtNum(a.company.sharesOut, 2, locale)}</td>)}</tr>
                    <tr className="bold"><td>Implied share price</td>{eqs.map((v, i) => <td key={i}>{fmtPrice(v / a.company.sharesOut, s)}</td>)}</tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="blocktitle">Regression method — EV/EBITDA vs growth</h3>
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">OLS fit: multiple = {reg.ok ? `${fmtNum(reg.intercept, 2, 'en-US')} + ${fmtNum(reg.slope, 3, 'en-US')} × growth` : 'n/m'}</div>
            {reg.ok ? (
              <LiveChart option={regOpt} height={280} />
            ) : (
              <div className="sec-note">{reg.reason}</div>
            )}
          </div>
          <div className="chartbox">
            <div className="ct">Regression statistics</div>
            {reg.ok ? (
              <table className="fin" style={{ fontSize: 12.5 }}>
                <tbody>
                  <tr><td>Observations</td><td>{reg.n}</td></tr>
                  <tr><td>Slope (x growth %)</td><td>{fmtNum(reg.slope, 4, 'en-US')}</td></tr>
                  <tr><td>Intercept</td><td>{fmtNum(reg.intercept, 3, 'en-US')}x</td></tr>
                  <tr><td>R²</td><td>{fmtNum(reg.r2, 3, 'en-US')}</td></tr>
                  <tr><td>Std error of estimate</td><td>{fmtNum(reg.se, 3, 'en-US')}x</td></tr>
                  <tr className="bold"><td>Target growth (Year 1)</td><td>{fmtPct(reg.targetGrowth, 1)}</td></tr>
                  <tr className="bold"><td>Regression multiple</td><td>{fmtX(reg.impliedMultiple, 2)}</td></tr>
                  <tr className="bold"><td>Implied price (±1 SE)</td><td>{fmtPrice(reg.impliedPrice, s)} ({fmtPrice(reg.impliedLow, s)}–{fmtPrice(reg.impliedHigh, s)})</td></tr>
                </tbody>
              </table>
            ) : (
              <div className="sec-note">{reg.reason}</div>
            )}
            <div className="sec-note" style={{ marginTop: 8 }}>
              The diamond marks the target priced on the fitted line. A high-growth target deserves a premium to the
              peer median — the regression quantifies how much. Low R² means growth explains little of the multiple
              spread; lean on the quartile ranges instead.
            </div>
          </div>
        </div>

        {reg.ok && (
          <>
            <h3 className="blocktitle">Regression in detail — the OLS worksheet</h3>
            <div className="grid2" style={{ marginBottom: 20 }}>
              <div className="tablewrap">
                <table className="fin">
                  <thead>
                    <tr><th>Peer</th><th>Growth x</th><th>EV/EBITDA y</th><th>Fitted ŷ</th><th>Residual e</th><th>e²</th></tr>
                  </thead>
                  <tbody>
                    {reg.pts.map((p) => {
                      const fit = reg.line(p.x);
                      const e = p.y - fit;
                      return (
                        <tr key={p.name}>
                          <td>{p.name}</td>
                          <td>{fmtPct(p.x, 1)}</td>
                          <td>{fmtX(p.y, 2)}</td>
                          <td>{fmtX(fit, 2)}</td>
                          <td className={e < 0 ? 'neg' : ''}>{fmtNum(e, 2, 'en-US')}</td>
                          <td>{fmtNum(e * e, 3, 'en-US')}</td>
                        </tr>
                      );
                    })}
                    <tr className="bold">
                      <td>Mean / Σ</td>
                      <td>{fmtPct(reg.mx, 2)}</td>
                      <td>{fmtX(reg.my, 2)}</td>
                      <td>{fmtX(reg.my, 2)}</td>
                      <td>{fmtNum(0, 2, 'en-US')}</td>
                      <td>{fmtNum(reg.sse, 3, 'en-US')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="tablewrap">
                <table className="fin">
                  <thead><tr><th>Step</th><th>Formula</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>Mean growth x̄</td><td>Σx / n</td><td>{fmtPct(reg.mx, 2)}</td></tr>
                    <tr><td>Mean multiple ȳ</td><td>Σy / n</td><td>{fmtX(reg.my, 2)}</td></tr>
                    <tr><td>Sxx</td><td>Σ(x − x̄)²</td><td>{fmtNum(reg.sxx, 2, 'en-US')}</td></tr>
                    <tr><td>Sxy</td><td>Σ(x − x̄)(y − ȳ)</td><td>{fmtNum(reg.sxy, 2, 'en-US')}</td></tr>
                    <tr><td>Syy</td><td>Σ(y − ȳ)²</td><td>{fmtNum(reg.syy, 2, 'en-US')}</td></tr>
                    <tr className="bold"><td>Slope b</td><td>Sxy / Sxx</td><td>{fmtNum(reg.slope, 4, 'en-US')}</td></tr>
                    <tr className="bold"><td>Intercept a</td><td>ȳ − b·x̄</td><td>{fmtNum(reg.intercept, 3, 'en-US')}x</td></tr>
                    <tr><td>R²</td><td>Sxy² / (Sxx·Syy)</td><td>{fmtNum(reg.r2, 3, 'en-US')}</td></tr>
                    <tr><td>SE of estimate</td><td>√(Σe² / (n − 2))</td><td>{fmtNum(reg.se, 3, 'en-US')}x</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="tablewrap" style={{ marginBottom: 20 }}>
              <table className="fin">
                <thead>
                  <tr><th>Bottom-up: regression multiple → price</th><th>−1 SE</th><th>Fitted</th><th>+1 SE</th></tr>
                </thead>
                <tbody>
                  <tr className="sub"><td>Multiple = a + b × target growth ({fmtPct(reg.targetGrowth, 1)})</td>
                    <td>{fmtX(reg.impliedMultiple - reg.se, 2)}</td><td>{fmtX(reg.impliedMultiple, 2)}</td><td>{fmtX(reg.impliedMultiple + reg.se, 2)}</td></tr>
                  <tr><td>× NTM EBITDA ({fmtMoney(reg.ntmEbitda, s)}) = EV</td>
                    {[-1, 0, 1].map((k) => <td key={k}>{fmtNum((reg.impliedMultiple + k * reg.se) * reg.ntmEbitda, 0, locale)}</td>)}</tr>
                  <tr className="sub"><td>Less: Net debt</td>
                    {[-1, 0, 1].map((k) => <td key={k} className="neg">{fmtNum(-reg.netDebt, 0, locale)}</td>)}</tr>
                  <tr><td>Equity value</td>
                    {[-1, 0, 1].map((k) => <td key={k}>{fmtNum((reg.impliedMultiple + k * reg.se) * reg.ntmEbitda - reg.netDebt, 0, locale)}</td>)}</tr>
                  <tr className="bold"><td>Implied share price (÷ {fmtNum(a.company.sharesOut, 2, locale)})</td>
                    <td>{fmtPrice(reg.impliedLow, s)}</td><td>{fmtPrice(reg.impliedPrice, s)}</td><td>{fmtPrice(reg.impliedHigh, s)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3 className="blocktitle">Implied valuation ranges</h3>
        <div className="chartbox">
          <FootballField
            items={[
              ...comps.rows.map((r) => ({ label: r.label, low: r.impliedLow, mid: r.impliedMedian, high: r.impliedHigh })),
              ...(reg.ok ? [{ label: 'Regression (±1 SE)', low: reg.impliedLow, mid: reg.impliedPrice, high: reg.impliedHigh, color: '#22D3EE' }] : []),
            ]}
            currentPrice={a.company.currentPrice}
            fmt={(v) => fmtNum(v, 0, locale)}
          />
        </div>

        <div className="footer-note">
          EV multiples apply to NTM metrics and bridge to equity via current net debt; P/E applies straight to NTM net
          income. Bars span the 25th–75th percentile with the median marked. The regression line prices the target's
          own growth rather than assuming it deserves the peer median. Edit the peer set in the Assumptions dock (A).
        </div>
    </div>
  );
}
