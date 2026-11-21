import React, { useMemo } from 'react';
import Heatmap from '../components/Heatmap.jsx';
import CalcMap from '../components/CalcMap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import { computeDcfT, CF_KINDS, dcfDriverDefs, exitMultipleName } from '../lib/engine/dcfTemplate.js';
import { fmtTpl, fmtDate } from '../lib/format.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, upsidePct, rnd, tone, attempt } from './parts/format.js';
import { themed, xCat, yVal, tipBy, COL, barSeries, lineSeries, moneyAxis, axisName, projectionOption } from './parts/charts.js';

/**
 * DCF output — the chosen template's valuation sheet (cash flows, discounting,
 * terminal value, equity bridge, value per share and the cross-check), its
 * 5 × 5 sensitivity table, and the Forecast, Assumptions and cost-of-capital
 * sheets behind it. Every figure is the engine's (dcfTemplate.js), which
 * reproduces the template's formulas.
 */
export default function DcfOutput({ a, onEdit }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => computeDcfT(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The DCF" error={model.error} /></div>;
  return <DcfPage a={a} f={f} r={model.value} onEdit={onEdit} />;
}

const num = (v) => (fin(v) ? v : NaN);
/** A KPI's text when the template cell reads NM (a KPI with a finite value animates it instead). */
const nm = (v) => (fin(v) ? undefined : 'NM');

function DcfPage({ a, f, r, onEdit }) {
  const v = r.valuation;
  const L = f.locale;
  const t = (x, fmt = 'n1') => fmtTpl(x, fmt, L);
  const px = r.price;
  const hasPx = fin(px) && px > 0;
  const cfK = CF_KINDS.find((k) => k.value === r.cf);
  const rateName = r.cf === 'fcff' ? 'WACC' : 'Cost of equity (Ke)';
  const multName = exitMultipleName(r.cf);
  const n = r.n, m = r.m;
  const F = r.F;
  const allLabels = [...r.labels.hist, ...r.labels.fcst];
  const fc = r.labels.fcst;
  const cashLabel = r.cf === 'fcff' ? 'Free Cash Flow to Firm' : r.cf === 'fcfe' ? 'Free Cash Flow to Equity' : 'Dividends';
  const tvName = r.tv === 'exit' ? `exit ${multName}` : 'Gordon growth';

  /* ---------------- charts ---------------- */
  const projOpt = projectionOption(f, allLabels, {
    revenue: F.rev, ebitda: F.ebitda, margin: F.margin.map((x) => (fin(x) ? x * 100 : NaN)),
  }, { nHist: n, cash: { name: cashLabel.replace('Free Cash Flow to Firm', 'FCFF').replace('Free Cash Flow to Equity', 'FCFE'), data: [...Array(n).fill(null), ...r.flows.cash] } });
  const cashOpt = themed({
    tooltip: tipBy({ 'Discount factor': (x) => (fin(x) ? x.toFixed(3) : '—') }, f.num),
    xAxis: xCat(fc),
    yAxis: [moneyAxis(f, axisName(f.unitLabel, 14)), yVal({ position: 'right', min: 0, max: 1, splitLine: { show: false }, ...axisName('discount factor', 14), axisLabel: { color: COL.axis, formatter: (x) => x.toFixed(1) } })],
    series: [
      barSeries(cashLabel, COL.tealDeep, r.flows.cash.map((x) => rnd(x))),
      barSeries('Present value', COL.teal, v.pv.map((x) => rnd(x))),
      lineSeries('Discount factor', COL.gold, v.df.map((x) => (fin(x) ? +x.toFixed(4) : null)), { yAxisIndex: 1, dashed: true, width: 1.6 }),
    ],
  });
  const bridge = [
    // short labels: six categories share the chart's width without rotation
    { label: 'PV forecast', value: v.sumPv },
    { label: 'PV terminal', value: num(v.pvTv) },
    ...(r.cf === 'fcff'
      ? [{ label: 'EV', value: num(v.ev), total: true }, { label: '− Net debt', value: -v.netDebt }, { label: '− NCI', value: -v.nci }, ...(v.nonOp ? [{ label: '+ Investments', value: v.nonOp }] : [])]
      : []),
    { label: 'Equity', value: num(v.equity), total: true },
  ];
  const bridgeOk = bridge.every((b) => fin(b.value));

  /* ---------------- valuation sheet ---------------- */
  const flowRows = r.cf === 'fcff'
    ? [['EBIT', r.flows.ebit], ['(−) Taxes on EBIT', r.flows.taxEbit], ['NOPAT', r.flows.nopat, true], ['(+) Depreciation & Amortisation', r.flows.da], ['(−) Capex', r.flows.capex], ['(−) Increase in NWC', r.flows.dNwc], ['(−) Lease cost (Ind AS 116)', r.flows.lease]]
    : r.cf === 'fcfe'
      ? [['PAT', r.flows.pat], ['(+) Depreciation & Amortisation', r.flows.da], ['(−) Capex', r.flows.capex], ['(−) Increase in NWC', r.flows.dNwc], ['(+) Net Borrowing / (Repayment)', r.flows.netBorrow], ['(−) Lease payments', r.flows.lease]]
      : [['PAT', r.flows.pat], ['Dividend payout (% of PAT)', r.flows.payout, false, 'pct']];
  const valRows = [
    ['Sum of PV of forecast cash flows', t(v.sumPv)],
    ...(r.tv === 'gordon'
      ? [
        ['Terminal growth rate (g)', t(v.g, 'pct')],
        ['Final-year cash flow (as forecast)', t(v.lastCash)],
        ...(r.cf === 'fcff' ? [['Final-year cash flow before ΔNWC', t(v.baseCash)], ['Final-year net working capital (grows at g)', t(v.growBase)]] : []),
        ...(r.cf === 'fcfe' ? [['Final-year cash flow before ΔNWC and borrowing', t(v.baseCash)], ['Final-year NWC less closing debt (both grow at g)', t(v.growBase)]] : []),
        ...(r.cf === 'ddm' ? [['Final-year PAT', t(v.finalPat)], ['Final-year ROE (on opening equity)', t(v.finalRoe, 'pct')], ['Sustainable payout = 1 − g ÷ ROE', t(v.payoutSust, 'pct')]] : []),
        [`Terminal-year cash flow (Year N+1)${v.normalise ? ' — normalised' : ''}`, t(v.nextCash)],
      ]
      : [[`Final-year ${r.cf === 'fcff' ? 'EBITDA' : 'PAT'}`, t(v.metric)], [`Exit ${multName} multiple`, t(v.multiple, 'x')]]),
    ['Terminal value', t(v.tv), true],
    ['Terminal value discount period (years)', t(v.tvPeriod, 'n2')],
    ['PV of terminal value', t(v.pvTv)],
    ...(r.cf === 'fcff'
      ? [['Enterprise Value', t(v.ev), true], ['(−) Net debt / (net cash)', t(v.netDebt)], ['(−) Non-controlling interest', t(v.nci)], ['(+) Non-operating investments', t(v.nonOp)]]
      : []),
    ['Equity Value', t(v.equity), true],
    [`Diluted shares outstanding (${f.unit})`, t(v.shares, 'n2')],
    [`Value per Share (${f.sym})`, t(v.perShare, 'n2'), true],
    [`Current share price (${f.sym})`, t(v.price, 'n2')],
    ['Upside / (Downside)', t(v.upside, 'pct')],
    ['Terminal value as % of total value', t(v.tvShare, 'pct')],
    ...(r.tv === 'gordon'
      ? [
        [r.cf === 'fcff' ? 'Implied terminal EV / EBITDA (TV ÷ final-year EBITDA)' : 'Implied terminal P / E (TV ÷ final-year PAT)', t(v.implied, 'x')],
        ...(r.cf === 'fcff' ? [['Terminal reinvestment rate', t(v.reinvestRate, 'pct')], ['Implied return on new invested capital (g ÷ reinvestment rate)', t(v.ronic, 'pct')]] : []),
        ...(r.cf === 'ddm' ? [['Final-year sustainable growth (ROE × retention)', t(fin(v.sustGrowth) ? v.sustGrowth : 'NM', 'pct')]] : []),
      ]
      : [['Implied perpetual growth rate', t(v.implied, 'pct')]]),
  ];
  const stubText = v.stub < 1 ? `a stub of ${v.stub.toFixed(2)} of Year 1` : 'the full first year';
  const timing = `${v.mid ? 'mid-year' : 'end-of-year'} discounting from ${r.settings.valDate ? fmtDate(r.settings.valDate) : 'the latest fiscal year end'} (${stubText})`;

  /* ---------------- forecast sheet ---------------- */
  const FROWS = [
    ['INCOME STATEMENT'],
    ['Revenue from Operations', F.rev, 'n1', true], ['  Growth %', F.growth, 'pct'],
    ['Cost of Materials', F.materials], ['Employee Benefits Expense', F.employee], ['Other Expenses', F.otherExp],
    ['Total Operating Expenses', F.opex, 'n1', true], ['EBITDA', F.ebitda, 'n1', true], ['  EBITDA margin', F.margin, 'pct'],
    ['Depreciation & Amortisation', F.da], ['EBIT', F.ebit, 'n1', true], ['Other Income', F.otherInc], ['Finance Costs', F.finance],
    ['Exceptional Items', F.exceptional], ['Profit Before Tax', F.pbt, 'n1', true], ['Tax Expense', F.tax],
    ['PAT (attributable to owners)', F.pat, 'n1', true], [`Diluted EPS (${f.sym})`, F.eps, 'n2'], ['Dividends', F.dividends],
    [`Dividend per Share (${f.sym})`, F.dps, 'n2'],
    ['WORKING CAPITAL'],
    ['Inventories', F.inv], ['Trade Receivables', F.rec], ['Other Current Assets', F.oca], ['Trade Payables', F.pay],
    ['Other Current Liabilities & Provisions', F.ocl], ['Net Working Capital', F.nwc, 'n1', true], ['Increase / (Decrease) in NWC', F.dNwc],
    ['CAPEX & DEBT SCHEDULE'],
    ['Capex', F.capex], ['Opening Debt', F.openDebt], ['Net Borrowing / (Repayment)', F.netBorrow], ['Closing Debt (Borrowings)', F.closeDebt, 'n1', true],
    ['  Interest rate on opening debt', F.intRate, 'pct'],
    ...(r.cf === 'fcff' ? [['LEASES (Ind AS 116)'], ['Lease cash payments', F.leasePay], ['New leases / ROU additions (lease capex)', F.leaseAdd], ['Lease cost used in FCFF (per the toggle)', F.leaseCost, 'n1', true]]
      : r.cf === 'fcfe' ? [['LEASES (Ind AS 116)'], ['Lease cash payments', F.leasePay]]
        : [['BOOK EQUITY ROLL-FORWARD'], ['Opening equity attributable to owners', F.eqOpen], ['Return on opening equity (ROE)', F.roe, 'pct'], ['Closing equity (opening + PAT − dividends)', F.eqClose, 'n1', true]]),
  ];

  const w = r.wacc;
  const coe = r.coe;

  return (
    <div className="qo">
      <DcfMap r={r} f={f} t={t} onEdit={onEdit} />
      {fin(num(v.tvShare)) && v.tvShare > 0.75 && <div className="warn2" style={{ marginBottom: 16 }}>The terminal value is {t(v.tvShare, 'pct')} of the total — above ~75% the value depends heavily on the terminal assumptions.</div>}
      {r.blankYears.length > 0 && <div className="warn2" style={{ marginBottom: 16 }}>Blank drivers in {r.blankYears.map((j) => fc[j]).join(', ')} count as 0, as in the template — fill them on the Assumptions step.</div>}

      <Sections>
        <Collapsible title={`${cfK.label} — ${r.tv === 'exit' ? 'Terminal value: exit multiple' : 'Terminal value: Gordon growth'}`} tag="VALUATION" defaultOpen>
          <div className="tablewrap">
            <table className="fin compact tpl-val">
              <thead><tr><th>{f.unitLabel}</th>{fc.map((l) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                <tr className="sub"><td>Share of year&apos;s cash flow counted</td>{v.share.map((x, j) => <td key={j}>{t(x, 'n2')}</td>)}</tr>
                <tr className="sub"><td>Discount period (years from valuation date)</td>{v.period.map((x, j) => <td key={j}>{t(x, 'n2')}</td>)}</tr>
                {flowRows.map(([lab, vals, bold, fmt]) => (
                  <tr key={lab} className={bold ? 'bold' : ''}><td>{lab}</td>{vals.map((x, j) => <td key={j}>{t(x, fmt || 'n1')}</td>)}</tr>
                ))}
                {r.cf === 'ddm' && <tr><td>Dividends</td>{r.flows.cash.map((x, j) => <td key={j}>{t(x)}</td>)}</tr>}
                {r.cf === 'ddm' && <tr><td>Dividend per share ({f.sym})</td>{r.flows.dps.map((x, j) => <td key={j}>{t(x, 'n2')}</td>)}</tr>}
                {r.cf === 'ddm' && <tr><td>Return on opening equity (ROE)</td>{r.flows.roe.map((x, j) => <td key={j}>{t(x, 'pct')}</td>)}</tr>}
                {r.cf === 'ddm' && <tr><td>Closing book equity (owners)</td>{r.flows.eqClose.map((x, j) => <td key={j}>{t(x)}</td>)}</tr>}
                {r.cf !== 'ddm' && <tr className="bold tp-sub"><td>{cashLabel}</td>{r.flows.cash.map((x, j) => <td key={j}>{t(x)}</td>)}</tr>}
                <tr><td>Cash flow counted (× share of year)</td>{v.counted.map((x, j) => <td key={j}>{t(x)}</td>)}</tr>
                <tr><td>Discount factor</td>{v.df.map((x, j) => <td key={j}>{fin(x) ? x.toFixed(4) : ''}</td>)}</tr>
                <tr className="bold"><td>Present value</td>{v.pv.map((x, j) => <td key={j}>{t(x)}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <div className="tablewrap" style={{ maxWidth: 560, marginTop: 12 }}>
            <table className="fin compact">
              <thead><tr><th>Valuation</th><th>{f.unitLabel}</th></tr></thead>
              <tbody>
                {valRows.map(([lab, val, bold]) => <tr key={lab} className={bold ? 'bold tp-sub' : ''}><td>{lab}</td><td>{val}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="qo-note">The valuation date and the latest fiscal year end set the stub — only the part of Year 1 still to come is counted. {v.mid ? 'Mid-year convention: each cash flow is discounted from the middle of its period.' : 'End-of-year convention.'} A Gordon terminal value uses the final year&apos;s discount period; an exit-multiple terminal value is discounted from the end of the final year.{r.cf !== 'fcff' ? ' Equity cash flows are discounted at the cost of equity straight to equity value.' : ''}</div>
        </Collapsible>

        <Collapsible title={`Sensitivity — value per share (${f.sym}): ${rateName} (rows) × ${r.tv === 'exit' ? `exit ${multName}` : 'terminal growth'} (columns)`} tag="SENS" defaultOpen>
          <Heatmap
            corner={`${r.cf === 'fcff' ? 'WACC' : 'Ke'} ↓ / ${r.tv === 'exit' ? 'Multiple' : 'g'} →`}
            rowLabels={r.sens.rows} colLabels={r.sens.cols}
            grid={r.sens.grid.map((row) => row.map((x) => (fin(x) ? x : NaN)))}
            fmt={f.gridPrice} fmtRow={(x) => t(x, 'pct')} fmtCol={(x) => (r.tv === 'exit' ? t(x, 'x') : t(x, 'pct'))}
          />
          <div className="qo-note">Centre cell = the base case. Steps: {t(r.sens.rateStep, 'pct')} on the rate, {r.tv === 'exit' ? `${fmtTpl(r.sens.tvStep, 'x', L)} on the multiple` : `${t(r.sens.tvStep, 'pct')} on g`} (set on the Terminal value step). n/m = NM (rate ≤ g, or no shares).</div>
        </Collapsible>

        <Collapsible title="Forecast model" tag="FORECAST">
          <ChartBox title={`Revenue, EBITDA and ${r.cf === 'ddm' ? 'dividends' : r.cf.toUpperCase()} (${f.unitLabel}) — actual and forecast`} sub={`Actual years lighter, forecast shaded; EBITDA margin on the right axis${fin(F.rev[n - 1]) && F.rev[n - 1] > 0 && F.rev[n + m - 1] > 0 ? ` · revenue CAGR ${allLabels[n - 1]}–${allLabels[n + m - 1]}: ${((Math.pow(F.rev[n + m - 1] / F.rev[n - 1], 1 / m) - 1) * 100).toFixed(1)}%` : ''}`} option={projOpt} height={300} />
          <div className="tablewrap tp-grid">
            <table className="fin compact">
              <thead>
                <tr><th>{f.unitLabel}</th>{allLabels.map((l, i) => <th key={i} className={i < n ? 'dg-hist' : ''}>{l}</th>)}</tr>
              </thead>
              <tbody>
                {FROWS.map(([lab, vals, fmt, bold]) => (vals
                  ? <tr key={lab} className={bold ? 'tp-sub' : ''}><td>{lab}</td>{vals.map((x, i) => <td key={i} className={`${i < n ? 'dg-hist' : ''}${x === 'n.a.' ? ' tp-mute' : ''}`}>{t(x, fmt || 'n1')}</td>)}</tr>
                  : <tr key={lab} className="tp-sec dg-sec"><td colSpan={n + m + 1}>{lab}</td></tr>))}
              </tbody>
            </table>
          </div>
        </Collapsible>

        <Collapsible title="Assumptions (drivers)" tag="DRIVERS">
          <div className="tablewrap tp-grid">
            <table className="fin compact">
              <thead><tr><th>Driver</th>{allLabels.map((l, i) => <th key={i} className={i < n ? 'dg-hist' : ''}>{l}</th>)}</tr></thead>
              <tbody>
                {dcfDriverDefs(r.cf).map((d) => (d.section
                  ? <tr key={d.section} className="tp-sec dg-sec"><td colSpan={n + m + 1}>{d.section}</td></tr>
                  : (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      {r.ref[d.key].map((x, i) => <td key={`h${i}`} className={`dg-hist${x === 'n.a.' ? ' tp-mute' : ''}`}>{t(x, d.fmt === 'pct' ? 'pct' : d.fmt === 'days' ? 'n0' : 'n1')}</td>)}
                      {r.drivers[d.key].map((x, j) => <td key={`f${j}`}>{t(x, d.fmt === 'pct' ? 'pct' : d.fmt === 'days' ? 'n0' : 'n1')}</td>)}
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
          <div className="qo-note">Historical columns are ratios from the historicals (reference); forecast columns are your drivers. A blank driver counts as 0.</div>
        </Collapsible>

        <Collapsible title={r.cf === 'fcff' ? 'Cost of equity and WACC' : 'Cost of equity'} tag="RATE">
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin compact">
                <thead><tr><th>Cost of equity — {r.coeKind === 'capm' ? 'CAPM' : 'Build-Up'}</th><th>Value</th></tr></thead>
                <tbody>
                  {r.coeKind === 'capm' ? (
                    <>
                      <tr><td>Risk-free rate</td><td>{t(coe.rf, 'pct')}</td></tr>
                      <tr><td>Levered beta{a.dcf?.capm?.betaMode === 'hamada' ? ' (re-levered)' : ''}</td><td>{fmtTpl(coe.beta, 'n2', L)}</td></tr>
                      <tr><td>Equity risk premium</td><td>{t(coe.erp, 'pct')}</td></tr>
                      <tr className="bold tp-sub"><td>Cost of Equity (Ke)</td><td>{t(coe.ke, 'pct')}</td></tr>
                      <tr><td>Re-levered beta (helper)</td><td>{fmtTpl(coe.relevered, 'n2', L)}</td></tr>
                      {coe.peers.n > 0 && <tr><td>Peer unlevered beta — mean / median ({coe.peers.n})</td><td>{fmtTpl(coe.peers.mean, 'n2', L)} / {fmtTpl(coe.peers.median, 'n2', L)}</td></tr>}
                    </>
                  ) : (
                    <>
                      {[['Risk-free rate', coe.rf], ['Equity risk premium', coe.erp], ['Size premium', coe.size], ['Industry risk premium', coe.industry], ['Company-specific risk premium', coe.specific], ['Country risk premium', coe.country]]
                        .map(([lab, x]) => <tr key={lab}><td>{lab}</td><td>{t(x, 'pct')}</td></tr>)}
                      <tr className="bold tp-sub"><td>Cost of Equity (Ke)</td><td>{t(coe.ke, 'pct')}</td></tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {w && (
              <div className="tablewrap">
                <table className="fin compact">
                  <thead><tr><th>WACC</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>Cost of equity (Ke)</td><td>{t(w.ke, 'pct')}</td></tr>
                    <tr><td>Pre-tax cost of debt</td><td>{t(w.kd, 'pct')}</td></tr>
                    <tr><td>Marginal tax rate</td><td>{t(w.taxRate, 'pct')}</td></tr>
                    <tr><td>After-tax cost of debt</td><td>{t(w.kdAfter, 'pct')}</td></tr>
                    <tr><td>Market value of equity (reference)</td><td>{t(w.mve)}</td></tr>
                    <tr><td>Debt incl. leases per toggle (reference)</td><td>{t(w.debtRef)}</td></tr>
                    <tr><td>Current D / (D + E) (reference)</td><td>{t(w.currentWd, 'pct')}</td></tr>
                    <tr><td>Target D / (D + E)</td><td>{t(w.targetWd, 'pct')}</td></tr>
                    <tr className="bold tp-sub"><td>WACC</td><td>{t(w.wacc, 'pct')}</td></tr>
                    <tr className="tpl-stat-h"><td colSpan={2}>Net debt bridge (latest balance sheet)</td></tr>
                    <tr><td>Total borrowings</td><td>{t(r.bridge.borrowings)}</td></tr>
                    <tr><td>(+) Lease liabilities (per toggle)</td><td>{t(r.bridge.leases)}</td></tr>
                    <tr><td>(−) Cash, bank balances & current investments</td><td>{t(r.bridge.cash)}</td></tr>
                    <tr className="bold tp-sub"><td>Net Debt / (Net Cash)</td><td>{t(r.bridge.netDebt)}</td></tr>
                    <tr><td>Non-controlling interest</td><td>{t(r.bridge.nci)}</td></tr>
                    <tr><td>Non-current investments per balance sheet</td><td>{t(r.bridge.nonOpBook)}</td></tr>
                    <tr><td>Override: non-operating investments to add</td><td>{r.bridge.nonOpOverride === null ? '—' : t(r.bridge.nonOpOverride)}</td></tr>
                    <tr className="bold"><td>Non-operating investments added to equity</td><td>{t(r.bridge.nonOp)}</td></tr>
                    <tr><td>Override: net debt at valuation date</td><td>{r.bridge.netDebtOverride === null ? '—' : t(r.bridge.netDebtOverride)}</td></tr>
                    <tr className="bold tp-sub"><td>Net debt used in valuation</td><td>{t(r.bridge.netDebtUsed)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Collapsible>
      </Sections>
    </div>
  );
}

/** The DCF result as a calculation map (the approved Result design, option A). */
function DcfMap({ r, f, t, onEdit }) {
  const v = r.valuation, F = r.F, D = r.drivers, n = r.n, m = r.m;
  const fc = r.labels.fcst, last = fc[m - 1], base = r.labels.hist[n - 1];
  const p1 = (x) => (fin(x) ? `${(x * 100).toFixed(1)}%` : '—');
  const range = (arr) => (arr && arr.length ? (fin(arr[0]) && fin(arr[m - 1]) && Math.abs(arr[0] - arr[m - 1]) > 1e-9 ? `${p1(arr[0])} → ${p1(arr[m - 1])}` : p1(arr[0])) : '—');
  const go = (i) => (onEdit ? () => onEdit(i) : undefined);
  const money = (x) => (fin(x) ? `${f.sym}${t(x, 'n0')}` : 'NM');
  const ff = r.cf === 'fcff';
  const coe = r.coe, w = r.wacc;
  const cashName = ff ? 'Free cash flow' : r.cf === 'fcfe' ? 'FCFE' : 'Dividends';
  const sumCash = r.flows.cash.reduce((a2, x) => a2 + (fin(x) ? x : 0), 0);
  const cols = [
    { title: '1 · Your inputs', groups: [
      { name: 'Operations', nodes: [
        { id: 'i-g', label: 'Revenue growth', value: range(D.gRev), input: true, onClick: go(2) },
        { id: 'i-m', label: 'Materials, % of revenue', value: range(D.materials), input: true, onClick: go(2) },
        { id: 'i-t', label: 'Tax rate', value: range(D.tax), input: true, onClick: go(2) },
        { id: 'i-c', label: 'Capex, % of revenue', value: range(D.capex), input: true, onClick: go(2) },
        { id: 'i-w', label: 'Inventory days', value: fin(D.invDays?.[0]) ? `${Math.round(D.invDays[0])}` : '—', input: true, onClick: go(2) },
      ] },
      { name: 'Discount rate', nodes: r.coeKind === 'capm' ? [
        { id: 'i-rf', label: 'Risk-free rate', value: p1(coe.rf), input: true, onClick: go(3) },
        { id: 'i-b', label: 'Beta', value: fin(coe.beta) ? coe.beta.toFixed(2) : '—', input: true, onClick: go(3) },
        { id: 'i-erp', label: 'Equity risk premium', value: p1(coe.erp), input: true, onClick: go(3) },
        ...(w ? [{ id: 'i-kd', label: 'Cost of debt, after tax', value: p1(w.kdAfter), input: true, onClick: go(3) }] : []),
      ] : [
        { id: 'i-rf', label: 'Risk-free rate', value: p1(coe.rf), input: true, onClick: go(3) },
        { id: 'i-erp', label: 'Premia (ERP + others)', value: p1(coe.ke - coe.rf), input: true, onClick: go(3) },
        ...(w ? [{ id: 'i-kd', label: 'Cost of debt, after tax', value: p1(w.kdAfter), input: true, onClick: go(3) }] : []),
      ] },
      { name: 'Terminal', nodes: [
        r.tv === 'exit' ? { id: 'i-tg', label: `Exit ${exitMultipleName(r.cf)}`, value: t(v.multiple, 'x'), input: true, onClick: go(4) }
          : { id: 'i-tg', label: 'Terminal growth', value: p1(v.g), input: true, onClick: go(4) },
      ] },
    ] },
    { title: '2 · Forecast', groups: [
      { nodes: [
        { id: 'c-rev', label: `Revenue ${last}`, value: money(F.rev[n + m - 1]), sub: `from ${money(F.rev[n - 1])} in ${base}`, spark: F.rev },
        { id: 'c-ebitda', label: `EBITDA ${last}`, value: money(F.ebitda[n + m - 1]), sub: `margin ${p1(F.margin[n + m - 1])}` },
        ff ? { id: 'c-nopat', label: `NOPAT ${last}`, value: money(r.flows.nopat[m - 1]), sub: `after tax on EBIT` } : { id: 'c-nopat', label: `PAT ${last}`, value: money(F.pat[n + m - 1]), sub: 'after interest and tax' },
        { id: 'c-cash', label: `${cashName} ${fc[0]}–${last}`, value: money(sumCash), sub: `${m} years · shown below`, spark: r.flows.cash, sel: true },
      ] },
      { name: 'Discount rate', nodes: [
        { id: 'c-ke', label: 'Cost of equity', value: p1(coe.ke), sub: r.coeKind === 'capm' ? `${p1(coe.rf)} + ${fin(coe.beta) ? coe.beta.toFixed(2) : '—'} × ${p1(coe.erp)}` : 'build-up' },
        ...(w ? [{ id: 'c-wacc', label: 'WACC', value: p1(w.wacc), sub: `equity ${p1(w.targetWe)} · debt ${p1(w.targetWd)}` }] : []),
      ] },
    ] },
    { title: '3 · Value', groups: [
      { nodes: [
        { id: 'v-pv', label: 'PV of forecast cash flows', value: money(v.sumPv), sub: `discounted ${v.mid ? 'mid-year' : 'end-year'} at ${p1(v.rate)}` },
        { id: 'v-tv', label: 'PV of terminal value', value: money(v.pvTv), sub: `${r.tv === 'exit' ? 'exit multiple' : `Gordon growth at ${p1(v.g)}`} · ${fin(v.tvShare) ? (v.tvShare * 100).toFixed(1) : '—'}% of value` },
        ...(ff ? [
          { id: 'v-ev', label: 'Enterprise value', value: money(v.ev), sub: 'forecast + terminal' },
          { id: 'v-bs', label: 'Net debt, NCI, investments', value: money(-(v.netDebt || 0) - (v.nci || 0) + (v.nonOp || 0)), sub: 'from the balance sheet', onClick: go(3) },
        ] : []),
        { id: 'v-eq', label: 'Equity value', value: money(v.equity), sub: fin(v.shares) ? `÷ ${t(v.shares, 'n2')} ${f.unit} diluted shares` : 'no share count' },
      ] },
    ] },
  ];
  const edges = [
    ['i-g', 'c-rev', 1], ['i-m', 'c-ebitda'], ['i-t', 'c-nopat'], ['i-c', 'c-cash', 1], ['i-w', 'c-cash'],
    ['i-rf', 'c-ke'], ['i-b', 'c-ke'], ['i-erp', 'c-ke'], ['i-kd', 'c-wacc'], ['i-tg', 'v-tv', 1],
    ['c-cash', 'v-pv', 1], ['c-cash', 'v-tv', 1], ['c-wacc', 'v-pv'], ['c-ke', 'v-pv'],
    ['v-pv', 'v-ev', 1], ['v-tv', 'v-ev', 1], ['v-ev', 'v-eq', 1], ['v-bs', 'v-eq'], ['v-pv', 'v-eq', !ff], ['v-tv', 'v-eq', !ff],
    ['v-eq', 'res', 1],
  ];
  const px = r.price, hasPx = fin(px) && px > 0;
  const up = hasPx && fin(v.perShare) ? v.perShare / px - 1 : null;
  const lastEbitda = F.ebitda[n - 1];
  return (
    <CalcMap cols={cols} edges={edges} result={{
      id: 'res', title: '4 · Result', label: 'Value per share', value: fin(v.perShare) ? f.price(v.perShare) : 'NM',
      sub: up !== null ? `${up >= 0 ? '▲' : '▼'} ${Math.abs(up * 100).toFixed(1)}% vs market ${f.price(px)}` : 'no current price', tone: up === null ? '' : up >= 0 ? 'up' : 'dn',
      rows: [['Equity value', money(v.equity)], ...(ff ? [['Enterprise value', money(v.ev)], ['Implied EV / EBITDA', fin(v.ev) && lastEbitda > 0 ? `${(v.ev / lastEbitda).toFixed(1)}x` : 'NM']] : [])],
      action: { label: 'Open sensitivity', onClick: () => {
        // open the section if it was closed, then bring it into view
        const el = document.querySelector('.qo-coll[data-title^="Sensitivity"]');
        if (!el) return;
        if (!el.classList.contains('open')) el.querySelector('.qo-coll-head')?.click();
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
      } },
    }} />
  );
}
