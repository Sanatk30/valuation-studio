import React, { useMemo } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
// Namespace imports: fields / functions Stream 1 is still adding read as
// `undefined` (→ NA / hidden line) instead of failing the module link.
import * as DCF from '../lib/engine/dcf.js';
import * as WACC from '../lib/engine/wacc.js';
import { periodLabels } from '../lib/period.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import SensStepInputs from './parts/SensStepInputs.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import {
  makeFmt, fin, upsidePct, upsideText, cagrPct, cumsum, allFinite, rnd, axis5, tone, attempt,
} from './parts/format.js';
import {
  themed, xCat, yVal, tipBy, vgrad, COL, barSeries, lineSeries, moneyAxis,
  projectionOption, growthOption, ringOption,
} from './parts/charts.js';

const DASH = '—';

/** First → last finite positive value of a reported series, as a CAGR (%). */
function reportedCagr(arr) {
  const pts = (arr || []).map((v, i) => [v, i]).filter(([v]) => fin(v) && v > 0);
  if (pts.length < 2) return NaN;
  const [v0, i0] = pts[0];
  const [v1, i1] = pts[pts.length - 1];
  return cagrPct(v0, v1, i1 - i0);
}

/**
 * DCF output page.
 * Props: { a, set, company, skipped } — `a` from toEngineInput, `set` only for
 * the sensitivity step sizes (sens.dcf.*, sens.wacc.*), `skipped.fcfe` hides
 * every levered (FCFE) figure.
 */
export default function DcfOutput({ a, set, skipped = {} }) {
  const showFcfe = !skipped.fcfe;
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const s = a.settings;

  const model = useMemo(() => attempt(() => {
    const dcf = DCF.computeDcf(a);
    const sens = DCF.dcfSensitivity(a);
    // reported history only — never back-cast (null when there is none)
    const hist = typeof DCF.dcfReportedHistory === 'function' ? DCF.dcfReportedHistory(a) : null;
    const peers = (a.wacc.betaPeers || []).length && typeof WACC.betaPeerStats === 'function'
      ? WACC.betaPeerStats(a) : null;
    return { dcf, sens, hist, peers };
  }), [a]);

  if (model.error) return <div className="qo"><EngineError what="The DCF" error={model.error} /></div>;
  const { dcf, sens, hist, peers } = model.value;
  return <DcfPage a={a} set={set} f={f} s={s} dcf={dcf} sens={sens} hist={hist} peers={peers} showFcfe={showFcfe} />;
}

