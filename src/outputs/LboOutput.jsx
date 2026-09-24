import React, { useMemo } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import * as LBO from '../lib/engine/lbo.js';
import { periodLabels } from '../lib/period.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import SensStepInputs from './parts/SensStepInputs.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, upsidePct, upsideText, allFinite, rnd, attempt, tone } from './parts/format.js';
import {
  themed, xCat, yVal, tipBy, vgrad, agrad, refMarkLine, COL, barSeries, lineSeries, moneyAxis,
} from './parts/charts.js';
import { PALETTE } from '../lib/chartkit.js';

const DASH = '—';

/**
 * LBO output.
 * Props: { a, set, company, skipped } — `set` only for the grid / floor-range
 * step sizes (sens.lbo.*).
 */
export default function LboOutput({ a, set }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => ({
    lbo: LBO.computeLbo(a),
    sens: LBO.lboSensitivity(a),
    hold: LBO.lboHoldSensitivity(a),
  })), [a]);
  if (model.error) return <div className="qo"><EngineError what="The LBO" error={model.error} /></div>;
  return <LboPage a={a} set={set} f={f} {...model.value} />;
}

function LboPage({ a, set, f, lbo, sens, hold }) {
  const l = a.lbo;
  const ops = lbo.ops;
  const n = ops.n;
  const labels = useMemo(() => periodLabels(a.settings, 'Y', n), [a.settings, n]);
  const ey = lbo.exitYear;
  const px = a.company.currentPrice;
  const hasPx = fin(px) && px > 0;
  const hasCashAtClose = lbo.cashAtClose !== undefined;
  const hasNol = Array.isArray(lbo.nolOpen);
  const leverage = lbo.totalDebt0 / lbo.ebitda0;

  // LBO floor range: the floor at the hurdle ± one step
  const hStep = a.sens.lbo.hurdleStep;
  const floorAt = typeof lbo.floorAt === 'function' ? lbo.floorAt : null;
  const floorLo = floorAt && fin(hStep) ? floorAt(l.hurdleRate + hStep) : NaN;
  const floorHi = floorAt && fin(hStep) ? floorAt(l.hurdleRate - hStep) : NaN;

  const netDebtArr = lbo.closeSenior.map((v, i) => v + lbo.closeMezz[i] - lbo.cashBal[i]);
  const exitEqArr = ops.ebitda.map((e, i) => l.exitMultiple * e - netDebtArr[i]);
  const moicArr = exitEqArr.map((v) => (lbo.sponsorEquity > 0 ? v / lbo.sponsorEquity : NaN));
  const irrArr = moicArr.map((m, i) => (m > 0 ? (m ** (1 / (i + 1)) - 1) * 100 : NaN));
  const debtLeftPct = lbo.totalDebt0 > 0 ? ((lbo.closeSenior[ey - 1] + lbo.closeMezz[ey - 1]) / lbo.totalDebt0) * 100 : NaN;
  const sourcesTotal = lbo.senior0 + lbo.mezz0 + lbo.sponsorEquity;

  const bridgeItems = [
    { label: 'Entry equity', value: lbo.bridge.entryEquity, total: true },
    { label: 'Fees', value: lbo.bridge.fees },
    { label: 'EBITDA growth', value: lbo.bridge.ebitdaGrowth },
    { label: 'Multiple', value: lbo.bridge.multipleChange },
    { label: 'Deleveraging', value: lbo.bridge.deleveraging },
    { label: 'Exit equity', value: lbo.bridge.exitEquity, total: true },
  ];
  const bridgeOk = allFinite(bridgeItems.map((it) => it.value));

  const debtOpt = useMemo(() => themed({
    tooltip: tipBy({ 'Net debt / EBITDA': (v) => f.x(v) }, f.num),
    xAxis: xCat(labels, { boundaryGap: false }),
    yAxis: [moneyAxis(f), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.amber, formatter: '{value}x' } })],
    series: [
      {
        name: 'Senior', type: 'line', stack: 'd', smooth: true, showSymbol: false,
        lineStyle: { width: 1.6, color: COL.teal }, itemStyle: { color: COL.teal }, areaStyle: { color: agrad(COL.teal, 0.5, 0.06) },
        data: lbo.closeSenior.map((v) => rnd(v)),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed', width: 1 }, label: { color: COL.ref, fontSize: 9.5, formatter: 'EXIT' }, data: [{ xAxis: labels[ey - 1] }] },
      },
      { name: 'Mezzanine', type: 'line', stack: 'd', smooth: true, showSymbol: false, lineStyle: { width: 1.6, color: COL.violet }, itemStyle: { color: COL.violet }, areaStyle: { color: agrad(COL.violet, 0.5, 0.06) }, data: lbo.closeMezz.map((v) => rnd(v)) },
      {
        ...lineSeries('Cash', COL.green, lbo.cashBal.map((v) => rnd(v)), { symbol: false, width: 2 }),
        ...(fin(l.minCash) && l.minCash > 0 ? { markLine: refMarkLine([{ yAxis: Math.round(l.minCash), label: { formatter: 'cash floor', position: 'insideEndTop' } }]) } : {}),
      },
      lineSeries('Net debt / EBITDA', COL.amber, lbo.levNet.map((v) => rnd(v, 2)), { dashed: true, width: 2, yAxisIndex: 1 }),
    ],
  }, { zoom: n > 9 }), [lbo, labels, f, n, l.minCash, ey]);

  const charts = useMemo(() => {
    const irrByHold = themed({
      tooltip: tipBy({}, (v) => f.pct(v)),
      xAxis: xCat(hold.exitSteps.map((x) => f.x(x))), yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      series: hold.years.map((y, i) => ({
        ...lineSeries(`${y}-year hold`, PALETTE[i % PALETTE.length], hold.grid[i].map((v) => rnd(v, 1))),
        ...(i === 0 && fin(l.hurdleRate) ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.amber, type: 'dashed' }, label: { formatter: `hurdle ${f.pct(l.hurdleRate)}`, color: COL.amber, fontSize: 11 }, data: [{ yAxis: l.hurdleRate }] } } : {}),
      })),
    });
    const equityByYear = themed({
      tooltip: tipBy({ MOIC: (v) => f.x(v) }, f.num),
      xAxis: xCat(labels),
      yAxis: [moneyAxis(f), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.gold, formatter: '{value}x' } })],
      series: [
        { ...barSeries('Exit equity', COL.teal, exitEqArr.map((v) => rnd(v)), { barMaxWidth: 40 }), markLine: refMarkLine([{ xAxis: labels[ey - 1], label: { formatter: 'exit' } }]) },
        lineSeries('MOIC', COL.gold, moicArr.map((v) => rnd(v, 2)), { yAxisIndex: 1 }),
      ],
    });
    const su = themed({
      tooltip: { ...tipBy({}, f.num), axisPointer: { type: 'shadow' } },
      xAxis: xCat(['Uses', 'Sources']), yAxis: moneyAxis(f),
      series: [
        { name: 'Enterprise value', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.tealDeep) }, data: [rnd(lbo.entryEV), '-'] },
        { name: 'Transaction fees', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.outflow) }, data: [rnd(lbo.feesTxn), '-'] },
        { name: 'Financing fees', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.outflow2) }, data: [rnd(lbo.feesFin), '-'] },
        ...(hasCashAtClose ? [{ name: 'Cash at close', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.cyan) }, data: [rnd(lbo.cashAtClose), '-'] }] : []),
        { name: 'Senior debt', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.rose) }, data: ['-', rnd(lbo.senior0)] },
        { name: 'Mezzanine', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.violet) }, data: ['-', rnd(lbo.mezz0)] },
        { name: 'Sponsor equity', type: 'bar', stack: 's', itemStyle: { color: vgrad(COL.green) }, data: ['-', rnd(lbo.sponsorEquity)] },
      ],
    });
    const credit = themed({
      tooltip: { ...tipBy({}, (v) => f.x(v)), axisPointer: { type: 'shadow' } },
      xAxis: xCat(labels),
      yAxis: [yVal({ axisLabel: { color: COL.axis, formatter: '{value}x' } }), yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.green, formatter: '{value}x' } })],
      series: [
        barSeries('Net debt / EBITDA', COL.outflow, lbo.levNet.map((v) => rnd(v, 2)), { barMaxWidth: 40 }),
        lineSeries('EBITDA / cash interest', COL.green, lbo.coverage.map((v) => rnd(v, 2)), { yAxisIndex: 1 }),
      ],
    });
    return { irrByHold, equityByYear, su, credit };
  }, [lbo, hold, labels, f, l.hurdleRate, ey, hasCashAtClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const amortRow = ops.years.map((_, i) => (i < ey ? lbo.feeAmort : 0));
  const scheduleRows = [
    { label: 'Revenue', values: ops.revenue, fmt: f.num, sub: true },
    { label: 'EBITDA', values: ops.ebitda, fmt: f.num, bold: true },
    { label: 'Less: D&A', values: ops.da.map((v) => -v), fmt: f.num, sub: true },
    { label: 'EBIT', values: ops.ebit, fmt: f.num },
    { label: 'Less: cash interest', values: lbo.cashInterest.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Less: PIK interest (non-cash)', values: lbo.pikAccrual.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Less: financing-fee amortisation', values: amortRow.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Pre-tax income', values: lbo.ebt, fmt: f.num },
    ...(hasNol ? [
      { label: 'Memo: tax-loss (NOL) balance — opening', values: lbo.nolOpen, fmt: f.num, sub: true },
      { label: 'Memo: NOL used', values: lbo.nolUsed, fmt: f.num, sub: true },
      { label: 'Memo: NOL balance — closing', values: lbo.nolClose, fmt: f.num, sub: true },
    ] : []),
    { label: 'Less: tax', values: lbo.taxAmt.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Net income', values: lbo.netIncome, fmt: f.num, bold: true },
    { label: 'Add back: D&A, fee amortisation, PIK', values: ops.years.map((_, i) => ops.da[i] + amortRow[i] + lbo.pikAccrual[i]), fmt: f.num, sub: true },
    { label: 'Less: capex', values: ops.capex.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Less: increase in NWC', values: ops.deltaNwc.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Free cash flow', values: lbo.fcf, fmt: f.num, bold: true },
    { sechead: true, label: 'Debt and cash' },
    { label: 'Mandatory amortisation', values: lbo.mandatory.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Cash sweep — senior', values: lbo.sweepSenior.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Cash sweep — mezzanine', values: lbo.sweepMezz.map((v) => -v), fmt: f.num, sub: true },
    { label: 'Closing senior debt', values: lbo.closeSenior, year0: lbo.senior0, fmt: f.num },
    { label: 'Closing mezzanine', values: lbo.closeMezz, year0: lbo.mezz0, fmt: f.num },
    { label: `Cash balance (floor ${f.num(l.minCash)})`, values: lbo.cashBal, year0: hasCashAtClose ? lbo.cashAtClose : undefined, fmt: f.num },
    { label: 'Net debt', values: netDebtArr, year0: hasCashAtClose ? lbo.senior0 + lbo.mezz0 - lbo.cashAtClose : undefined, fmt: f.num, bold: true },
  ];

  const x0 = (v) => f.x(v / lbo.ebitda0);
  const upFloor = upsideText(lbo.floorPrice, px);

  return (
    <div className="qo">
      <Headline
        eyebrow={`Leveraged buyout — sponsor IRR, ${ey}-year hold`}
        value={lbo.irr}
        fmt={(v) => f.pct(v)}
        sub={`Entry at ${f.x1(l.entryMultiple)} LTM EBITDA (${f.money(lbo.ebitda0)}) with ${f.x1(leverage)} of debt; exit at ${f.x1(l.exitMultiple)} in ${labels[ey - 1] || `year ${ey}`}. The LBO floor is the most a sponsor could pay per share and still earn the ${f.pct(l.hurdleRate)} hurdle.${upFloor ? ` Floor is ${upFloor} to the market price of ${f.price(px)}.` : ''}`}
        warnings={[
          !(lbo.sponsorEquity > 0) && 'Debt covers all of the uses — sponsor equity is zero, so IRR and MOIC are not meaningful. Reduce the debt in the Debt structure step.',
          lbo.sponsorEquity > 0 && !(lbo.exitEquity > 0) && 'Exit equity is negative — debt left at exit exceeds the exit enterprise value.',
        ]}
        kpis={[
          { label: 'MOIC', value: lbo.moic, fmt: (v) => f.x(v), sub: 'no interim distributions' },
          { label: `LBO floor @ ${f.pct(l.hurdleRate)} hurdle`, value: lbo.floorPrice, fmt: (v) => f.price(v), hero: true,
            tone: hasPx ? tone(upsidePct(lbo.floorPrice, px)) : undefined,
            sub: `${f.price(floorLo)} – ${f.price(floorHi)} at hurdle ± ${f.pct(hStep)}` },
          hasPx && { label: 'Floor vs market price', value: upsidePct(lbo.floorPrice, px), fmt: (v) => `${v >= 0 ? '+' : ''}${f.pct(v)}`, tone: tone(upsidePct(lbo.floorPrice, px)), sub: `market ${f.price(px)}` },
          { label: 'Entry EV · sponsor equity', text: `${f.money(lbo.entryEV)} · ${f.money(lbo.sponsorEquity)}`, sub: `fees ${f.money(lbo.feesTxn)} transaction + ${f.money(lbo.feesFin)} financing` },
          { label: `Exit equity (${labels[ey - 1] || `year ${ey}`})`, value: lbo.exitEquity, fmt: (v) => f.money(v), sub: `exit EV ${f.money(lbo.exitEV)} − net debt ${f.money(lbo.netDebtExit)}` },
          { label: 'Debt repaid by exit', value: fin(debtLeftPct) ? 100 - debtLeftPct : NaN, fmt: (v) => f.pct0(v), sub: `of ${f.money(lbo.totalDebt0)} raised` },
        ]}
      >
        <div className="grid2">
          <ChartBox title={`Debt paydown, cash build and net leverage (${f.unitLabel})`} option={debtOpt} />
          <div className="chartbox">
            <div className="ct">Value creation — entry equity to exit equity ({f.unitLabel})</div>
            {bridgeOk ? <Waterfall items={bridgeItems} fmt={f.num} /> : <div className="sec-note">A bridge step is NA, so the bridge can't be drawn.</div>}
          </div>
        </div>
      </Headline>

      <Sections>
        <Collapsible title={`Sources & uses at close (${f.unitLabel})`} tag="S&U">
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th>Uses</th><th /><th>x LTM EBITDA</th></tr></thead>
                <tbody>
                  <tr><td>Enterprise value @ {f.x(l.entryMultiple)}</td><td>{f.num(lbo.entryEV)}</td><td>{x0(lbo.entryEV)}</td></tr>
                  <tr><td>Transaction fees ({f.pct(l.feesPctEV)} of EV)</td><td>{f.num(lbo.feesTxn)}</td><td>{x0(lbo.feesTxn)}</td></tr>
                  <tr><td>Financing fees ({f.pct(l.finFeesPct)} of debt)</td><td>{f.num(lbo.feesFin)}</td><td>{x0(lbo.feesFin)}</td></tr>
                  {hasCashAtClose && <tr><td>Cash left on the balance sheet at close</td><td>{f.num(lbo.cashAtClose)}</td><td>{x0(lbo.cashAtClose)}</td></tr>}
                  <tr className="bold"><td>Total uses</td><td>{f.num(lbo.uses)}</td><td>{x0(lbo.uses)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th>Sources</th><th /><th>x LTM EBITDA</th></tr></thead>
                <tbody>
                  <tr><td>Senior debt @ {f.pct(l.seniorRate)}</td><td>{f.num(lbo.senior0)}</td><td>{f.x(l.seniorX)}</td></tr>
                  <tr><td>Mezzanine @ {f.pct(l.mezzRate)}{l.mezzPIK ? ' (PIK)' : ''}</td><td>{f.num(lbo.mezz0)}</td><td>{f.x(l.mezzX)}</td></tr>
                  <tr><td>Sponsor equity (plug)</td><td>{f.num(lbo.sponsorEquity)}</td><td>{x0(lbo.sponsorEquity)}</td></tr>
                  <tr className="bold"><td>Total sources</td><td>{f.num(sourcesTotal)}</td><td>{x0(sourcesTotal)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="qo-note">Entry EV = entry multiple × LTM EBITDA; debt is sized as multiples of LTM EBITDA and equity is the plug.</div>
        </Collapsible>

        <Collapsible title={`Debt schedule and free cash flow (${f.unitLabel})`} tag="DEBT">
          <StatementTable labels={labels} years={ops.years} showYear0 rows={scheduleRows} />
          <div className="qo-note">
            Interest accrues on opening balances{l.mezzPIK ? '; mezzanine interest is PIK and accretes to the balance' : ''}. After mandatory
            amortisation, {f.pct0(l.sweepPct)} of free cash flow sweeps into debt (senior first), capped so cash never falls below{' '}
            {f.money(l.minCash)}. Financing fees amortise over the hold as a non-cash, tax-deductible charge. Loss years pay no tax and build a tax-loss balance used against later profits.
          </div>
        </Collapsible>

        <Collapsible title="Credit statistics" tag="CREDIT">
          <StatementTable labels={labels} years={ops.years} rows={[
            { label: 'Gross leverage (debt / EBITDA)', values: lbo.levGross, fmt: (v) => f.x(v) },
            { label: 'Net leverage (net debt / EBITDA)', values: lbo.levNet, fmt: (v) => f.x(v) },
            { label: 'Cash interest coverage (EBITDA / cash interest)', values: lbo.coverage, fmt: (v) => (fin(v) ? f.x1(v) : 'n/m') },
            { label: '% of original debt outstanding', values: lbo.closeSenior.map((v, i) => (lbo.totalDebt0 > 0 ? ((v + lbo.closeMezz[i]) / lbo.totalDebt0) * 100 : NaN)), fmt: (v) => f.pct0(v) },
          ]} />
          <ChartBox title="Net leverage (×) and cash interest coverage (×)" option={charts.credit} />
        </Collapsible>

        <Collapsible title={`Returns analysis — exit in any year @ ${f.x1(l.exitMultiple)} EV/EBITDA`} tag="RETURNS">
          <StatementTable labels={labels} years={ops.years} rows={[
            { label: 'EBITDA', values: ops.ebitda, fmt: f.num },
            { label: `Exit EV @ ${f.x(l.exitMultiple)}`, values: ops.ebitda.map((e) => e * l.exitMultiple), fmt: f.num },
            { label: 'Less: net debt at exit', values: netDebtArr.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Exit equity value', values: exitEqArr, fmt: f.num, bold: true },
            { label: `MOIC (on ${f.num(lbo.sponsorEquity)} equity)`, values: moicArr, fmt: (v) => (fin(v) && v > 0 ? f.x(v) : DASH) },
            { label: 'IRR', values: irrArr, fmt: (v) => f.pct(v), bold: true },
          ]} />
          <div className="qo-note">Each year's exit equity = exit multiple × that year's EBITDA − the net debt left on the schedule above. Your modelled exit ({labels[ey - 1] || `year ${ey}`}) is one column of this table.</div>
          <ChartBox title={`Sponsor equity if exited each year (${f.unitLabel}) and MOIC`} option={charts.equityByYear} />
        </Collapsible>

        <Collapsible title="Value-creation bridge" tag="BRIDGE">
          <div className="tablewrap">
            <table className="fin qo-kv">
              <tbody>
                <tr><td>Entry equity (sponsor cheque)</td><td>{f.num(lbo.bridge.entryEquity)}</td></tr>
                <tr className="sub"><td>Less: fees</td><td>{f.num(lbo.bridge.fees)}</td></tr>
                <tr><td>EBITDA growth × entry multiple</td><td>{f.num(lbo.bridge.ebitdaGrowth)}</td></tr>
                <tr><td>Multiple expansion / (contraction) × exit EBITDA</td><td>{f.num(lbo.bridge.multipleChange)}</td></tr>
                <tr><td>Deleveraging (entry net debt − exit net debt)</td><td>{f.num(lbo.bridge.deleveraging)}</td></tr>
                <tr className="bold"><td>Exit equity</td><td>{f.num(lbo.bridge.exitEquity)}</td></tr>
              </tbody>
            </table>
          </div>
        </Collapsible>

        <Collapsible title="LBO floor — the most a sponsor could pay" tag="FLOOR" note={`${f.price(lbo.floorPrice)} per share`}>
          <SensStepInputs a={a} set={set} items={[{ path: 'sens.lbo.hurdleStep', label: 'Hurdle step (range)', suffix: '% pts' }]} />
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th /><th>Hurdle + step</th><th>Your hurdle</th><th>Hurdle − step</th></tr></thead>
              <tbody>
                <tr className="sub"><td>Hurdle IRR</td><td>{f.pct(l.hurdleRate + hStep)}</td><td>{f.pct(l.hurdleRate)}</td><td>{f.pct(l.hurdleRate - hStep)}</td></tr>
                <tr className="bold"><td>Floor price per share</td><td>{f.price(floorLo)}</td><td>{f.price(lbo.floorPrice)}</td><td>{f.price(floorHi)}</td></tr>
                {hasPx && <tr className="sub"><td>vs market ({f.price(px)})</td><td>{f.pct(upsidePct(floorLo, px))}</td><td>{f.pct(upsidePct(lbo.floorPrice, px))}</td><td>{f.pct(upsidePct(floorHi, px))}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="tablewrap">
            <table className="fin qo-kv">
              <tbody>
                <tr><td>Exit equity (fixed by the operating plan and debt schedule)</td><td>{f.num(lbo.exitEquity)}</td></tr>
                <tr><td>Maximum entry enterprise value at the hurdle</td><td>{f.num(lbo.entryEvMax)}</td></tr>
                <tr className="sub"><td>Implied maximum entry multiple</td><td>{x0(lbo.entryEvMax)}</td></tr>
                <tr className="sub"><td>Less: current net debt</td><td>{f.num(-(a.company.grossDebt - a.company.cash))}</td></tr>
                <tr className="sub"><td>÷ Shares outstanding</td><td>{f.shares(a.company.sharesOut)}</td></tr>
                <tr className="bold"><td>LBO floor price</td><td>{f.price(lbo.floorPrice)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="qo-note">Exit equity does not depend on the entry price, so the floor solves the entry EV at which the sponsor earns exactly the hurdle.</div>
        </Collapsible>

        <Collapsible title="Sensitivity — sponsor IRR" tag="SENS" note="steps editable">
          <div className="qo-sens">
            <div className="qo-sens-cell">
              <div className="qo-sub">Entry multiple (rows) × exit multiple (columns)</div>
              <SensStepInputs a={a} set={set} items={[
                { path: 'sens.lbo.entryStep', label: 'Entry step', suffix: 'x' },
                { path: 'sens.lbo.exitStep', label: 'Exit step', suffix: 'x' },
              ]} />
              <Heatmap corner="Entry \ Exit" rowLabels={sens.entrySteps} colLabels={sens.exitSteps} grid={sens.grid}
                fmt={(v) => f.pct(v)} fmtRow={(v) => f.x(v)} fmtCol={(v) => f.x(v)} />
            </div>
            <div className="qo-sens-cell">
              <div className="qo-sub">Holding period (rows) × exit multiple (columns)</div>
              <SensStepInputs a={a} set={set} items={[{ path: 'sens.lbo.exitStep', label: 'Exit step', suffix: 'x' }]} />
              <Heatmap corner="Hold \ Exit" rowLabels={hold.years} colLabels={hold.exitSteps} grid={hold.grid}
                fmt={(v) => f.pct(v)} fmtRow={(v) => `${v}y`} fmtCol={(v) => f.x(v)} />
            </div>
          </div>
          <div className="qo-note">Multiples run two steps either side of your entry and exit multiples. The holding-period grid exits the modelled debt schedule in other years. n/m = equity at entry or exit not positive.</div>
          <ChartBox title="Sponsor IRR vs exit multiple, by holding period" option={charts.irrByHold} />
        </Collapsible>

        <Collapsible title="More charts" tag="CHARTS">
          <div className="grid2">
            <ChartBox title={`Sources & uses at close (${f.unitLabel})`} option={charts.su} />
            <ChartBox title={`Sponsor equity if exited each year (${f.unitLabel}) and MOIC`} option={charts.equityByYear} />
          </div>
        </Collapsible>
      </Sections>
    </div>
  );
}
