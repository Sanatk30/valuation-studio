import React, { useMemo } from 'react';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import { computeDcfT, CF_KINDS, dcfDriverDefs, exitMultipleName } from '../lib/engine/dcfTemplate.js';
import { fmtTpl, fmtDate } from '../lib/format.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, upsidePct, rnd, tone, attempt } from './parts/format.js';
import { themed, xCat, tipBy, COL, barSeries, lineSeries, moneyAxis, projectionOption } from './parts/charts.js';

/**
 * DCF output — the chosen template's valuation sheet (cash flows, discounting,
 * terminal value, equity bridge, value per share and the cross-check), its
 * 5 × 5 sensitivity table, and the Forecast, Assumptions and cost-of-capital
 * sheets behind it. Every figure is the engine's (dcfTemplate.js), which
 * reproduces the template's formulas.
 */
export default function DcfOutput({ a }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => computeDcfT(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The DCF" error={model.error} /></div>;
  return <DcfPage a={a} f={f} r={model.value} />;
}

const num = (v) => (fin(v) ? v : NaN);
/** A KPI's text when the template cell reads NM (a KPI with a finite value animates it instead). */
const nm = (v) => (fin(v) ? undefined : 'NM');

function DcfPage({ a, f, r }) {
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
  });
  const cashOpt = themed({
    tooltip: tipBy({}, f.num),
    xAxis: xCat(fc), yAxis: moneyAxis(f),
    series: [
      barSeries(cashLabel, COL.teal, r.flows.cash.map((x) => rnd(x))),
      lineSeries('Present value', COL.gold, v.pv.map((x) => rnd(x))),
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
      <Headline
        eyebrow={`DCF — ${cfK.label} · ${r.tv === 'exit' ? `Exit ${multName}` : 'Gordon Growth'} · ${r.coeKind === 'capm' ? 'CAPM' : 'Build-Up'} (template ${r.template})`}
        sub={`${cfK.long} over ${m} forecast year${m === 1 ? '' : 's'} (${m === 1 ? fc[0] : `${fc[0]}–${fc[m - 1]}`}), discounted at ${r.cf === 'fcff' ? 'the WACC' : 'the cost of equity'} ${t(v.rate, 'pct')} with ${timing}; terminal value by ${tvName}.`}
        warnings={[
          r.blankYears.length ? `Blank drivers in ${r.blankYears.map((j) => fc[j]).join(', ')} count as 0, as in the template — fill them on the Assumptions step.` : null,
          r.tv === 'gordon' && !(v.rate > v.g) ? `The discount rate (${t(v.rate, 'pct')}) is not above the terminal growth (${t(v.g, 'pct')}) — the terminal value is NM, as in the template.` : null,
          fin(num(v.tvShare)) && v.tvShare > 0.75 ? `The terminal value is ${t(v.tvShare, 'pct')} of the total — above ~75% the value depends heavily on the terminal assumptions.` : null,
        ]}
        kpis={[
          { label: `Value per share (${f.sym})`, value: num(v.perShare), text: nm(v.perShare), fmt: (x) => f.price(x), hero: true, tone: hasPx ? tone(upsidePct(num(v.perShare), px)) : undefined, sub: hasPx ? `${t(v.upside, 'pct')} vs ${f.price(px)}` : 'no current price' },
          { label: 'Equity value', value: num(v.equity), text: nm(v.equity), fmt: (x) => f.money(x) },
          r.cf === 'fcff' && { label: 'Enterprise value', value: num(v.ev), text: nm(v.ev), fmt: (x) => f.money(x) },
          { label: rateName, text: t(v.rate, 'pct'), sub: w ? `Ke ${t(coe.ke, 'pct')} · Kd after tax ${t(w.kdAfter, 'pct')} · D/(D+E) ${t(w.targetWd, 'pct')}` : (r.coeKind === 'capm' ? `rf ${t(coe.rf, 'pct')} + β ${fmtTpl(coe.beta, 'n2', L)} × ERP ${t(coe.erp, 'pct')}` : 'build-up') },
          { label: 'Terminal value share', text: t(v.tvShare, 'pct'), sub: r.tv === 'gordon' ? `implied exit ${multName} ${t(v.implied, 'x')}` : `implied perpetual growth ${t(v.implied, 'pct')}` },
        ].filter(Boolean)}
      >
        <div className="grid2">
          <ChartBox title={`${cashLabel} and present value (${f.unitLabel})`} option={cashOpt} />
          <div className="chartbox">
            <div className="ct">Value bridge ({f.unitLabel})</div>
            {bridgeOk ? <Waterfall items={bridge} fmt={f.num} /> : <div className="empty">NM — the terminal value is not meaningful.</div>}
          </div>
        </div>
      </Headline>

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
          <ChartBox title={`Revenue & EBITDA (${f.unitLabel}), EBITDA margin — actual and forecast`} option={projOpt} />
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
