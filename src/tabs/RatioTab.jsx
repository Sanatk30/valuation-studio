import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Hero from '../components/Hero.jsx';
import EChart, { themed, xCat, yVal, tipBy, COL } from '../lib/echart.jsx';
import { applyScenario } from '../lib/engine/scenario.js';
import { projectPeriods, projectHistoryPeriods } from '../lib/engine/periodModel.js';
import { computeRatios } from '../lib/engine/ratios.js';
import { FREQS, freqWord } from '../lib/period.js';
import { fmtPct, fmtX, fmtNum, fmtPrice, CURRENCIES } from '../lib/format.js';

const FREQ_KEYS = ['Y', 'H', 'Q'];

/** The ratio table scrolls horizontally (20 columns at quarterly), but a chart
 *  row must stay the width of the VISIBLE viewport — sticky at the left edge —
 *  or it stretches across the whole scroll width and runs off-screen. */
function ChartCell({ children }) {
  const ref = useRef(null);
  const [w, setW] = useState(null);
  useLayoutEffect(() => {
    const wrap = ref.current?.closest('.tablewrap');
    if (!wrap) return;
    const upd = () => setW(wrap.clientWidth);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="ratio-chart" style={{ position: 'sticky', left: 0, width: w ? w - 2 : undefined, boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

export default function RatioTab({ a, set }) {
  const freq = a.settings.ratioFreq || 'Y';
  const scen = a.settings.scenario || 'base';
  const histYears = a.settings.ratioHistYears ?? 5;
  const span = a.settings.ratioSpan || 'past';
  // Past = the model back-cast from today's balance sheet (historical ratio
  // analysis, History slider sets how many years); Future = the projection
  // horizon. Built under all three scenarios so every ratio chart can overlay
  // a Bear/Base/Bull band.
  const built = useMemo(() => {
    const make = (sc) => {
      const asc = applyScenario({ ...a, settings: { ...a.settings, scenario: sc } });
      const pmsc = span === 'future' ? projectPeriods(asc, freq) : projectHistoryPeriods(asc, freq, histYears);
      return { pm: pmsc, R: computeRatios(pmsc) };
    };
    return { bear: make('bear'), base: make('base'), bull: make('bull') };
  }, [a, freq, histYears, span]);
  const pm = built[scen].pm;
  const R = built[scen].R;
  const pick = (sc, secTitle, label) => { const se = built[sc].R.sections.find((x) => x.title === secTitle); const row = se && se.rows.find((x) => x.label === label); return row ? row.vals : []; };
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const [open, setOpen] = useState(() => new Set());
  const toggleRow = (key) => setOpen((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const cell = (fmt, v) => {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (fmt === 'pct') return fmtPct(v, 1);
    if (fmt === 'x') return fmtX(v, 2);
    if (fmt === 'price') return fmtPrice(v, s);
    if (fmt === 'num') return fmtNum(v, 0, locale);
    return fmtNum(v, 2, locale);
  };
  const tfmt = (fmt) => (fmt === 'pct' ? (v) => fmtPct(v, 1) : fmt === 'x' ? (v) => fmtX(v, 2) : fmt === 'price' ? (v) => fmtPrice(v, s) : (v) => fmtNum(v, 0, locale));
  const find = (label) => { for (const sec of R.sections) { const r = sec.rows.find((x) => x.label === label); if (r) return r.vals; } return []; };

  // inline chart for a single ratio: Bear/Base/Bull overlay + shaded scenario band,
  // with the active scenario drawn bold (like ACTUAL vs baselines).
  const rowOption = (r, secTitle) => {
    const f = tfmt(r.fmt);
    const num = (v) => (isFinite(v) ? +v.toFixed(4) : null);
    const bear = pick('bear', secTitle, r.label);
    const base = pick('base', secTitle, r.label);
    const bull = pick('bull', secTitle, r.label);
    const N = R.labels.length;
    const idx = [...Array(N).keys()];
    const lows = [], ups = [];
    idx.forEach((i) => {
      const vs = [bear[i], base[i], bull[i]].filter(isFinite);
      if (vs.length) { lows.push(+Math.min(...vs).toFixed(4)); ups.push(+(Math.max(...vs) - Math.min(...vs)).toFixed(4)); }
      else { lows.push(null); ups.push(null); }
    });
    const activeVals = scen === 'bear' ? bear : scen === 'bull' ? bull : base;
    const finite = activeVals.filter(isFinite);
    const mean = finite.length ? finite.reduce((x, y) => x + y, 0) / finite.length : null;

    // near-constant series: pin the y-axis to a tight padded window, otherwise
    // ECharts spreads a flat line across a huge default range
    const allFin = [...bear, ...base, ...bull].filter(isFinite);
    const lo = Math.min(...allFin), hi = Math.max(...allFin);
    let yBounds = {};
    if (allFin.length && hi - lo < Math.max(1e-9, Math.abs(hi) * 0.02)) {
      const pad = Math.max(Math.abs(hi) * 0.12, hi === 0 ? 1 : 1e-6);
      yBounds = { min: +(lo - pad).toFixed(4), max: +(hi + pad).toFixed(4) };
    }

    const line = (name, vals, color, key) => ({
      name, type: 'line', smooth: true, showSymbol: N <= 12 && key === scen, symbolSize: 6, z: key === scen ? 6 : 3,
      lineStyle: { width: key === scen ? 3.2 : 1.6, color, type: key === scen ? 'solid' : 'dashed', opacity: key === scen ? 1 : 0.85 },
      itemStyle: { color }, data: vals.map(num),
      ...(key === scen ? {
        markPoint: finite.length > 1 ? { symbolSize: 44, itemStyle: { color: 'transparent' }, label: { color: COL.axisStrong, fontFamily: 'Inter, sans-serif', fontSize: 10, formatter: (p) => f(p.value) }, data: [{ type: 'max' }, { type: 'min' }] } : undefined,
        markLine: mean !== null ? { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed', width: 1 }, label: { color: COL.gold, fontSize: 10, formatter: `avg ${f(mean)}`, position: 'insideEndTop' }, data: [{ yAxis: mean }] } : undefined,
      } : {}),
    });

    return themed({
      tooltip: tipBy({}, f),
      legend: { top: 2, icon: 'circle', data: ['Bear', 'Base', 'Bull'], textStyle: { color: COL.axis, fontSize: 11 }, inactiveColor: '#4A5264' },
      grid: { left: 8, right: 20, top: 30, bottom: pm.N > 10 ? 46 : 16, containLabel: true },
      xAxis: xCat(R.labels, { boundaryGap: false, axisLabel: { color: COL.axis, fontSize: 10, interval: pm.N > 12 ? Math.floor(pm.N / 10) : 0, rotate: pm.N > 8 ? 28 : 0 } }),
      yAxis: yVal({ scale: true, ...yBounds, axisLabel: { color: COL.axis, formatter: r.fmt === 'pct' ? '{value}%' : r.fmt === 'x' ? '{value}x' : undefined } }),
      ...(pm.N > 10 ? { dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6, fillerColor: 'rgba(108,140,255,0.16)', borderColor: 'transparent', handleStyle: { color: COL.teal }, textStyle: { color: COL.axis, fontSize: 9 } }] } : {}),
      series: [
        { name: '_lo', type: 'line', stack: 'band', data: lows, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, symbol: 'none', silent: true, tooltip: { show: false }, z: 0 },
        { name: 'Scenario range', type: 'line', stack: 'band', data: ups, lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(108,140,255,0.1)' }, symbol: 'none', silent: true, tooltip: { show: false }, z: 0 },
        line('Bear', bear, COL.red, 'bear'),
        line('Base', base, COL.teal, 'base'),
        line('Bull', bull, COL.green, 'bull'),
      ],
    });
  };

  const past = span !== 'future';
  // headline period: LTM (latest) for history, Year 1 for the projection
  const ref = past ? R.N - 1 : Math.min(pm.m - 1, R.N - 1);
  const refLbl = past ? 'LTM' : 'Y1';

  return (
    <div className="view">
        <Hero
          eyebrow={`${a.company.name} — ratio analysis · ${past ? `past ${histYears} years` : `projection · next ${pm.ny} years`} · ${freqWord(freq).toLowerCase()} · ${R.labels[0]}–${R.labels[R.labels.length - 1]}`}
          value={R.sections.reduce((n, x) => n + x.rows.length, 0)}
          fmt={(v) => `${Math.round(v)} ratios`}
          sub={past
            ? `Historical ratio analysis: the past ${histYears} years back-cast from today's balance sheet and the driver set (growth & margin fades extended backwards; history lands exactly on current debt, cash and PP&E). Click any ratio row to open its trend chart inline. Balance sheet ties at every period ${R.balanceOk ? '✓' : '✗'}.`
            : `Forward ratio analysis over the ${pm.ny}-year projection (set the horizon with Projection years in the dock). Click any ratio row to open its trend chart inline. Balance sheet ties at every period ${R.balanceOk ? '✓' : '✗'}.`}
          chips={[
            { label: 'periods', text: `${R.N}` },
            { label: `EPS ${refLbl}`, value: find('EPS (ann.)')[ref], fmt: (v) => fmtPrice(v, s) },
            { label: `ROE ${refLbl}`, value: find('Return on equity (ROE)')[ref], fmt: (v) => fmtPct(v, 1) },
            { label: `Net debt/EBITDA ${refLbl}`, value: find('Net debt / EBITDA (ann.)')[ref], fmt: (v) => fmtX(v, 2) },
          ]}
        />

        <div className="ratio-bar">
          <div className="seg" style={{ margin: 0 }}>
            <button className={past ? 'on' : ''} onClick={() => set('settings.ratioSpan', 'past')} title="Historical ratios — the past years, back-cast to today's balance sheet">Past</button>
            <button className={!past ? 'on' : ''} onClick={() => set('settings.ratioSpan', 'future')} title="Forward ratios — the projection years">Future</button>
          </div>
          <div className="seg" style={{ margin: 0 }}>
            {FREQ_KEYS.map((k) => (
              <button key={k} className={freq === k ? 'on' : ''} onClick={() => set('settings.ratioFreq', k)}>{FREQS[k].label}</button>
            ))}
          </div>
          {past ? (
            <label className="ratio-hist" title="How many past years the ratio analysis covers">
              <span>History</span>
              <input
                type="range" min={2} max={10} step={1} value={histYears}
                style={{ '--fill': `${((histYears - 2) / 8) * 100}%` }}
                onChange={(e) => set('settings.ratioHistYears', +e.target.value)}
              />
              <b>{histYears}y</b>
            </label>
          ) : (
            <span className="ratio-hint">horizon = Projection years ({pm.ny}y, set in the dock)</span>
          )}
          <span className="ratio-hint">Tip: click a ratio to chart it inline{open.size ? ` · ${open.size} open` : ''}</span>
          {open.size > 0 && <button className="pyfill" onClick={() => setOpen(new Set())}>Collapse all</button>}
        </div>

        {R.sections.map((sec) => {
          const tag = {
            'Profitability & margins': 'MARGIN', 'Returns (annualised) & DuPont': 'RETURN',
            'Leverage & solvency': 'LEV', 'Coverage': 'COVER', 'Efficiency & liquidity': 'EFF',
            'Per share': 'PS', 'Cash flow': 'CF', 'Growth': 'GROWTH', 'Valuation (at current price)': 'VAL',
          }[sec.title] || 'RATIO';
          const nOpen = sec.rows.filter((r) => open.has(`${sec.title}::${r.label}`)).length;
          return (
            <div className="stmt-block" key={sec.title}>
              <div className="stmt-head">
                <span className="stmt-tag">{tag}</span>
                <h3>{sec.title}</h3>
                <span className="stmt-note">{sec.rows.length} ratios{nOpen ? ` · ${nOpen} charted` : ''} · click a row to chart it</span>
              </div>
              <div className="tablewrap">
                <table className="fin ratio-table">
                  <thead>
                    <tr>
                      <th>Ratio</th>
                      {R.labels.map((l, i) => <th key={i}>{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r) => {
                      const key = `${sec.title}::${r.label}`;
                      const isOpen = open.has(key);
                      return (
                        <React.Fragment key={key}>
                          <tr className={`ratio-row${isOpen ? ' open' : ''}`} onClick={() => toggleRow(key)} title="Click to chart this ratio inline">
                            <td><span className="ratio-caret">{isOpen ? '▾' : '▸'}</span>{r.label}</td>
                            {r.vals.map((v, i) => <td key={i}>{cell(r.fmt, v)}</td>)}
                          </tr>
                          {isOpen && (
                            <tr className="ratio-chart-row">
                              <td colSpan={R.labels.length + 1}>
                                <ChartCell>
                                  <div className="ratio-chart-cap">{r.label}<span> · {freqWord(freq).toLowerCase()} · Bear/Base/Bull overlay · latest {cell(r.fmt, [...r.vals].reverse().find((v) => isFinite(v)))}</span></div>
                                  <EChart option={rowOption(r, sec.title)} group="ratio-tab" style={{ height: 260 }} />
                                </ChartCell>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        <div className="footer-note">
          {past
            ? <>Ratio analysis runs on the PAST {histYears} years (drag the History slider for more or fewer), ending at the
              LTM year. History is back-cast from the same driver set: growth and margin fades extended backwards from
              Year 1, D&amp;A/capex/NWC at their Year-1 revenue rates, and the debt/cash/PP&amp;E schedule reverse-recursed so
              the final period lands exactly on today's balance sheet. Replace the drivers or balance-sheet inputs with a
              company's actuals (Enter Data, or the top-bar company search) and the history re-casts accordingly. </>
            : <>Ratio analysis runs FORWARD over the {pm.ny}-year projection — the same driver set as the DCF, 3-statement,
              LBO and IPO tabs (change Projection years in the dock to extend the horizon). Switch to Past for the
              historical view back-cast from today's balance sheet. </>}
          “(ann.)” marks figures scaled to an annual basis for comparability; valuation lines use the current share price.
        </div>
    </div>
  );
}