function DcfPage({ a, set, f, s, dcf, sens, hist, peers, showFcfe }) {
  const ops = dcf.ops;
  const n = ops.n;
  const labels = useMemo(() => periodLabels(s, 'Y', n), [s, n]);
  const px = a.company.currentPrice;
  const hasPx = fin(px) && px > 0;
  const t = a.company.taxRate / 100;
  const primary = a.dcf.primaryTV === 'exit' ? 'exit' : 'gordon';
  const g = a.dcf.terminalGrowth;
  const hasHist = !!(hist && hist.n > 0);

  // engine point evaluation: the whole DCF at an override WACC / CoE / TV input
  const at = (over, waccPct = null, coePct = null) =>
    DCF.computeDcf(over ? { ...a, dcf: { ...a.dcf, ...over } } : a, ops, waccPct, coePct);

  const pvNolFcff = dcf.pvNolFcff;          // PV of the tax-loss balance left at year N (FCFF)
  const pvNolFcfe = dcf.pvNolFcfe;          // … discounted at the cost of equity (FCFE)
  const hasNolU = Array.isArray(dcf.nolOpenU);
  const hasNolL = Array.isArray(dcf.nolOpenL);
  const fcffTax = Array.isArray(dcf.fcffTax) ? dcf.fcffTax : ops.ebit.map((e, i) => e - dcf.nopat[i]);

  const pvTvPrimary = primary === 'gordon' ? dcf.pvTvGordon : dcf.pvTvExit;
  const tvPct = primary === 'gordon' ? dcf.tvPctOfEv?.gordon : dcf.tvPctOfEv?.exit;
  const fcfeExitPct = fin(dcf.fcfeExit?.equity) && dcf.fcfeExit.equity > 0 ? (dcf.pvTvFcfePE / dcf.fcfeExit.equity) * 100 : NaN;
  const waccTooLow = fin(dcf.wacc) && fin(g) && dcf.wacc <= g;
  const coeTooLow = showFcfe && fin(dcf.costEquity) && fin(g) && dcf.costEquity <= g;

  /* ------------------------------------------------ key charts */
  const bridgeItems = [
    { label: 'PV of FCFF', value: dcf.pvSum },
    { label: primary === 'gordon' ? 'PV of Gordon TV' : 'PV of exit TV', value: pvTvPrimary },
    ...(fin(pvNolFcff) ? [{ label: 'PV of remaining NOL', value: pvNolFcff }] : []),
    { label: 'Enterprise value', value: dcf.primary.ev, total: true },
    { label: 'Less: gross debt', value: -a.company.grossDebt },
    { label: 'Add: cash', value: a.company.cash },
    { label: 'Equity value', value: dcf.primary.equity, total: true },
  ];
  const bridgeOk = allFinite(bridgeItems.map((it) => it.value));

  const fcfOpt = useMemo(() => themed({
    tooltip: tipBy({}, f.num),
    xAxis: xCat(labels),
    yAxis: moneyAxis(f),
    series: [
      barSeries('FCFF', COL.teal, dcf.fcff.map((v) => rnd(v)), { barMaxWidth: 24 }),
      ...(showFcfe ? [barSeries('FCFE', COL.violet, dcf.fcfe.map((v) => rnd(v)), { barMaxWidth: 24 })] : []),
      lineSeries('PV of FCFF', COL.green, dcf.pv.map((v) => rnd(v)), { dashed: true, width: 2 }),
      lineSeries('Cumulative PV of FCFF', COL.cyan, cumsum(dcf.pv).map((v) => rnd(v)), { symbol: false, width: 1.6 }),
    ],
  }, { zoom: n > 9 }), [dcf, labels, f, n, showFcfe]);

  /* ------------------------------------------------ sensitivity grids */
  const grids = useMemo(() => {
    // implied perpetuity growth and implied EV / LTM EBITDA on the same
    // WACC × exit-multiple axes as the engine's price grid
    const cells = sens.waccSteps.map((w) => sens.mSteps.map((m) => at({ exitMultiple: m }, w)));
    const ltmEbitda = ops.ebitda0;
    return {
      perp: cells.map((row) => row.map((d) => d.impliedPerpGrowth)),
      mult: cells.map((row) => row.map((d) => (fin(ltmEbitda) && ltmEbitda > 0 ? d.exit.ev / ltmEbitda : NaN))),
    };
  }, [sens, a, ops]); // eslint-disable-line react-hooks/exhaustive-deps

  // WACC surface: capital structure × pre-tax cost of debt, beta relevered in every cell
  const waccGrid = useMemo(() => {
    const wdSteps = axis5(a.wacc.debtWeight, a.sens.wacc.wdStep);
    const kdSteps = axis5(a.wacc.costDebt, a.sens.wacc.kdStep);
    const bu = dcf.unleveredBeta;
    // the size / alpha premium exactly as the engine applied it
    const premium = dcf.costEquity - a.wacc.riskFree - dcf.leveredBeta * a.wacc.erp;
    const grid = wdSteps.map((wd) => kdSteps.map((kd) => {
      // OPEN QUESTION: a row outside 0 % ≤ D/(D+E) < 100 % is shown n/m; the old grid
      // clamped it to 0–90 % (a hard-coded band) — confirm n/m is wanted.
      if (!(wd >= 0 && wd < 100)) return NaN;
      const de = (wd / 100) / (1 - wd / 100);
      const bl = bu * (1 + (1 - t) * de);
      const coe = a.wacc.riskFree + bl * a.wacc.erp + premium;
      return (wd / 100) * kd * (1 - t) + (1 - wd / 100) * coe;
    }));
    return { wdSteps, kdSteps, grid };
  }, [a, dcf, t]);

  /* ------------------------------------------------ extra charts */
  const charts = useMemo(() => buildDcfCharts({ a, f, dcf, ops, labels, primary, pvTvPrimary, at, n }),
    [a, f, dcf, labels, primary, pvTvPrimary, n]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------ FCFF build table */
  const lead = (arr) => (hasHist ? arr : undefined);
  const revCagr = hasHist ? reportedCagr(hist.revenue) : NaN;
  const trailLabels = [...(hasHist ? ['Reported CAGR'] : []), `CAGR ${labels[0]}–${labels[n - 1]}`];
  const trail = (histArr, proj) => [
    ...(hasHist ? [histArr ? reportedCagr(histArr) : null] : []),
    n > 1 ? cagrPct(proj[0], proj[n - 1], n - 1) : NaN,
  ];
  const ltmMargin = fin(ops.ebitda0) && a.drivers.revenue0 ? (ops.ebitda0 / a.drivers.revenue0) * 100 : NaN;
  const nolAdded = (open, used, close) => close.map((c, i) => c - open[i] + used[i]);

  const fcffRows = [
    { label: 'Sales', values: ops.revenue, year0: a.drivers.revenue0, fmt: f.num, bold: true, lead: lead(hist?.revenue), trail: trail(hist?.revenue, ops.revenue), trailFmt: f.pct },
    { label: '% growth', values: ops.growth, fmt: f.pct, sub: true, lead: lead(hist?.growth) },
    { label: 'Less: operating costs', values: ops.revenue.map((r, i) => r - ops.ebitda[i]), year0: a.drivers.revenue0 - ops.ebitda0, fmt: f.num, sub: true, lead: lead(hist?.revenue.map((r, i) => r - hist.ebitda[i])) },
    { label: 'EBITDA', values: ops.ebitda, year0: ops.ebitda0, fmt: f.num, bold: true, lead: lead(hist?.ebitda), trail: trail(hist?.ebitda, ops.ebitda), trailFmt: f.pct },
    { label: '% margin', values: ops.margin, year0: ltmMargin, fmt: f.pct, sub: true, lead: lead(hist?.margin) },
    { label: 'Less: D&A', values: ops.da, fmt: f.num, sub: true, lead: lead(hist?.da) },
    { label: 'EBIT', values: ops.ebit, fmt: f.num, bold: true, lead: lead(hist?.ebit), trail: trail(hist?.ebit, ops.ebit), trailFmt: f.pct },
    { label: 'Less: taxes on EBIT (after tax losses used)', values: fcffTax, fmt: f.num, sub: true },
    { label: 'NOPAT (EBIAT)', values: dcf.nopat, fmt: f.num, bold: true },
    ...(hasNolU ? [
      { label: 'Memo: tax-loss (NOL) balance — opening', values: dcf.nolOpenU, fmt: f.num, sub: true },
      { label: 'Memo: add losses', values: nolAdded(dcf.nolOpenU, dcf.nolUsedU, dcf.nolCloseU), fmt: f.num, sub: true },
      { label: 'Memo: less NOL used', values: dcf.nolUsedU, fmt: f.num, sub: true },
      { label: 'Memo: NOL balance — closing', values: dcf.nolCloseU, fmt: f.num, sub: true },
    ] : []),
    { label: 'Plus: D&A', values: ops.da, fmt: f.num, sub: true, lead: lead(hist?.da) },
    { label: 'Less: capex', values: ops.capex, fmt: f.num, sub: true, lead: lead(hist?.capex) },
    { label: 'Memo: NWC balance', values: ops.nwcBalance, year0: ops.nwc0, fmt: f.num, sub: true },
    { label: 'Less: increase / (decrease) in NWC', values: ops.deltaNwc, fmt: f.num, sub: true },
    { label: 'Unlevered free cash flow (FCFF)', values: dcf.fcff, fmt: f.num, bold: true, trail: trail(null, dcf.fcff), trailFmt: f.pct },
    { label: `Discount period${a.dcf.midYear ? ' (mid-year)' : ''}`, values: dcf.period, fmt: (v) => f.dec(v, 2), sub: true },
    { label: 'Discount factor @ WACC', values: dcf.df, fmt: (v) => f.dec(v, 3), sub: true },
    { label: 'PV of FCFF', values: dcf.pv, fmt: f.num, bold: true },
    { label: 'Cumulative PV of FCFF', values: cumsum(dcf.pv), fmt: f.num, sub: true },
  ];

  /* ------------------------------------------------ FCFE build table */
  const fcfeRows = showFcfe ? [
    { label: 'FCFF', values: dcf.fcff, fmt: f.num },
    // the engine's own FCFF → FCFE bridge, so the line always ties
    { label: 'Less: interest after tax', values: dcf.fcfe.map((v, i) => v - dcf.fcff[i] - dcf.netBorrow[i]), fmt: f.num, sub: true },
    { label: 'Add: net borrowing / (repayment)', values: dcf.netBorrow, fmt: f.num, sub: true },
    { label: 'Levered free cash flow (FCFE)', values: dcf.fcfe, fmt: f.num, bold: true },
    { label: 'Memo: opening debt', values: dcf.openDebt, fmt: f.num, sub: true },
    { label: 'Memo: interest expense', values: dcf.interest, fmt: f.num, sub: true },
    { label: 'Memo: opening cash', values: dcf.openCash, fmt: f.num, sub: true },
    { label: 'Memo: interest income on cash', values: dcf.interestInc, fmt: f.num, sub: true },
    { label: 'Memo: net income (3-statement basis, for exit P/E)', values: dcf.niDcf, fmt: f.num, sub: true },
    ...(hasNolL ? [
      { label: 'Memo: tax-loss (NOL) balance — opening', values: dcf.nolOpenL, fmt: f.num, sub: true },
      { label: 'Memo: add losses', values: nolAdded(dcf.nolOpenL, dcf.nolUsedL, dcf.nolCloseL), fmt: f.num, sub: true },
      { label: 'Memo: less NOL used', values: dcf.nolUsedL, fmt: f.num, sub: true },
      { label: 'Memo: NOL balance — closing', values: dcf.nolCloseL, fmt: f.num, sub: true },
    ] : []),
    { label: 'Discount factor @ cost of equity', values: dcf.dfE, fmt: (v) => f.dec(v, 3), sub: true },
    { label: 'PV of FCFE', values: dcf.pvE, fmt: f.num, bold: true },
    { label: 'Cumulative PV of FCFE', values: cumsum(dcf.pvE), fmt: f.num, sub: true },
  ] : [];

  const betaText = a.wacc.betaMode === 'hamada'
    ? `Hamada βL ${f.dec(dcf.leveredBeta, 2)} from βU ${f.dec(dcf.unleveredBeta, 2)} at D/E ${f.dec(dcf.de, 2)}`
    : `βL ${f.dec(dcf.leveredBeta, 2)} entered directly (implied βU ${f.dec(dcf.unleveredBeta, 2)})`;
  const upText = hasPx ? upsideText(dcf.primary.price, px) : null;

  const vsMkt = (price) => (hasPx ? f.pct(upsidePct(price, px), 1) : DASH);
  const cell = (v, fmt) => (v === DASH ? <td className="na">{DASH}</td> : <td className={fin(v) && v < 0 ? 'neg' : ''}>{fmt(v)}</td>);

  return (
    <div className="qo">
      <Headline
        eyebrow={`Discounted cash flow — implied share price (FCFF, ${primary === 'gordon' ? 'Gordon growth' : 'exit multiple'} terminal value)`}
        value={dcf.primary.price}
        fmt={(v) => f.price(v)}
        sub={`FCFF over ${labels[0]}–${labels[n - 1]} discounted at a ${f.pct2(dcf.wacc)} WACC${a.dcf.midYear ? ' (mid-year convention)' : ''}; ${betaText}.${showFcfe ? ` FCFE discounted at a ${f.pct2(dcf.costEquity)} cost of equity.` : ''}${upText ? ` ${upText} to the market price of ${f.price(px)}.` : ''}`}
        warnings={[
          waccTooLow && `Terminal growth (${f.pct(g)}) is at or above the WACC (${f.pct2(dcf.wacc)}) — the FCFF Gordon terminal value is undefined.`,
          coeTooLow && `Terminal growth (${f.pct(g)}) is at or above the cost of equity (${f.pct2(dcf.costEquity)}) — the FCFE Gordon terminal value is undefined.`,
        ]}
        kpis={[
          hasPx && { label: 'vs market price', value: upsidePct(dcf.primary.price, px), fmt: (v) => `${v >= 0 ? '+' : ''}${f.pct(v)}`, tone: tone(upsidePct(dcf.primary.price, px)), sub: `market ${f.price(px)}` },
          { label: 'Enterprise value', value: dcf.primary.ev, fmt: (v) => f.money(v), hero: true, sub: `terminal value ${f.pct0(tvPct)} of EV` },
          { label: 'Equity value', value: dcf.primary.equity, fmt: (v) => f.money(v), sub: `net debt ${f.money(dcf.netDebt)}` },
          { label: 'WACC · cost of equity', text: `${f.pct2(dcf.wacc)} · ${f.pct2(dcf.costEquity)}`, sub: `after-tax Kd ${f.pct2(dcf.afterTaxKd)}` },
          { label: 'FCFF — Gordon / exit', text: `${f.price(dcf.gordon.price)} / ${f.price(dcf.exit.price)}`, sub: `TV ${f.pct0(dcf.tvPctOfEv?.gordon)} / ${f.pct0(dcf.tvPctOfEv?.exit)} of EV` },
          showFcfe && { label: 'FCFE — Gordon / exit P/E', text: `${f.price(dcf.fcfeGordon.price)} / ${f.price(dcf.fcfeExit.price)}`, sub: `discounted at CoE ${f.pct2(dcf.costEquity)}` },
        ]}
      >
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Enterprise value → equity value ({primary === 'gordon' ? 'Gordon' : 'exit multiple'}, {f.unitLabel})</div>
            {bridgeOk ? <Waterfall items={bridgeItems} fmt={f.num} /> : <div className="sec-note">A bridge line is NA, so the bridge can't be drawn — see Enterprise value → share price below.</div>}
          </div>
          <ChartBox title={`Free cash flow${showFcfe ? ' — FCFF vs FCFE' : ''}, PV and cumulative PV (${f.unitLabel})`} option={fcfOpt} />
        </div>
      </Headline>

      <Sections>
        <Collapsible title="Valuation summary — every DCF method" tag="SUM">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Method</th><th>Discount rate</th><th>Enterprise value</th><th>Equity value</th><th>Share price</th><th>TV % of value</th><th>vs market</th></tr></thead>
              <tbody>
                <tr className={primary === 'gordon' ? 'bold' : ''}>
                  <td>FCFF — Gordon growth{primary === 'gordon' ? ' (primary)' : ''}</td>
                  <td>WACC {f.pct2(dcf.wacc)}</td><td>{f.num(dcf.gordon.ev)}</td><td>{f.num(dcf.gordon.equity)}</td>
                  <td>{f.price(dcf.gordon.price)}</td><td>{f.pct(dcf.tvPctOfEv?.gordon)}</td><td>{vsMkt(dcf.gordon.price)}</td>
                </tr>
                <tr className={primary === 'exit' ? 'bold' : ''}>
                  <td>FCFF — exit {f.x1(a.dcf.exitMultiple)} EV/EBITDA{primary === 'exit' ? ' (primary)' : ''}</td>
                  <td>WACC {f.pct2(dcf.wacc)}</td><td>{f.num(dcf.exit.ev)}</td><td>{f.num(dcf.exit.equity)}</td>
                  <td>{f.price(dcf.exit.price)}</td><td>{f.pct(dcf.tvPctOfEv?.exit)}</td><td>{vsMkt(dcf.exit.price)}</td>
                </tr>
                {showFcfe && (
                  <>
                    <tr>
                      <td>FCFE — Gordon growth</td><td>CoE {f.pct2(dcf.costEquity)}</td><td className="na">{DASH}</td>
                      <td>{f.num(dcf.fcfeGordon.equity)}</td><td>{f.price(dcf.fcfeGordon.price)}</td>
                      <td>{f.pct(dcf.tvPctOfEv?.fcfeGordon)}</td><td>{vsMkt(dcf.fcfeGordon.price)}</td>
                    </tr>
                    <tr>
                      <td>FCFE — exit {f.x1(a.dcf.exitPE)} P/E</td><td>CoE {f.pct2(dcf.costEquity)}</td><td className="na">{DASH}</td>
                      <td>{f.num(dcf.fcfeExit.equity)}</td><td>{f.price(dcf.fcfeExit.price)}</td>
                      <td>{f.pct(fcfeExitPct)}</td><td>{vsMkt(dcf.fcfeExit.price)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <div className="qo-note">Enterprise and equity values in {f.unitLabel}. FCFE values equity directly, so it has no enterprise value.</div>
        </Collapsible>

        <Collapsible title={`Unlevered free cash flow (FCFF) build — ${f.unitLabel}`} tag="FCFF" note={hasHist ? `with reported history · ${hist.labels[0]}–${hist.labels[hist.labels.length - 1]}` : 'projection only'}>
          <StatementTable
            labels={labels}
            years={ops.years}
            showYear0
            leadLabels={hasHist ? hist.labels : []}
            leadGroup={hasHist ? 'Reported history' : undefined}
            trailLabels={trailLabels}
            trailGroup="CAGR"
            rows={fcffRows}
          />
          <div className="qo-note">
            {hasHist
              ? <>Reported columns come straight from the history you loaded ({a.history?.label || 'reported'}); a line the source doesn't carry reads —. </>
              : <>No reported history was entered, so there are no historical columns (nothing is back-cast). </>}
            The Y0 / LTM column holds your LTM revenue, LTM EBITDA and opening NWC. Taxes are charged on positive EBIT
            only after any tax-loss balance is used up; a loss year pays no tax and adds to the balance.
            {!fin(revCagr) && hasHist ? ' Reported CAGR needs at least two reported years.' : ''}
          </div>
        </Collapsible>

        {showFcfe && (
          <Collapsible title={`Levered free cash flow (FCFE) — build and valuation (${f.unitLabel})`} tag="FCFE">
            <StatementTable labels={labels} years={ops.years} rows={fcfeRows} />
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th>Equity value from FCFE</th><th>Gordon growth @ CoE</th><th>Exit P/E</th></tr></thead>
                <tbody>
                  <tr><td>Cumulative PV of FCFE</td><td>{f.num(dcf.pvSumE)}</td><td>{f.num(dcf.pvSumE)}</td></tr>
                  <tr className="sub"><td>Terminal-year FCFE (normalised, fully taxed)</td>{cell(dcf.fcfeNormN, f.num)}<td className="na">{DASH}</td></tr>
                  <tr className="sub"><td>Perpetuity growth</td><td>{f.pct(g)}</td><td className="na">{DASH}</td></tr>
                  <tr className="sub"><td>Terminal-year net income</td><td className="na">{DASH}</td>{cell(dcf.niDcf[n - 1], f.num)}</tr>
                  <tr className="sub"><td>Exit P/E</td><td className="na">{DASH}</td><td>{f.x(a.dcf.exitPE)}</td></tr>
                  <tr><td>Terminal value</td><td>{f.num(dcf.tvFcfeGordon)}</td><td>{f.num(dcf.tvFcfePE)}</td></tr>
                  <tr><td>PV of terminal value</td><td>{f.num(dcf.pvTvFcfeGordon)}</td><td>{f.num(dcf.pvTvFcfePE)}</td></tr>
                  <tr><td>PV of remaining tax losses (NOL × t @ CoE)</td>{cell(pvNolFcfe, f.num)}{cell(pvNolFcfe, f.num)}</tr>
                  <tr className="bold"><td>Equity value</td><td>{f.num(dcf.fcfeGordon.equity)}</td><td>{f.num(dcf.fcfeExit.equity)}</td></tr>
                  <tr className="sub"><td>÷ Shares outstanding</td><td>{f.shares(a.company.sharesOut)}</td><td>{f.shares(a.company.sharesOut)}</td></tr>
                  <tr className="bold"><td>Implied share price</td><td>{f.price(dcf.fcfeGordon.price)}</td><td>{f.price(dcf.fcfeExit.price)}</td></tr>
                  <tr className="sub"><td>TV % of equity value</td><td>{f.pct(dcf.tvPctOfEv?.fcfeGordon)}</td><td>{f.pct(fcfeExitPct)}</td></tr>
                  {hasPx && <tr className="sub"><td>Premium / (discount) to market</td><td>{vsMkt(dcf.fcfeGordon.price)}</td><td>{vsMkt(dcf.fcfeExit.price)}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="qo-note">
              The debt and cash schedules use the FCFE financing inputs: interest on opening balances, mandatory
              repayment of {f.pct0(a.ts.debtRepayPct)} of opening debt a year. The Gordon terminal value capitalises a
              normalised, fully-taxed year-{n} flow; any tax-loss balance still unused at year {n} is valued on its own line.
            </div>
          </Collapsible>
        )}

        <Collapsible title="Enterprise value → implied share price" tag="EV">
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th>Enterprise value ({f.unitLabel})</th><th>Perpetuity growth</th><th>Exit multiple</th></tr></thead>
                <tbody>
                  <tr><td>Cumulative PV of FCFF</td><td>{f.num(dcf.pvSum)}</td><td>{f.num(dcf.pvSum)}</td></tr>
                  <tr className="sub"><td>Terminal-year FCFF (normalised, fully taxed)</td>{cell(dcf.fcffNormN, f.num)}<td className="na">{DASH}</td></tr>
                  <tr className="sub"><td>Perpetuity growth rate</td><td>{f.pct(g)}</td><td className="na">{DASH}</td></tr>
                  <tr className="sub"><td>Terminal-year EBITDA</td><td className="na">{DASH}</td><td>{f.num(ops.ebitda[n - 1])}</td></tr>
                  <tr className="sub"><td>Exit EV / EBITDA</td><td className="na">{DASH}</td><td>{f.x(a.dcf.exitMultiple)}</td></tr>
                  <tr><td>Terminal value</td><td>{f.num(dcf.tvGordon)}</td><td>{f.num(dcf.tvExit)}</td></tr>
                  <tr><td>PV of terminal value</td><td>{f.num(dcf.pvTvGordon)}</td><td>{f.num(dcf.pvTvExit)}</td></tr>
                  <tr><td>PV of remaining tax losses (NOL × t @ WACC)</td>{cell(pvNolFcff, f.num)}{cell(pvNolFcff, f.num)}</tr>
                  <tr className="bold"><td>Enterprise value</td><td>{f.num(dcf.gordon.ev)}</td><td>{f.num(dcf.exit.ev)}</td></tr>
                  <tr className="sub"><td>Terminal value % of EV</td><td>{f.pct(dcf.tvPctOfEv?.gordon)}</td><td>{f.pct(dcf.tvPctOfEv?.exit)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th>Equity value and share price</th><th>Perpetuity growth</th><th>Exit multiple</th></tr></thead>
                <tbody>
                  <tr><td>Enterprise value</td><td>{f.num(dcf.gordon.ev)}</td><td>{f.num(dcf.exit.ev)}</td></tr>
                  <tr className="sub"><td>Less: gross debt</td><td className="neg">{f.num(-a.company.grossDebt)}</td><td className="neg">{f.num(-a.company.grossDebt)}</td></tr>
                  <tr className="sub"><td>Plus: cash &amp; equivalents</td><td>{f.num(a.company.cash)}</td><td>{f.num(a.company.cash)}</td></tr>
                  <tr className="bold"><td>Implied equity value</td><td>{f.num(dcf.gordon.equity)}</td><td>{f.num(dcf.exit.equity)}</td></tr>
                  <tr className="sub"><td>÷ Shares outstanding</td><td>{f.shares(a.company.sharesOut)}</td><td>{f.shares(a.company.sharesOut)}</td></tr>
                  <tr className="bold"><td>Implied share price</td><td>{f.price(dcf.gordon.price)}</td><td>{f.price(dcf.exit.price)}</td></tr>
                  {hasPx && <tr className="sub"><td>Premium / (discount) to {f.price(px)}</td><td>{vsMkt(dcf.gordon.price)}</td><td>{vsMkt(dcf.exit.price)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="qo-note">
            {a.dcf.midYear ? 'Mid-year convention: flows and the Gordon terminal value are discounted half a year earlier; the exit-multiple terminal value assumes a year-end sale. ' : 'Year-end discounting throughout. '}
            The tax-loss balance left at year {n} is worth the tax it will save: NOL × tax rate, discounted to today, added to enterprise value under both terminal methods.
          </div>
        </Collapsible>

        <Collapsible title="Terminal value cross-checks" tag="TV">
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin qo-kv">
                <thead><tr><th>Gordon TV — implied exit multiple</th><th /></tr></thead>
                <tbody>
                  <tr><td>Terminal-year FCFF (normalised)</td><td>{f.num(dcf.fcffNormN)}</td></tr>
                  <tr><td>Terminal growth</td><td>{f.pct(g)}</td></tr>
                  <tr><td>Gordon terminal value</td><td>{f.num(dcf.tvGordon)}</td></tr>
                  <tr><td>Terminal-year EBITDA ({labels[n - 1]})</td><td>{f.num(ops.ebitda[n - 1])}</td></tr>
                  <tr className="bold"><td>Implied exit EV / EBITDA</td><td>{f.x(dcf.impliedExitMultiple)}</td></tr>
                  <tr className="sub"><td>Your exit multiple</td><td>{f.x(a.dcf.exitMultiple)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="tablewrap">
              <table className="fin qo-kv">
                <thead><tr><th>Exit-multiple TV — implied perpetuity growth</th><th /></tr></thead>
                <tbody>
                  <tr><td>Exit terminal value ({f.x1(a.dcf.exitMultiple)} × {labels[n - 1]} EBITDA)</td><td>{f.num(dcf.tvExit)}</td></tr>
                  <tr><td>WACC</td><td>{f.pct2(dcf.wacc)}</td></tr>
                  <tr className="bold"><td>Implied perpetuity growth</td><td>{f.pct2(dcf.impliedPerpGrowth)}</td></tr>
                  <tr className="sub"><td>Your terminal growth</td><td>{f.pct(g)}</td></tr>
                  {a.dcf.midYear && <tr className="sub"><td colSpan={2}>Mid-year is on, so the terminal flow is grossed up by (1 + WACC)^0.5 before it is capitalised.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="qo-note">If the two terminal methods imply very different multiples or growth rates, one of the two terminal inputs is doing most of the work.</div>
        </Collapsible>

        <Collapsible title="Cost of capital — the WACC build" tag="WACC" note={`WACC ${f.pct2(dcf.wacc)}`}>
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin qo-kv">
                <thead><tr><th>WACC calculation</th><th /></tr></thead>
                <tbody>
                  <tr className="sechead"><td colSpan={2}>Target capital structure</td></tr>
                  <tr><td>Debt / (debt + equity)</td><td>{f.pct(a.wacc.debtWeight)}</td></tr>
                  <tr><td>Equity / (debt + equity)</td><td>{f.pct(100 - a.wacc.debtWeight)}</td></tr>
                  <tr className="sub"><td>Debt / equity</td><td>{f.x(dcf.de)}</td></tr>
                  <tr className="sechead"><td colSpan={2}>Cost of debt</td></tr>
                  <tr><td>Pre-tax cost of debt</td><td>{f.pct2(a.wacc.costDebt)}</td></tr>
                  <tr><td>Tax rate</td><td>{f.pct(a.company.taxRate)}</td></tr>
                  <tr className="bold"><td>After-tax cost of debt</td><td>{f.pct2(dcf.afterTaxKd)}</td></tr>
                  <tr className="sechead"><td colSpan={2}>Cost of equity (CAPM)</td></tr>
                  <tr><td>Risk-free rate</td><td>{f.pct2(a.wacc.riskFree)}</td></tr>
                  <tr><td>Equity risk premium</td><td>{f.pct2(a.wacc.erp)}</td></tr>
                  {a.wacc.betaMode === 'hamada'
                    ? <><tr><td>Unlevered beta (input)</td><td>{f.dec(a.wacc.unleveredBeta, 3)}</td></tr><tr><td>Levered beta (Hamada)</td><td>{f.dec(dcf.leveredBeta, 3)}</td></tr></>
                    : <><tr><td>Levered beta (input)</td><td>{f.dec(dcf.leveredBeta, 3)}</td></tr><tr className="sub"><td>Implied unlevered beta</td><td>{f.dec(dcf.unleveredBeta, 3)}</td></tr></>}
                  <tr><td>Size / alpha premium</td><td>{f.pct2(a.wacc.sizePremium)}</td></tr>
                  <tr className="bold"><td>Cost of equity</td><td>{f.pct2(dcf.costEquity)}</td></tr>
                  <tr className="bold"><td>WACC</td><td>{f.pct2(dcf.wacc)}</td></tr>
                </tbody>
              </table>
            </div>
            <BetaPeers a={a} f={f} dcf={dcf} peers={peers} />
          </div>
          <div>
            <div className="qo-sub">WACC sensitivity — capital structure (rows) × pre-tax cost of debt (columns)</div>
            <SensStepInputs a={a} set={set} items={[
              { path: 'sens.wacc.wdStep', label: 'D/(D+E) step', suffix: '% pts' },
              { path: 'sens.wacc.kdStep', label: 'Cost-of-debt step', suffix: '% pts' },
            ]} />
            <Heatmap corner="D/(D+E) \ Kd" rowLabels={waccGrid.wdSteps} colLabels={waccGrid.kdSteps} grid={waccGrid.grid}
              fmt={(v) => f.pct2(v)} fmtRow={(v) => f.pct(v)} fmtCol={(v) => f.pct2(v)} />
            <div className="qo-note" style={{ marginTop: 6 }}>Beta is relevered at every capital structure before the cost of equity is rebuilt, so each cell is a full WACC.</div>
          </div>
        </Collapsible>

        <Collapsible title="Sensitivity analysis" tag="SENS" note={`${showFcfe ? 5 : 4} grids · steps editable`}>
          <div className="qo-note">Each axis runs two steps either side of your base case (the outlined centre cell). Edit a step above a grid — every grid that shares it redraws.</div>
          <div className="qo-sens">
            <div className="qo-sens-cell">
              <div className="qo-sub">FCFF share price — WACC × terminal growth</div>
              <SensStepInputs a={a} set={set} items={[
                { path: 'sens.dcf.waccStep', label: 'WACC step', suffix: '% pts' },
                { path: 'sens.dcf.gStep', label: 'Growth step', suffix: '% pts' },
              ]} />
              <Heatmap corner="WACC \ g" rowLabels={sens.waccSteps} colLabels={sens.gSteps} grid={sens.gordonGrid}
                fmt={f.gridPrice} fmtRow={(v) => f.pct2(v)} fmtCol={(v) => f.pct2(v)} />
            </div>
            <div className="qo-sens-cell">
              <div className="qo-sub">FCFF share price — WACC × exit EV/EBITDA</div>
              <SensStepInputs a={a} set={set} items={[
                { path: 'sens.dcf.waccStep', label: 'WACC step', suffix: '% pts' },
                { path: 'sens.dcf.multStep', label: 'Multiple step', suffix: 'x' },
              ]} />
              <Heatmap corner="WACC \ x" rowLabels={sens.waccSteps} colLabels={sens.mSteps} grid={sens.exitGrid}
                fmt={f.gridPrice} fmtRow={(v) => f.pct2(v)} fmtCol={(v) => f.x1(v)} />
            </div>
            <div className="qo-sens-cell">
              <div className="qo-sub">Implied perpetuity growth — WACC × exit EV/EBITDA</div>
              <SensStepInputs a={a} set={set} items={[
                { path: 'sens.dcf.waccStep', label: 'WACC step', suffix: '% pts' },
                { path: 'sens.dcf.multStep', label: 'Multiple step', suffix: 'x' },
              ]} />
              <Heatmap corner="WACC \ x" rowLabels={sens.waccSteps} colLabels={sens.mSteps} grid={grids.perp}
                fmt={(v) => f.pct2(v)} fmtRow={(v) => f.pct2(v)} fmtCol={(v) => f.x1(v)} />
            </div>
            <div className="qo-sens-cell">
              <div className="qo-sub">Implied EV / LTM EBITDA — WACC × exit EV/EBITDA</div>
              <SensStepInputs a={a} set={set} items={[
                { path: 'sens.dcf.waccStep', label: 'WACC step', suffix: '% pts' },
                { path: 'sens.dcf.multStep', label: 'Multiple step', suffix: 'x' },
              ]} />
              <Heatmap corner="WACC \ x" rowLabels={sens.waccSteps} colLabels={sens.mSteps} grid={grids.mult}
                fmt={(v) => f.x(v)} fmtRow={(v) => f.pct2(v)} fmtCol={(v) => f.x1(v)} />
            </div>
            {showFcfe && (
              <div className="qo-sens-cell">
                <div className="qo-sub">FCFE share price — cost of equity × terminal growth</div>
                <SensStepInputs a={a} set={set} items={[
                  { path: 'sens.dcf.coeStep', label: 'CoE step', suffix: '% pts' },
                  { path: 'sens.dcf.gStep', label: 'Growth step', suffix: '% pts' },
                ]} />
                <Heatmap corner="CoE \ g" rowLabels={sens.coeSteps} colLabels={sens.gSteps} grid={sens.fcfeGrid}
                  fmt={f.gridPrice} fmtRow={(v) => f.pct2(v)} fmtCol={(v) => f.pct2(v)} />
              </div>
            )}
          </div>
          <div className="qo-note">Share prices in {f.sym || 'the valuation currency'}. n/m = not meaningful (e.g. growth at or above the discount rate).</div>
        </Collapsible>

        <Collapsible title="More charts" tag="CHARTS">
          <div className="grid2">
            <ChartBox title={`Projection — revenue & EBITDA (${f.unitLabel}), EBITDA margin`} option={charts.projection} />
            <ChartBox title="Revenue growth by year" option={charts.growth} />
            <ChartBox title={`FCFF build by year — NOPAT + D&A − capex − ΔNWC (${f.unitLabel})`} option={charts.fcfBuild} />
            <ChartBox title={`Cash conversion — EBITDA → FCFF (${f.unitLabel}) and FCFF / EBITDA`} option={charts.conversion} />
            <ChartBox title={`PV of FCFF by year and PV of terminal value (${f.unitLabel})`} option={charts.pvByYear} />
            <ChartBox title="PV contribution to enterprise value (% of EV)" option={charts.pvShare} />
            <ChartBox title={`Enterprise value split — explicit period vs terminal value (${primary === 'gordon' ? 'Gordon' : 'exit'})`} option={charts.evSplit} empty="Needs positive PV of flows and terminal value." />
            <ChartBox title={`Cumulative FCFF vs cumulative PV (${f.unitLabel})`} option={charts.cumulative} />
            <ChartBox title={`Implied share price vs WACC (${f.sym}) — ±2 WACC steps`} option={charts.priceVsWacc} />
            <ChartBox title={`Implied share price vs terminal growth (${f.sym}) — WACC ± 1 step`} option={charts.priceVsGrowth} />
          </div>
          {/* OPEN QUESTION: the old gallery's DCF "tornado" moved margin, growth, capex and tax by a
              fixed ±1 pp — a hard-coded band with no step input. Left out until the user picks the bump sizes. */}
        </Collapsible>
      </Sections>
    </div>
  );
}

/** The DCF-owned beta-peer reference table (betaPeerStats). Never drives the discount rate. */
function BetaPeers({ a, f, dcf, peers }) {
  const list = a.wacc.betaPeers || [];
  const t = a.company.taxRate / 100;
  if (!list.length) {
    return (
      <div className="tablewrap">
        <table className="fin"><thead><tr><th>Peer unlevered beta</th></tr></thead>
          <tbody><tr><td className="txt">No beta peers were entered in the Cost of capital step.</td></tr></tbody>
        </table>
      </div>
    );
  }
  if (!peers) {
    // betaPeerStats(a) is not available from the engine yet
    return <div className="sec-note">The peer beta statistics are not available yet.</div>;
  }
  const relever = (bu) => (fin(bu) && fin(dcf.de) ? bu * (1 + (1 - t) * dcf.de) : NaN);
  return (
    <div>
      <div className="tablewrap">
        <table className="fin">
          <thead><tr><th>Peer (reference only)</th><th>Levered β</th><th>D / E</th><th>Tax rate</th><th>Unlevered β</th></tr></thead>
          <tbody>
            {peers.rows.map((p, i) => (
              <tr key={p.id ?? i}>
                <td className="txt">{p.name || DASH}</td>
                <td>{f.dec(p.leveredBeta, 2)}</td>
                <td>{f.x(p.de)}</td>
                <td>{f.pct(p.taxRate)}</td>
                <td>{f.dec(p.unleveredBeta, 2)}</td>
              </tr>
            ))}
            <tr className="bold"><td>Mean</td><td /><td /><td /><td>{f.dec(peers.mean, 2)}</td></tr>
            <tr className="bold"><td>Median</td><td /><td /><td /><td>{f.dec(peers.median, 2)}</td></tr>
            <tr className="sechead"><td colSpan={5}>Relevered at your target D/E ({f.x(dcf.de)})</td></tr>
            <tr><td>Peer mean βU relevered</td><td colSpan={3} /><td>{f.dec(relever(peers.mean), 2)}</td></tr>
            <tr><td>Peer median βU relevered</td><td colSpan={3} /><td>{f.dec(relever(peers.median), 2)}</td></tr>
            <tr className="bold"><td>Your levered β — drives the WACC</td><td colSpan={3} /><td>{f.dec(dcf.leveredBeta, 2)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="sec-note" style={{ marginTop: 8 }}>
        Hamada unlevering with each peer's own tax rate. Reference only — the discount rate uses the beta you entered.
      </div>
    </div>
  );
}

/** The DCF charts from the old gallery (no scenario ghosts, no click-to-dock). */
function buildDcfCharts({ a, f, dcf, ops, labels, primary, pvTvPrimary, at, n }) {
  const zoom = { zoom: n > 9 };
  const pctF = (v) => f.pct(v);

  const fcfBuild = themed({
    tooltip: { ...tipBy({}, f.num), axisPointer: { type: 'shadow' } },
    xAxis: xCat(labels), yAxis: moneyAxis(f),
    series: [
      { name: 'NOPAT', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.tealDeep) }, data: dcf.nopat.map((v) => rnd(v)) },
      { name: 'D&A', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.teal) }, data: ops.da.map((v) => rnd(v)) },
      { name: 'Capex', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.outflow) }, data: ops.capex.map((v) => rnd(-v)) },
      { name: 'Δ NWC', type: 'bar', stack: 'f', itemStyle: { color: vgrad(COL.outflow2) }, data: ops.deltaNwc.map((v) => rnd(-v)) },
      lineSeries('FCFF', COL.green, dcf.fcff.map((v) => rnd(v))),
    ],
  }, zoom);

  const conversion = themed({
    tooltip: tipBy({ 'FCFF / EBITDA': pctF }, f.num),
    xAxis: xCat(labels),
    yAxis: [moneyAxis(f), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}%' } })],
    series: [
      barSeries('EBITDA', COL.tealDeep, ops.ebitda.map((v) => rnd(v)), { barMaxWidth: 30 }),
      barSeries('FCFF', COL.teal, dcf.fcff.map((v) => rnd(v)), { barMaxWidth: 30 }),
      lineSeries('FCFF / EBITDA', COL.gold, dcf.fcff.map((v, i) => (ops.ebitda[i] > 0 ? rnd((v / ops.ebitda[i]) * 100, 1) : null)), { yAxisIndex: 1 }),
    ],
  }, zoom);

  const pvByYear = themed({
    tooltip: { ...tipBy({}, f.num), axisPointer: { type: 'shadow' } },
    xAxis: xCat([...labels, 'TV']), yAxis: moneyAxis(f),
    series: [
      barSeries('PV of FCFF', COL.teal, [...dcf.pv.map((v) => rnd(v)), '-'], { barMaxWidth: 46 }),
      barSeries('PV of terminal value', COL.gold, [...dcf.pv.map(() => '-'), rnd(pvTvPrimary)], { barMaxWidth: 46 }),
    ],
  });

  const ev = dcf.pvSum + pvTvPrimary;
  const shareData = fin(ev) && ev > 0
    ? [...dcf.pv.map((v) => rnd((v / ev) * 100, 1)), rnd((pvTvPrimary / ev) * 100, 1)]
    : null;
  const pvShare = shareData && themed({
    tooltip: { ...tipBy({}, pctF), axisPointer: { type: 'shadow' } }, legend: { show: false },
    xAxis: xCat([...labels, 'TV']), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
    series: [{
      name: 'Share of EV', type: 'bar', barMaxWidth: 46,
      label: { show: labels.length <= 12, position: 'top', color: COL.axisStrong, fontSize: 10, formatter: (p) => `${p.value}%` },
      itemStyle: { color: (p) => vgrad(p.dataIndex === shareData.length - 1 ? COL.gold : COL.teal), borderRadius: [5, 5, 0, 0] },
      data: shareData,
    }],
  });

  const evSplit = ringOption([
    { name: 'PV of explicit FCFF', value: dcf.pvSum, color: COL.teal },
    { name: 'PV of terminal value', value: pvTvPrimary, color: COL.gold },
  ], f.num);

  const cumF = cumsum(dcf.fcff), cumP = cumsum(dcf.pv);
  const cumulative = themed({
    tooltip: tipBy({}, f.num),
    xAxis: xCat(labels, { boundaryGap: false }), yAxis: moneyAxis(f),
    series: [
      lineSeries('Cumulative FCFF', COL.teal, cumF.map((v) => rnd(v)), { area: true }),
      lineSeries('Cumulative PV of FCFF', COL.green, cumP.map((v) => rnd(v)), { area: true }),
    ],
  });

  // price curves: sampled across the same ±2-step range the grids use
  const px = a.company.currentPrice;
  const mktLine = fin(px) && px > 0 ? [{ yAxis: px, lineStyle: { color: COL.amber }, label: { formatter: `mkt ${f.gridPrice(px)}`, color: COL.amber } }] : [];
  const wStep = a.sens.dcf.waccStep, gStep = a.sens.dcf.gStep;
  const w0 = dcf.wacc, g0 = a.dcf.terminalGrowth;
  const sample = (lo, hi, k = 24) => Array.from({ length: k + 1 }, (_, i) => lo + ((hi - lo) * i) / k);
  let priceVsWacc = null, priceVsGrowth = null;
  if (fin(w0) && fin(wStep) && wStep > 0) {
    const xs = sample(w0 - 2 * wStep, w0 + 2 * wStep);
    const gordon = xs.map((w) => [+w.toFixed(3), rnd(at(null, w).gordon.price, 2)]);
    const exit = xs.map((w) => [+w.toFixed(3), rnd(at(null, w).exit.price, 2)]);
    priceVsWacc = themed({
      tooltip: { ...tipBy({}, f.gridPrice), axisPointer: { type: 'cross' } },
      xAxis: yVal({ name: 'WACC', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: COL.axis }, scale: true, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: f.short } }),
      series: [
        { ...lineSeries('Gordon growth', COL.teal, gordon, { symbol: false }), markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed' }, label: { color: COL.ref, fontSize: 11 }, data: [{ xAxis: +w0.toFixed(3), label: { formatter: 'base WACC' } }, ...mktLine] } },
        lineSeries('Exit multiple', COL.gold, exit, { symbol: false }),
      ],
    });
  }
  if (fin(w0) && fin(g0) && fin(gStep) && gStep > 0 && fin(wStep) && wStep > 0) {
    const xs = sample(g0 - 2 * gStep, g0 + 2 * gStep);
    const curve = (w) => xs.map((gv) => [+gv.toFixed(3), rnd(at({ terminalGrowth: gv }, w).gordon.price, 2)]);
    priceVsGrowth = themed({
      tooltip: { ...tipBy({}, f.gridPrice), axisPointer: { type: 'cross' } },
      xAxis: yVal({ name: 'terminal growth', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: COL.axis }, scale: true, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: f.short } }),
      series: [
        lineSeries(`WACC ${f.pct2(w0 + wStep)}`, COL.gold, curve(w0 + wStep), { symbol: false }),
        { ...lineSeries(`WACC ${f.pct2(w0)}`, COL.teal, curve(w0), { symbol: false }), markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed' }, label: { color: COL.ref, fontSize: 11, formatter: 'base g' }, data: [{ xAxis: +g0.toFixed(3) }, ...mktLine] } },
        lineSeries(`WACC ${f.pct2(w0 - wStep)}`, COL.green, curve(w0 - wStep), { symbol: false }),
      ],
    });
  }

  return {
    projection: projectionOption(f, labels, ops),
    growth: growthOption(f, labels, ops.growth),
    fcfBuild, conversion, pvByYear, pvShare, evSplit, cumulative, priceVsWacc, priceVsGrowth,
  };
}
