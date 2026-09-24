import React, { useMemo } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { themed, xCat, yVal, tipBy, vgrad, valueLabels, scenGhostSeries, COL } from '../lib/chartkit.js';
import { Anim } from '../lib/anim.jsx';
import { requestAssumption } from '../lib/assume.js';
import { applyScenario, SCENARIOS } from '../lib/engine/scenario.js';
import { computeDcf, dcfSensitivity, dcfHistory, cagr } from '../lib/engine/dcf.js';
import { computeCompany } from '../lib/engine/compsCo.js';
import { unleverBeta } from '../lib/engine/wacc.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { editDriverValue } from '../lib/driverEdit.js';
import { periodLabels } from '../lib/period.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES, UNITS } from '../lib/format.js';

export default function DcfTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const dcf = useMemo(() => computeDcf(am), [am]);
  const sens = useMemo(() => dcfSensitivity(am), [am]);
  const baseOps = useMemo(() => projectOperations(a), [a]);
  const canEdit = (a.settings.scenario || 'base') === 'base';
  const ed = (line, mode, raw, abs = false) =>
    canEdit
      ? { values: raw, onChange: (i, v) => set('drivers.perYear', editDriverValue(a, line, mode, i, abs ? Math.abs(v) : v)) }
      : undefined;
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const num = (v) => fmtNum(v, 0, locale);
  const pct = (v) => fmtPct(v, 1);
  const unitLabel = `${CURRENCIES[s.currency].symbol} ${UNITS[s.unit]}`;

  const n = dcf.ops.n;
  const yearLabels = useMemo(() => periodLabels(s, 'Y', n), [s, n]);

  /* ---- back-cast historical columns, matching the exported DCF sheet ---- */
  const HIST = 3;
  const showHist = a.settings.dcfHist ?? true;
  const hist = useMemo(() => dcfHistory(am, HIST), [am]);
  const baseYear = (s.period?.startYear ?? new Date().getFullYear()) - 1;
  const histLabels = showHist ? Array.from({ length: HIST }, (_, i) => String(baseYear - HIST + i)) : [];
  const cagrLabels = showHist ? [`${HIST}-yr CAGR`, `${n}-yr CAGR`] : [];
  const lead = (arr) => (showHist ? arr : undefined);
  const trail = (histArr, ltmVal, projArr) => (showHist
    ? [cagr(histArr[0], ltmVal, HIST) * 100, cagr(ltmVal, projArr[projArr.length - 1], n) * 100]
    : undefined);

  /* ---- cost of capital: the peer set's unlevered beta, as on the WACC sheet ---- */
  const waccPeers = useMemo(() => (a.comps?.peers || []).map((co) => {
    const pg = computeCompany(co);
    const de = pg.equityValue > 0 ? pg.bs.debt[1] / pg.equityValue : NaN;
    return {
      name: co.name, beta: Number(co.beta), debt: pg.bs.debt[1], equity: pg.equityValue, de,
      tax: Number(co.taxRate),
      unlevered: isFinite(de) ? unleverBeta(Number(co.beta), de, Number(co.taxRate)) : NaN,
    };
  }), [a.comps?.peers]);
  const betaStats = useMemo(() => {
    const fin = (k) => waccPeers.map((p) => p[k]).filter(isFinite).sort((x, y) => x - y);
    const mean = (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);
    const med = (v) => (v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN);
    const u = fin('unlevered'), b = fin('beta'), d = fin('de');
    return { meanU: mean(u), medU: med(u), meanB: mean(b), medB: med(b), meanDe: mean(d), medDe: med(d) };
  }, [waccPeers]);
  const ltmDa = hist.rates.rDa * a.drivers.revenue0;
  const ltmEbit = dcf.ops.ebitda0 - ltmDa;
  const targetDe = a.wacc.debtWeight < 100 ? (a.wacc.debtWeight / 100) / (1 - a.wacc.debtWeight / 100) : NaN;
  const relevered = betaStats.meanU * (1 + (1 - a.company.taxRate / 100) * targetDe);

  /* ---- WACC sensitivity: capital structure x pre-tax cost of debt ---- */
  const waccGrid = useMemo(() => {
    const wdSteps = [-10, -5, 0, 5, 10].map((d) => Math.min(90, Math.max(0, a.wacc.debtWeight + d)));
    const kdSteps = [-1, -0.5, 0, 0.5, 1].map((d) => a.wacc.costDebt + d);
    const t = a.company.taxRate / 100;
    const bu = dcf.unleveredBeta;
    const grid = wdSteps.map((wd) => kdSteps.map((kd) => {
      const de = wd < 100 ? (wd / 100) / (1 - wd / 100) : Infinity;
      const bl = bu * (1 + (1 - t) * de);
      const coe = a.wacc.riskFree + bl * a.wacc.erp + a.wacc.sizePremium;
      return (wd / 100) * kd * (1 - t) + (1 - wd / 100) * coe;
    }));
    return { wdSteps, kdSteps, grid };
  }, [a.wacc, a.company.taxRate, dcf.unleveredBeta]);

  // dashed Bear/Bull ghost lines (and Base, when a scenario view is active) for the charts
  const scenOn = a.settings.scenOverlay ?? true;
  const scenario = a.settings.scenario || 'base';
  const scenDcf = useMemo(
    () => (scenOn
      ? Object.keys(SCENARIOS).filter((k) => k !== scenario)
          .map((k) => [k, computeDcf(applyScenario({ ...a, settings: { ...a.settings, scenario: k } }))])
      : []),
    [a, scenOn, scenario],
  );

  // projection chart — bars + margin line with an average-margin reference
  const avgMargin = dcf.ops.margin.reduce((x, v) => x + v, 0) / n;
  const projOpt = useMemo(() => themed({
    tooltip: tipBy({ 'Margin %': (v) => fmtPct(v, 1) }, (v) => fmtNum(v, 0, locale)),
    xAxis: xCat(yearLabels),
    yAxis: [
      yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmtNum(v, 0, locale) } }),
      yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}%' } }),
    ],
    series: [
      { name: 'Revenue', type: 'bar', barMaxWidth: 26, itemStyle: { color: vgrad(COL.tealDeep), borderRadius: [3, 3, 0, 0] }, data: dcf.ops.revenue.map(Math.round) },
      { name: 'EBITDA', type: 'bar', barMaxWidth: 26, itemStyle: { color: vgrad(COL.teal), borderRadius: [3, 3, 0, 0] }, label: valueLabels((v) => fmtNum(v, 0, locale), n), data: dcf.ops.ebitda.map(Math.round) },
      {
        name: 'Margin %', yAxisIndex: 1, type: 'line', smooth: true, showSymbol: true, symbolSize: 6,
        lineStyle: { width: 2.4, color: COL.gold }, itemStyle: { color: COL.gold },
        data: dcf.ops.margin.map((v) => +v.toFixed(2)),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed', width: 1, opacity: 0.6 }, label: { color: COL.gold, fontSize: 9.5, fontFamily: 'Inter, sans-serif', formatter: `avg ${fmtPct(avgMargin, 1)}`, position: 'insideEndTop' }, data: [{ yAxis: +avgMargin.toFixed(2) }] },
      },
      ...scenDcf.map(([k, d]) => scenGhostSeries(k, SCENARIOS[k].label, d.ops.ebitda.map(Math.round))),
    ],
  }, { zoom: n > 9 }), [dcf, yearLabels, locale, n, avgMargin, scenDcf]);

  // free-cash-flow chart — FCFF/FCFE bars, discounted PV line, cumulative PV
  const cumPv = dcf.pv.map((_, i) => Math.round(dcf.pv.slice(0, i + 1).reduce((x, v) => x + v, 0)));
  const fcfOpt = useMemo(() => themed({
    tooltip: tipBy({}, (v) => fmtNum(v, 0, locale)),
    xAxis: xCat(yearLabels),
    yAxis: yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmtNum(v, 0, locale) } }),
    series: [
      { name: 'FCFF', type: 'bar', barMaxWidth: 24, itemStyle: { color: vgrad(COL.teal), borderRadius: [3, 3, 0, 0] }, label: valueLabels((v) => fmtNum(v, 0, locale), n), data: dcf.fcff.map(Math.round) },
      { name: 'FCFE', type: 'bar', barMaxWidth: 24, itemStyle: { color: vgrad(COL.violet), borderRadius: [3, 3, 0, 0] }, data: dcf.fcfe.map(Math.round) },
      { name: 'PV of FCFF', type: 'line', smooth: true, showSymbol: true, symbolSize: 5, lineStyle: { width: 2, color: COL.green, type: 'dashed' }, itemStyle: { color: COL.green }, data: dcf.pv.map(Math.round) },
      { name: 'Cumulative PV', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 1.4, color: COL.cyan, opacity: 0.8 }, itemStyle: { color: COL.cyan }, data: cumPv },
      ...scenDcf.map(([k, d]) => scenGhostSeries(k, SCENARIOS[k].label, d.fcff.map(Math.round))),
    ],
  }, { zoom: n > 9 }), [dcf, yearLabels, locale, n, scenDcf]); // eslint-disable-line react-hooks/exhaustive-deps

  const waccTooLow = dcf.wacc <= am.dcf.terminalGrowth;
  const coeTooLow = dcf.costEquity <= am.dcf.terminalGrowth;
  const primary = a.dcf.primaryTV;


  return (
    <div className="view">
        <Hero
          eyebrow={`Discounted cash flow — implied share price (${primary === 'gordon' ? 'Gordon growth' : 'exit multiple'} primary)`}
          value={dcf.primary.price}
          fmt={(v) => fmtPrice(v, s)}
          sub={`FCFF discounted at ${fmtPct(dcf.wacc, 2)} WACC; FCFE at ${fmtPct(dcf.costEquity, 2)} cost of equity (${a.wacc.betaMode === 'hamada' ? `Hamada \u03b2L ${fmtNum(dcf.leveredBeta, 2, 'en-US')} from \u03b2U ${fmtNum(dcf.unleveredBeta, 2, 'en-US')} at D/E ${fmtNum(dcf.de, 2, 'en-US')}` : `\u03b2L ${fmtNum(dcf.leveredBeta, 2, 'en-US')} direct input, implied \u03b2U ${fmtNum(dcf.unleveredBeta, 2, 'en-US')}`}). Drag any slider \u2014 every figure on this page flows to its new value.`}
          chips={[
            ...(a.company.currentPrice > 0 ? [{ label: dcf.primary.price >= a.company.currentPrice ? 'upside' : 'downside', value: Math.abs((dcf.primary.price / a.company.currentPrice - 1) * 100), fmt: (v) => fmtPct(v, 1), tone: dcf.primary.price >= a.company.currentPrice ? 'pos' : 'neg' }] : []),
            { label: 'FCFE', value: dcf.fcfeGordon.price, fmt: (v) => fmtPrice(v, s) },
            { label: 'EV', value: dcf.primary.ev, fmt: (v) => fmtMoney(v, s) },
            { label: 'WACC', value: dcf.wacc, fmt: (v) => fmtPct(v, 2) },
          ]}
        />
        {waccTooLow && (
          <div className="warn">
            Terminal growth ({fmtPct(a.dcf.terminalGrowth)}) ≥ WACC ({fmtPct(dcf.wacc, 2)}) — the FCFF Gordon terminal
            value is undefined.
          </div>
        )}
        {coeTooLow && !waccTooLow && (
          <div className="warn">
            Terminal growth ({fmtPct(a.dcf.terminalGrowth)}) ≥ cost of equity ({fmtPct(dcf.costEquity, 2)}) — the FCFE
            Gordon terminal value is undefined.
          </div>
        )}
        <div className="cards">
          <div className="card hero">
            <div className="k">FCFF price (Gordon / exit multiple)</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={dcf.gordon.price} fmt={(v) => fmtPrice(v, s)} /> / <Anim value={dcf.exit.price} fmt={(v) => fmtPrice(v, s)} />
            </div>
            <div className="s">TV {fmtPct(dcf.tvPctOfEv.gordon, 0)} / {fmtPct(dcf.tvPctOfEv.exit, 0)} of EV</div>
          </div>
          <div className="card">
            <div className="k">FCFE price (Gordon / exit P/E)</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={dcf.fcfeGordon.price} fmt={(v) => fmtPrice(v, s)} /> / <Anim value={dcf.fcfeExit.price} fmt={(v) => fmtPrice(v, s)} />
            </div>
            <div className="s">Discounted at CoE {fmtPct(dcf.costEquity, 2)}</div>
          </div>
          <div className="card">
            <div className="k">Enterprise value (FCFF)</div>
            <div className="v" style={{ fontSize: 17 }}>
              <Anim value={dcf.gordon.ev} fmt={(v) => fmtMoney(v, s)} /> / <Anim value={dcf.exit.ev} fmt={(v) => fmtMoney(v, s)} />
            </div>
            <div className="s">Gordon / exit · net debt {fmtMoney(dcf.netDebt, s)}</div>
          </div>
          <div className="card">
            <div className="k">WACC · CoE · βL</div>
            <div className="v" style={{ fontSize: 17 }}>
              {fmtPct(dcf.wacc, 2)} · {fmtPct(dcf.costEquity, 2)}
            </div>
            <div className="s">β levered {fmtNum(dcf.leveredBeta, 3, 'en-US')} (βU {fmtNum(dcf.unleveredBeta, 2, 'en-US')}, {a.wacc.betaMode === 'hamada' ? 'Hamada' : 'direct'})</div>
          </div>
        </div>

        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Projection — Revenue & EBITDA ({unitLabel}), margin %</div>
            <LiveChart
              option={projOpt} height={250} group="dcf-tab"
              onEvents={{ click: (p) => requestAssumption(p.seriesName === 'Revenue'
                ? { labels: ['Revenue growth — Year 1'], section: 'Operating Drivers' }
                : { labels: ['EBITDA margin — Year 1'], section: 'Operating Drivers' }) }}
            />
          </div>
          <div className="chartbox">
            <div className="ct">Free cash flows — FCFF vs FCFE, PV & cumulative PV ({unitLabel})</div>
            <LiveChart
              option={fcfOpt} height={250} group="dcf-tab"
              onEvents={{ click: (p) => requestAssumption({
                FCFE: { labels: ['Interest rate on debt', 'Mandatory debt repayment'], section: 'Financing & Policy' },
                'PV of FCFF': { labels: ['Equity risk premium'], section: 'Cost of Capital (WACC)' },
                'Cumulative PV': { labels: ['Equity risk premium'], section: 'Cost of Capital (WACC)' },
              }[p.seriesName] || { labels: ['EBITDA margin — Year 1', 'Capex (% of revenue)'], section: 'Operating Drivers' }) }}
            />
          </div>
        </div>

        <div className="grid2">
          <div className="chartbox">
            <div className="ct">EV → equity bridge (FCFF {primary === 'gordon' ? 'Gordon' : 'exit'}, {unitLabel})</div>
            <Waterfall
              items={[
                { label: 'PV of FCFF', value: dcf.pvSum },
                { label: 'PV of TV', value: primary === 'gordon' ? dcf.pvTvGordon : dcf.pvTvExit },
                { label: 'Enterprise value', value: dcf.primary.ev, total: true },
                { label: 'Less: gross debt', value: -a.company.grossDebt },
                { label: 'Add: cash', value: a.company.cash },
                { label: 'Equity value', value: dcf.primary.equity, total: true },
              ]}
              fmt={num}
            />
          </div>
          <div className="chartbox">
            <div className="ct">Terminal value — how much of enterprise value it carries</div>
            <Waterfall
              items={[
                { label: 'PV of explicit FCFF', value: dcf.pvSum },
                { label: primary === 'gordon' ? 'PV of Gordon TV' : 'PV of exit-multiple TV', value: primary === 'gordon' ? dcf.pvTvGordon : dcf.pvTvExit },
                { label: 'Enterprise value', value: dcf.primary.ev, total: true },
              ]}
              fmt={num}
            />
            <div className="sec-note" style={{ marginTop: 8 }}>
              The terminal value is {fmtPct(primary === 'gordon' ? dcf.tvPctOfEv.gordon : dcf.tvPctOfEv.exit, 0)} of
              enterprise value. Above roughly 75% the answer is mostly an assumption about year {n} and beyond — check
              both terminal methods agree in the cross-checks below.
            </div>
          </div>
        </div>

        <h3 className="blocktitle">
          Unlevered free cash flow ({unitLabel}) — type directly into blue cells
          <span className="viewtabs">
            <button className={`vt${showHist ? ' on' : ''}`} onClick={() => set('settings.dcfHist', true)}
              title="Show the back-cast historical period and CAGR columns, as on the exported DCF sheet">Historical + CAGR</button>
            <button className={`vt${!showHist ? ' on' : ''}`} onClick={() => set('settings.dcfHist', false)}
              title="Projection only">Projection only</button>
          </span>
        </h3>
        {showHist && (
          <div className="sec-note">
            The historical columns are <b>back-cast</b>, not reported: growth and margin are the Year-1 rates extended
            backwards, D&amp;A / capex / NWC hold their Year-1 revenue rates. The LTM column is the model's own Year 0,
            so LTM EBITDA here is the same figure the LBO entry multiple and the comps target use.
          </div>
        )}
        <StatementTable labels={yearLabels}
          years={dcf.ops.years}
          showYear0
          leadLabels={histLabels}
          trailLabels={cagrLabels}
          leadGroup={showHist ? 'Historical period (back-cast)' : undefined}
          trailGroup={showHist ? 'CAGR' : undefined}
          rows={[
            { label: 'Sales', values: dcf.ops.revenue, year0: a.drivers.revenue0, fmt: num, bold: true,
              lead: lead(hist.revenue), trail: trail(hist.revenue, a.drivers.revenue0, dcf.ops.revenue), trailFmt: pct,
              edit: ed('revenue', 'abs', baseOps.revenue, true) },
            { label: '% growth', values: dcf.ops.growth, year0: hist.ltmGrowth, fmt: pct, sub: true,
              lead: lead(hist.growth), edit: ed('revenue', 'growth', baseOps.growth) },
            { label: 'Less: Operating costs', values: dcf.ops.revenue.map((r, i) => r - dcf.ops.ebitda[i]), year0: a.drivers.revenue0 - dcf.ops.ebitda0, fmt: num, sub: true,
              lead: lead(hist.revenue.map((r, i) => r - hist.ebitda[i])) },
            { label: 'EBITDA', values: dcf.ops.ebitda, year0: dcf.ops.ebitda0, fmt: num, bold: true,
              lead: lead(hist.ebitda), trail: trail(hist.ebitda, dcf.ops.ebitda0, dcf.ops.ebitda), trailFmt: pct,
              edit: ed('ebitda', 'abs', baseOps.ebitda, true) },
            { label: '% margin', values: dcf.ops.margin, year0: dcf.ops.margin[0], fmt: pct, sub: true,
              lead: lead(hist.margin), edit: ed('ebitda', 'margin', baseOps.margin) },
            { label: 'Less: D&A', values: dcf.ops.da, year0: ltmDa, fmt: num, sub: true,
              lead: lead(hist.da), edit: ed('da', 'abs', baseOps.da, true) },
            { label: 'EBIT', values: dcf.ops.ebit, year0: ltmEbit, fmt: num, bold: true,
              lead: lead(hist.ebit), trail: trail(hist.ebit, ltmEbit, dcf.ops.ebit), trailFmt: pct },
            { label: 'Less: Taxes', values: dcf.ops.ebit.map((e) => e * (a.company.taxRate / 100)), year0: ltmEbit * (a.company.taxRate / 100), fmt: num, sub: true,
              lead: lead(hist.taxes) },
            { label: 'EBIAT', values: dcf.nopat, year0: ltmEbit * (1 - a.company.taxRate / 100), fmt: num, bold: true, lead: lead(hist.ebiat) },
            { label: 'Plus: D&A', values: dcf.ops.da, year0: ltmDa, fmt: num, sub: true, lead: lead(hist.da) },
            { label: 'Less: Capex', values: dcf.ops.capex, fmt: num, sub: true,
              lead: lead(hist.capex), edit: ed('capex', 'abs', baseOps.capex, true) },
            { label: 'Memo: NWC balance', values: dcf.ops.nwcBalance, year0: dcf.ops.nwc0, fmt: num, sub: true,
              lead: lead(hist.nwcBalance) },
            { label: 'Less: Inc./(Dec.) in NWC', values: dcf.ops.deltaNwc, fmt: num, sub: true,
              lead: lead(hist.nwcBalance.map((v, i) => (i === 0 ? null : v - hist.nwcBalance[i - 1]))),
              edit: ed('nwcDelta', 'abs', baseOps.deltaNwc) },
            { label: 'Unlevered free cash flow', values: dcf.fcff, fmt: num, bold: true,
              trail: showHist ? [null, cagr(dcf.fcff[0], dcf.fcff[n - 1], n - 1) * 100] : undefined, trailFmt: pct },
            { label: 'Discount period', values: dcf.period, fmt: (v) => fmtNum(v, 2, 'en-US'), sub: true },
            { label: 'Discount factor @ WACC', values: dcf.df, fmt: (v) => fmtNum(v, 3, 'en-US'), sub: true },
            { label: 'PV of FCFF', values: dcf.pv, fmt: num, bold: true },
            { label: 'Cumulative PV of FCFF', values: dcf.pv.map((_, i) => dcf.pv.slice(0, i + 1).reduce((s, v) => s + v, 0)), fmt: num, sub: true },
          ]}
        />
        <div className="edit-note">
          {canEdit
            ? '✎ Blue cells are direct inputs — click any figure and type, exactly like a spreadsheet. Editing Revenue/EBITDA/D&A/Capex switches that line to absolute per-year values; Growth/Margin keeps it in %. D&A and Capex take magnitudes; Δ NWC moves that year\u2019s working-capital balance.'
            : 'Switch the scenario to Base to type into the cells (scenario views are read-only).'}
        </div>

        <h3 className="blocktitle">FCFE build ({unitLabel})</h3>
        <StatementTable labels={yearLabels}
          years={dcf.ops.years}
          rows={[
            { label: 'FCFF', values: dcf.fcff, fmt: num },
            { label: 'Opening debt', values: dcf.openDebt, fmt: num, sub: true },
            { label: 'Less: Interest × (1−t)', values: dcf.interest.map((v) => -v * (1 - a.company.taxRate / 100)), fmt: num },
            { label: 'Add: Net borrowing (−repayment)', values: dcf.netBorrow, fmt: num },
            { label: 'FCFE', values: dcf.fcfe, fmt: num, bold: true },
            { label: 'Opening cash', values: dcf.openCash, fmt: num, sub: true },
            { label: 'Add: Interest income on cash', values: dcf.interestInc, fmt: num, sub: true },
            { label: 'Net income — 3-stmt basis (for exit P/E)', values: dcf.niDcf, fmt: num, sub: true },
            { label: 'Discount factor @ CoE', values: dcf.dfE, fmt: (v) => fmtNum(v, 3, 'en-US'), sub: true },
            { label: 'PV of FCFE', values: dcf.pvE, fmt: num, bold: true },
          ]}
        />

        <h3 className="blocktitle">Enterprise value → implied share price</h3>
        <div className="grid2" style={{ marginBottom: 20 }}>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Enterprise Value</th><th>Perpetuity growth</th><th>Exit multiple</th></tr></thead>
              <tbody>
                <tr><td>Cumulative PV of FCF</td><td>{num(dcf.pvSum)}</td><td>{num(dcf.pvSum)}</td></tr>
                <tr className="sub"><td>Terminal-year free cash flow</td><td>{num(dcf.fcff[n - 1])}</td><td>—</td></tr>
                <tr className="sub"><td>Perpetuity growth rate</td><td>{fmtPct(am.dcf.terminalGrowth, 1)}</td><td>—</td></tr>
                <tr className="sub"><td>Terminal-year EBITDA</td><td>—</td><td>{num(dcf.ops.ebitda[n - 1])}</td></tr>
                <tr className="sub"><td>Exit multiple</td><td>—</td><td>{fmtX(am.dcf.exitMultiple, 2)}</td></tr>
                <tr><td>Terminal value</td><td>{num(dcf.tvGordon)}</td><td>{num(dcf.tvExit)}</td></tr>
                <tr><td>PV of terminal value</td><td>{num(dcf.pvTvGordon)}</td><td>{num(dcf.pvTvExit)}</td></tr>
                <tr className="sub"><td>% of enterprise value</td><td>{fmtPct(dcf.tvPctOfEv.gordon, 1)}</td><td>{fmtPct(dcf.tvPctOfEv.exit, 1)}</td></tr>
                <tr className="bold"><td>Enterprise value</td><td>{num(dcf.gordon.ev)}</td><td>{num(dcf.exit.ev)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Implied Equity Value and Share Price</th><th>Perpetuity growth</th><th>Exit multiple</th></tr></thead>
              <tbody>
                <tr><td>Enterprise value</td><td>{num(dcf.gordon.ev)}</td><td>{num(dcf.exit.ev)}</td></tr>
                <tr className="sub"><td>Less: total debt</td><td className="neg">{num(-a.company.grossDebt)}</td><td className="neg">{num(-a.company.grossDebt)}</td></tr>
                <tr className="sub"><td>Plus: cash &amp; equivalents</td><td>{num(a.company.cash)}</td><td>{num(a.company.cash)}</td></tr>
                <tr className="bold"><td>Implied equity value</td><td>{num(dcf.gordon.equity)}</td><td>{num(dcf.exit.equity)}</td></tr>
                <tr className="sub"><td>÷ Fully diluted shares</td><td>{fmtNum(a.company.sharesOut, 2, locale)}</td><td>{fmtNum(a.company.sharesOut, 2, locale)}</td></tr>
                <tr className="bold"><td>Implied share price</td><td>{fmtPrice(dcf.gordon.price, s)}</td><td>{fmtPrice(dcf.exit.price, s)}</td></tr>
                {a.company.currentPrice > 0 && (
                  <tr className="sub"><td>Premium / (discount) to market</td>
                    <td>{fmtPct((dcf.gordon.price / a.company.currentPrice - 1) * 100, 1)}</td>
                    <td>{fmtPct((dcf.exit.price / a.company.currentPrice - 1) * 100, 1)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <h3 className="blocktitle">Levered (FCFE) valuation</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <thead><tr><th>Method</th><th>TV</th><th>PV of TV</th><th>Equity</th><th>Price</th><th>TV % of value</th></tr></thead>
            <tbody>
              <tr>
                <td>FCFE — Gordon @ CoE {fmtPct(dcf.costEquity, 2)}</td>
                <td>{num(dcf.tvFcfeGordon)}</td><td>{num(dcf.pvTvFcfeGordon)}</td>
                <td>{num(dcf.fcfeGordon.equity)}</td><td><b>{fmtPrice(dcf.fcfeGordon.price, s)}</b></td><td>{fmtPct(dcf.tvPctOfEv.fcfeGordon, 0)}</td>
              </tr>
              <tr>
                <td>FCFE — Exit {fmtX(a.dcf.exitPE, 1)} P/E</td>
                <td>{num(dcf.tvFcfePE)}</td><td>{num(dcf.pvTvFcfePE)}</td>
                <td>{num(dcf.fcfeExit.equity)}</td><td><b>{fmtPrice(dcf.fcfeExit.price, s)}</b></td><td>—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="blocktitle">Terminal value cross-checks</h3>
        <div className="grid2" style={{ marginBottom: 20 }}>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Gordon TV sanity — implied exit multiple</th><th></th></tr></thead>
              <tbody>
                <tr><td>Terminal-year FCFF (Y{dcf.ops.n})</td><td>{num(dcf.fcff[dcf.ops.n - 1])}</td></tr>
                <tr><td>Terminal growth g</td><td>{fmtPct(am.dcf.terminalGrowth, 1)}</td></tr>
                <tr><td>Gordon terminal value</td><td>{num(dcf.tvGordon)}</td></tr>
                <tr><td>Terminal-year EBITDA (Y{dcf.ops.n})</td><td>{num(dcf.ops.ebitda[dcf.ops.n - 1])}</td></tr>
                <tr className="bold"><td>Implied exit EV / EBITDA</td><td>{fmtX(dcf.impliedExitMultiple, 2)}</td></tr>
                <tr className="sub"><td>vs your exit-multiple assumption</td><td>{fmtX(am.dcf.exitMultiple, 2)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Exit-multiple TV sanity — implied perpetuity growth</th><th></th></tr></thead>
              <tbody>
                <tr><td>Exit terminal value ({fmtX(am.dcf.exitMultiple, 1)} × Y{dcf.ops.n} EBITDA)</td><td>{num(dcf.tvExit)}</td></tr>
                <tr><td>WACC</td><td>{fmtPct(dcf.wacc, 2)}</td></tr>
                <tr className="bold">
                  <td>Implied perpetuity growth rate</td>
                  <td>{fmtPct(dcf.impliedPerpGrowth, 2)}</td>
                </tr>
                {a.dcf.midYear && (
                  <tr className="sub"><td colSpan={2}>Mid-year is on, so the terminal flow is grossed up by (1+WACC)^0.5 before it is capitalised — otherwise this reads low.</td></tr>
                )}
                <tr className="sub"><td>vs your terminal-growth assumption</td><td>{fmtPct(am.dcf.terminalGrowth, 1)}</td></tr>
                <tr className="sub"><td colSpan={2}>If the implied g looks like GDP-plus-a-lot, the exit multiple is doing too much work — and vice versa. The two TV methods should roughly agree.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <h3 className="blocktitle">Cost of capital — the WACC build</h3>
        <div className="grid2" style={{ marginBottom: 20 }}>
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>WACC calculation</th><th></th></tr></thead>
              <tbody>
                <tr className="sechead"><td colSpan={2}>Target capital structure</td></tr>
                <tr><td>Debt-to-total capitalization</td><td>{fmtPct(a.wacc.debtWeight, 1)}</td></tr>
                <tr><td>Equity-to-total capitalization</td><td>{fmtPct(100 - a.wacc.debtWeight, 1)}</td></tr>
                <tr className="sub"><td>Debt / equity</td><td>{fmtPct(targetDe * 100, 1)}</td></tr>
                <tr className="sechead"><td colSpan={2}>Cost of debt</td></tr>
                <tr><td>Pre-tax cost of debt</td><td>{fmtPct(a.wacc.costDebt, 1)}</td></tr>
                <tr><td>Marginal tax rate</td><td>{fmtPct(a.company.taxRate, 1)}</td></tr>
                <tr className="bold"><td>After-tax cost of debt</td><td>{fmtPct(dcf.afterTaxKd, 2)}</td></tr>
                <tr className="sechead"><td colSpan={2}>Cost of equity</td></tr>
                <tr><td>Risk-free rate</td><td>{fmtPct(a.wacc.riskFree, 2)}</td></tr>
                <tr><td>Market risk premium</td><td>{fmtPct(a.wacc.erp, 2)}</td></tr>
                <tr><td>Levered beta {a.wacc.betaMode === 'hamada' ? '(Hamada)' : '(direct)'}</td><td>{fmtNum(dcf.leveredBeta, 3, 'en-US')}</td></tr>
                <tr><td>Size / alpha premium</td><td>{fmtPct(a.wacc.sizePremium, 2)}</td></tr>
                <tr className="bold"><td>Cost of equity (CAPM)</td><td>{fmtPct(dcf.costEquity, 2)}</td></tr>
                <tr className="bold"><td>WACC</td><td>{fmtPct(dcf.wacc, 2)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="tablewrap">
            <table className="fin">
              <thead>
                <tr><th>Comparable companies unlevered beta</th><th>Levered β</th><th>Debt</th><th>Equity</th><th>D/E</th><th>Tax</th><th>Unlevered β</th></tr>
              </thead>
              <tbody>
                {waccPeers.length === 0 && (
                  <tr><td colSpan={7} className="txt">Add comparable companies in the Comps tab to derive an unlevered beta from the peer set.</td></tr>
                )}
                {waccPeers.map((p) => (
                  <tr key={p.name}>
                    <td className="txt">{p.name}</td>
                    <td>{fmtNum(p.beta, 2, 'en-US')}</td>
                    <td>{num(p.debt)}</td>
                    <td>{num(p.equity)}</td>
                    <td>{fmtPct(p.de * 100, 1)}</td>
                    <td>{fmtPct(p.tax, 1)}</td>
                    <td>{fmtNum(p.unlevered, 2, 'en-US')}</td>
                  </tr>
                ))}
                {waccPeers.length > 0 && (
                  <>
                    <tr className="bold"><td>Mean</td><td>{fmtNum(betaStats.meanB, 2, 'en-US')}</td><td /><td /><td>{fmtPct(betaStats.meanDe * 100, 1)}</td><td /><td>{fmtNum(betaStats.meanU, 2, 'en-US')}</td></tr>
                    <tr className="sub"><td>Median</td><td>{fmtNum(betaStats.medB, 2, 'en-US')}</td><td /><td /><td>{fmtPct(betaStats.medDe * 100, 1)}</td><td /><td>{fmtNum(betaStats.medU, 2, 'en-US')}</td></tr>
                    <tr className="sechead"><td colSpan={7}>Relevered at the target structure — reference</td></tr>
                    <tr><td>Peer mean unlevered β relevered at D/E {fmtPct(targetDe * 100, 1)}</td><td colSpan={5} /><td><b>{fmtNum(relevered, 2, 'en-US')}</b></td></tr>
                    <tr><td>Your levered β — drives the WACC above</td><td colSpan={5} /><td><b>{fmtNum(dcf.leveredBeta, 2, 'en-US')}</b></td></tr>
                  </>
                )}
              </tbody>
            </table>
            <div className="sec-note" style={{ marginTop: 8 }}>
              Reference only — the discount rate uses your own beta, so the app and the exported workbook always agree.
              If the relevered peer beta sits far from your input, revisit it in the dock.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div className="sec-note">WACC: capital structure (rows) × pre-tax cost of debt (cols) — beta is relevered in every cell</div>
          <Heatmap corner="D/(D+E) \\ kd" rowLabels={waccGrid.wdSteps} colLabels={waccGrid.kdSteps} grid={waccGrid.grid}
            fmt={(v) => fmtPct(v, 2)} fmtRow={(v) => fmtPct(v, 0)} fmtCol={(v) => fmtPct(v, 1)} />
        </div>

        <h3 className="blocktitle">Sensitivity — implied share price</h3>
        <div className="grid2">
          <div>
            <div className="sec-note">FCFF: WACC (rows) × terminal growth (cols)</div>
            <Heatmap corner="WACC \ g" rowLabels={sens.waccSteps} colLabels={sens.gSteps} grid={sens.gordonGrid}
              fmt={(v) => fmtNum(v, 0, locale)} fmtRow={(v) => fmtPct(v, 1)} fmtCol={(v) => fmtPct(v, 1)} />
          </div>
          <div>
            <div className="sec-note">FCFF: WACC (rows) × exit EV/EBITDA (cols)</div>
            <Heatmap corner="WACC \ x" rowLabels={sens.waccSteps} colLabels={sens.mSteps} grid={sens.exitGrid}
              fmt={(v) => fmtNum(v, 0, locale)} fmtRow={(v) => fmtPct(v, 1)} fmtCol={(v) => fmtX(v, 1)} />
          </div>
          <div>
            <div className="sec-note">FCFE: cost of equity (rows) × terminal growth (cols)</div>
            <Heatmap corner="CoE \ g" rowLabels={sens.coeSteps} colLabels={sens.gSteps} grid={sens.fcfeGrid}
              fmt={(v) => fmtNum(v, 0, locale)} fmtRow={(v) => fmtPct(v, 1)} fmtCol={(v) => fmtPct(v, 1)} />
          </div>
        </div>

        <div className="footer-note">
          FCFF = EBIT × (1 − t) + D&A − capex − ΔNWC discounted at WACC{a.dcf.midYear ? ' (mid-year convention, t − 0.5)' : ''};
          FCFE = FCFF − interest × (1 − t) + net borrowing discounted at the cost of equity, using the same debt schedule
          as the 3-statement model (interest on opening balances, {fmtPct(a.ts.debtRepayPct, 0)} mandatory repayment).
          Gordon TVs are discounted on the same mid-year basis; exit-multiple TVs assume a year-end sale.
        </div>
    </div>
  );
}
