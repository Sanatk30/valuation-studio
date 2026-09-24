import React, { useMemo } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { themed, xCat, yVal, tipBy, agrad, refMarkLine, scenGhostSeries, COL } from '../lib/chartkit.js';
import { Anim } from '../lib/anim.jsx';
import { requestAssumption } from '../lib/assume.js';
import { applyScenario, SCENARIOS } from '../lib/engine/scenario.js';
import { computeLbo, lboSensitivity, lboHoldSensitivity } from '../lib/engine/lbo.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { editDriverValue } from '../lib/driverEdit.js';
import { periodLabels } from '../lib/period.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES, UNITS } from '../lib/format.js';

export default function LboTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const lbo = useMemo(() => computeLbo(am), [am]);
  const baseOps = useMemo(() => projectOperations(a), [a]);
  const canEdit = (a.settings.scenario || 'base') === 'base';
  const ed = (line, mode, raw, abs = false) =>
    canEdit
      ? { values: raw, onChange: (i, v) => set('drivers.perYear', editDriverValue(a, line, mode, i, abs ? Math.abs(v) : v)) }
      : undefined;
  const sens = useMemo(() => lboSensitivity(am), [am]);
  const hsens = useMemo(() => lboHoldSensitivity(am), [am]);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const num = (v) => fmtNum(v, 0, locale);
  const unitLabel = `${CURRENCIES[s.currency].symbol} ${UNITS[s.unit]}`;
  const l = a.lbo;

  const leverage = lbo.totalDebt0 / lbo.ebitda0;
  const n = lbo.ops.n;
  const yearLabels = useMemo(() => periodLabels(s, 'Y', n), [s, n]);

  // dashed Bear/Bull ghosts of the net-leverage path (and Base, in a scenario view)
  const scenOn = a.settings.scenOverlay ?? true;
  const scenario = a.settings.scenario || 'base';
  const scenLbo = useMemo(
    () => (scenOn
      ? Object.keys(SCENARIOS).filter((k) => k !== scenario)
          .map((k) => [k, computeLbo(applyScenario({ ...a, settings: { ...a.settings, scenario: k } }))])
      : []),
    [a, scenOn, scenario],
  );

  // debt paydown chart: stacked senior/mezz areas, cash build, net-leverage line, exit-year marker
  const debtOpt = useMemo(() => themed({
    tooltip: tipBy({ 'Net debt / EBITDA': (v) => fmtX(v, 2) }, (v) => fmtNum(v, 0, locale)),
    xAxis: xCat(yearLabels, { boundaryGap: false }),
    yAxis: [
      yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmtNum(v, 0, locale) } }),
      yVal({ position: 'right', splitLine: { show: false }, axisLabel: { color: COL.amber, formatter: '{value}x' } }),
    ],
    series: [
      {
        name: 'Senior', type: 'line', stack: 'd', smooth: true, showSymbol: false,
        lineStyle: { width: 1.6, color: COL.teal }, itemStyle: { color: COL.teal }, areaStyle: { color: agrad(COL.teal, 0.5, 0.06) },
        data: lbo.closeSenior.map(Math.round),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.ref, type: 'dashed', width: 1 }, label: { color: COL.ref, fontSize: 9.5, fontFamily: 'Inter, sans-serif', formatter: 'EXIT' }, data: [{ xAxis: yearLabels[lbo.exitYear - 1] }] },
      },
      { name: 'Mezzanine', type: 'line', stack: 'd', smooth: true, showSymbol: false, lineStyle: { width: 1.6, color: COL.violet }, itemStyle: { color: COL.violet }, areaStyle: { color: agrad(COL.violet, 0.5, 0.06) }, data: lbo.closeMezz.map(Math.round) },
      { name: 'Cash', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: COL.green }, itemStyle: { color: COL.green }, areaStyle: { color: agrad(COL.green, 0.2, 0.02) }, ...(l.minCash > 0 ? { markLine: refMarkLine([{ yAxis: Math.round(l.minCash), label: { formatter: 'cash floor', position: 'insideEndTop' } }]) } : {}), data: lbo.cashBal.map(Math.round) },
      { name: 'Net debt / EBITDA', yAxisIndex: 1, type: 'line', smooth: true, showSymbol: true, symbolSize: 5, lineStyle: { width: 2, color: COL.amber, type: 'dashed' }, itemStyle: { color: COL.amber }, data: lbo.levNet.map((v) => (isFinite(v) ? +v.toFixed(2) : null)) },
      ...scenLbo.map(([k, lb]) => scenGhostSeries(k, SCENARIOS[k].label, lb.levNet.map((v) => (isFinite(v) ? +v.toFixed(2) : null)), { yAxisIndex: 1 })),
    ],
  }, { zoom: n > 9 }), [lbo, yearLabels, locale, n, l.minCash, scenLbo]);

  return (
    <div className="view">
        <Hero
          eyebrow={`Leveraged buyout — sponsor IRR, ${lbo.exitYear}-year hold`}
          value={lbo.irr}
          fmt={(v) => fmtPct(v, 1)}
          sub={`Entry at ${fmtX(l.entryMultiple, 1)} LTM EBITDA with ${fmtX(leverage, 1)} of leverage; exit at ${fmtX(l.exitMultiple, 1)} in Year ${lbo.exitYear}. The floor price is the most a sponsor could pay and still clear the ${fmtPct(l.hurdleRate, 0)} hurdle.`}
          chips={[
            { label: 'MOIC', value: lbo.moic, fmt: (v) => fmtX(v, 2), tone: lbo.moic >= 2 ? 'pos' : undefined },
            { label: 'equity', value: lbo.sponsorEquity, fmt: (v) => fmtMoney(v, s) },
            { label: 'floor', value: lbo.floorPrice, fmt: (v) => fmtPrice(v, s) },
            { label: 'debt paid', value: (1 - (lbo.closeSenior[lbo.exitYear - 1] + lbo.closeMezz[lbo.exitYear - 1]) / lbo.totalDebt0) * 100, fmt: (v) => fmtPct(v, 0) },
          ]}
        />
        {lbo.sponsorEquity <= 0 && (
          <div className="warn">Debt exceeds total uses — sponsor equity is zero or negative. Reduce leverage.</div>
        )}
        {lbo.exitEquity <= 0 && lbo.sponsorEquity > 0 && (
          <div className="warn">Exit equity is negative — debt at exit exceeds the exit enterprise value.</div>
        )}
        <div className="cards">
          <div className="card hero">
            <div className="k">Sponsor IRR ({lbo.exitYear}-yr hold)</div>
            <div className={`v ${lbo.irr >= 20 ? 'pos' : lbo.irr < 12 ? 'neg' : ''}`}><Anim value={lbo.irr} fmt={(v) => fmtPct(v, 1)} /></div>
            <div className="s">MOIC {fmtX(lbo.moic, 2)} · no interim distributions</div>
          </div>
          <div className="card">
            <div className="k">Entry EV / Sponsor equity</div>
            <div className="v" style={{ fontSize: 17 }}>
              {fmtMoney(lbo.entryEV, s)} / {fmtMoney(lbo.sponsorEquity, s)}
            </div>
            <div className="s">Fees {fmtMoney(lbo.feesTxn, s)} txn + {fmtMoney(lbo.feesFin, s)} fin · {fmtX(leverage, 2)} levered</div>
          </div>
          <div className="card">
            <div className="k">Exit equity (Year {lbo.exitYear})</div>
            <div className="v"><Anim value={lbo.exitEquity} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">Exit EV {fmtMoney(lbo.exitEV, s)} − net debt {fmtMoney(lbo.netDebtExit, s)}</div>
          </div>
          <div className="card">
            <div className="k">LBO floor @ {fmtPct(l.hurdleRate, 1)} IRR</div>
            <div className="v"><Anim value={lbo.floorPrice} fmt={(v) => fmtPrice(v, s)} /></div>
            <div className="s">
              Max EV {fmtMoney(lbo.entryEvMax, s)} ({fmtX(lbo.entryEvMax / lbo.ebitda0, 2)})
              {a.company.currentPrice > 0 && <> · vs mkt {fmtPct((lbo.floorPrice / a.company.currentPrice - 1) * 100, 0)}</>}
            </div>
          </div>
        </div>

        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Debt paydown, cash build & net leverage ({unitLabel})</div>
            <LiveChart
              option={debtOpt} height={250}
              onEvents={{ click: (p) => requestAssumption({
                Senior: { labels: ['Senior debt (x LTM EBITDA)'], section: 'LBO — Debt Financing' },
                Mezzanine: { labels: ['Mezzanine debt (x LTM EBITDA)'], section: 'LBO — Debt Financing' },
                Cash: { labels: ['Cash sweep', 'Minimum operating cash'], section: 'LBO — Debt Financing' },
              }[p.seriesName] || { labels: ['Entry EV / EBITDA'], section: 'LBO — Transaction' }) }}
            />
          </div>
          <div className="chartbox">
            <div className="ct">Value creation — entry equity to exit equity ({unitLabel})</div>
            <Waterfall
              items={[
                { label: 'Entry equity', value: lbo.bridge.entryEquity, total: true },
                { label: 'Fees', value: lbo.bridge.fees },
                { label: 'EBITDA growth', value: lbo.bridge.ebitdaGrowth },
                { label: 'Multiple', value: lbo.bridge.multipleChange },
                { label: 'Deleveraging', value: lbo.bridge.deleveraging },
                { label: 'Exit equity', value: lbo.bridge.exitEquity, total: true },
              ]}
              fmt={num}
              height={250}
            />
          </div>
        </div>

        <h3 className="blocktitle">Sources & uses ({unitLabel})</h3>
        <div className="tablewrap" style={{ marginBottom: 20 }}>
          <table className="fin">
            <thead><tr><th>Uses</th><th></th><th>Sources</th><th></th><th>x LTM EBITDA</th></tr></thead>
            <tbody>
              <tr><td>Enterprise value @ {fmtX(l.entryMultiple, 2)}</td><td>{num(lbo.entryEV)}</td><td>Senior debt</td><td>{num(lbo.senior0)}</td><td>{fmtX(l.seniorX, 2)}</td></tr>
              <tr><td>Transaction fees</td><td>{num(lbo.feesTxn)}</td><td>Mezzanine {l.mezzPIK ? '(PIK)' : ''}</td><td>{num(lbo.mezz0)}</td><td>{fmtX(l.mezzX, 2)}</td></tr>
              <tr><td>Financing fees</td><td>{num(lbo.feesFin)}</td><td>Sponsor equity (plug)</td><td>{num(lbo.sponsorEquity)}</td><td>{fmtX(lbo.sponsorEquity / lbo.ebitda0, 2)}</td></tr>
              <tr className="bold"><td>Total uses</td><td>{num(lbo.uses)}</td><td>Total sources</td><td>{num(lbo.uses)}</td><td>{fmtX(lbo.uses / lbo.ebitda0, 2)}</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="blocktitle">Debt schedule & free cash flow ({unitLabel})</h3>
        <StatementTable
          labels={yearLabels}
          years={lbo.ops.years}
          rows={[
            { label: 'Revenue', values: lbo.ops.revenue, fmt: num, sub: true, edit: ed('revenue', 'abs', baseOps.revenue, true) },
            { label: 'EBITDA', values: lbo.ops.ebitda, fmt: num, bold: true, edit: ed('ebitda', 'abs', baseOps.ebitda, true) },
            { label: 'Less: D&A', values: lbo.ops.da.map((v) => -v), fmt: num, sub: true, edit: ed('da', 'abs', baseOps.da, true) },
            { label: 'Less: Cash interest', values: lbo.cashInterest.map((v) => -v), fmt: num, sub: true },
            { label: 'Less: PIK accrual (non-cash)', values: lbo.pikAccrual.map((v) => -v), fmt: num, sub: true },
            { label: 'Less: Financing-fee amortization', values: lbo.ops.years.map((_, i) => (i < lbo.exitYear ? -lbo.feeAmort : 0)), fmt: num, sub: true },
            { label: 'Pre-tax income', values: lbo.ebt, fmt: num },
            { label: 'Less: Tax', values: lbo.taxAmt.map((v) => -v), fmt: num, sub: true },
            { label: 'Net income', values: lbo.netIncome, fmt: num },
            { label: 'Add back non-cash (D&A, fees, PIK)', values: lbo.ops.years.map((_, i) => lbo.ops.da[i] + (i < lbo.exitYear ? lbo.feeAmort : 0) + lbo.pikAccrual[i]), fmt: num, sub: true },
            { label: 'Less: Capex', values: lbo.ops.capex.map((v) => -v), fmt: num, sub: true, edit: ed('capex', 'abs', baseOps.capex, true) },
            { label: 'Less: Δ NWC', values: lbo.ops.deltaNwc.map((v) => -v), fmt: num, sub: true, edit: ed('nwcDelta', 'abs', baseOps.deltaNwc) },
            { label: 'Free cash flow', values: lbo.fcf, fmt: num, bold: true },
            { label: 'Mandatory amortization', values: lbo.mandatory.map((v) => -v), fmt: num, sub: true },
            { label: 'Sweep — senior', values: lbo.sweepSenior.map((v) => -v), fmt: num, sub: true },
            { label: 'Sweep — mezzanine', values: lbo.sweepMezz.map((v) => -v), fmt: num, sub: true },
            { label: 'Closing senior debt', values: lbo.closeSenior, fmt: num },
            { label: 'Closing mezzanine', values: lbo.closeMezz, fmt: num },
            { label: 'Cash balance (floor ' + num(l.minCash) + ')', values: lbo.cashBal, fmt: num },
            { label: 'Net debt', values: lbo.closeSenior.map((v, i) => v + lbo.closeMezz[i] - lbo.cashBal[i]), fmt: num, bold: true },
          ]}
        />

        <div className="edit-note">
          {canEdit
            ? '✎ Revenue, EBITDA, D&A, capex and Δ NWC are direct inputs — click a cell and type (or hover to magnify); the debt schedule, IRR and sensitivities re-run instantly. Use Enter Data in the header to fill the whole model at once.'
            : 'Switch the scenario to Base to type into the cells.'}
        </div>

        <h3 className="blocktitle">Credit statistics</h3>
        <StatementTable
          labels={yearLabels}
          years={lbo.ops.years}
          rows={[
            { label: 'Gross leverage (Debt / EBITDA)', values: lbo.levGross, fmt: (v) => fmtX(v, 2) },
            { label: 'Net leverage', values: lbo.levNet, fmt: (v) => fmtX(v, 2) },
            { label: 'Cash interest coverage (EBITDA / interest)', values: lbo.coverage, fmt: (v) => (isFinite(v) ? fmtX(v, 1) : '∞') },
            { label: '% of original debt outstanding', values: lbo.closeSenior.map((v, i) => ((v + lbo.closeMezz[i]) / lbo.totalDebt0) * 100), fmt: (v) => fmtPct(v, 0) },
          ]}
        />

        <h3 className="blocktitle">Returns analysis — exit in any year @ {fmtX(l.exitMultiple, 1)} EV/EBITDA</h3>
        <StatementTable
          labels={yearLabels}
          years={lbo.ops.years}
          rows={[
            { label: 'EBITDA', values: lbo.ops.ebitda, fmt: num },
            { label: `Exit EV @ ${fmtX(l.exitMultiple, 2)}`, values: lbo.ops.ebitda.map((e) => e * l.exitMultiple), fmt: num },
            { label: 'Less: Net debt at exit', values: lbo.closeSenior.map((v, i) => -(v + lbo.closeMezz[i] - lbo.cashBal[i])), fmt: num, sub: true },
            { label: 'Exit equity value', values: lbo.ops.ebitda.map((e, i) => e * l.exitMultiple - (lbo.closeSenior[i] + lbo.closeMezz[i] - lbo.cashBal[i])), fmt: num, bold: true },
            { label: `MOIC (on ${num(lbo.sponsorEquity)} equity)`, values: lbo.ops.ebitda.map((e, i) => (e * l.exitMultiple - (lbo.closeSenior[i] + lbo.closeMezz[i] - lbo.cashBal[i])) / lbo.sponsorEquity), fmt: (v) => (isFinite(v) && v > 0 ? fmtX(v, 2) : '—') },
            { label: 'IRR', values: lbo.ops.ebitda.map((e, i) => {
                const m = (e * l.exitMultiple - (lbo.closeSenior[i] + lbo.closeMezz[i] - lbo.cashBal[i])) / lbo.sponsorEquity;
                return m > 0 ? (Math.pow(m, 1 / (i + 1)) - 1) * 100 : NaN;
              }), fmt: (v) => (isFinite(v) ? fmtPct(v, 1) : '—'), bold: true },
          ]}
        />
        <div className="sec-note" style={{ margin: '8px 2px 0' }}>
          Bottom-up: each year's exit equity = exit multiple × that year's EBITDA − net debt remaining on the schedule
          above. Your modeled exit (Year {lbo.exitYear}) is one column of this table.
        </div>

        <h3 className="blocktitle">Sensitivity — sponsor IRR</h3>
        <div className="grid2">
          <div>
            <div className="sec-note">Entry multiple (rows) × exit multiple (cols)</div>
            <Heatmap corner="Entry \ Exit" rowLabels={sens.entrySteps} colLabels={sens.exitSteps} grid={sens.grid}
              fmt={(v) => fmtPct(v, 1)} fmtRow={(v) => fmtX(v, 2)} fmtCol={(v) => fmtX(v, 2)} />
          </div>
          <div>
            <div className="sec-note">Holding period (rows) × exit multiple (cols)</div>
            <Heatmap corner="Hold \ Exit" rowLabels={hsens.years} colLabels={hsens.exitSteps} grid={hsens.grid}
              fmt={(v) => fmtPct(v, 1)} fmtRow={(v) => `${v}y`} fmtCol={(v) => fmtX(v, 2)} />
          </div>
        </div>

        <div className="footer-note">
          Entry at {fmtX(l.entryMultiple)} LTM EBITDA ({fmtMoney(lbo.ebitda0, s)}); uses include transaction fees
          ({fmtPct(l.feesPctEV, 1)} of EV) and financing fees ({fmtPct(l.finFeesPct, 1)} of debt, amortized over the hold
          as a non-cash tax shield). Interest accrues on opening balances{l.mezzPIK ? '; mezzanine interest is PIK and accretes to the balance' : ''}.
          FCF after mandatory amortization sweeps {fmtPct(l.sweepPct, 0)} into debt, capped so cash never falls below{' '}
          {fmtMoney(l.minCash, s)}. The LBO floor solves the entry EV at which the sponsor exactly earns the{' '}
          {fmtPct(l.hurdleRate, 1)} hurdle — the classic "what could a PE buyer pay" valuation reference.
        </div>
    </div>
  );
}
