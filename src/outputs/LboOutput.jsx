import React, { useMemo } from 'react';
import Heatmap from '../components/Heatmap.jsx';
import Waterfall from '../components/Waterfall.jsx';
import { computeLboT, repayKind, LBO_DRIVERS } from '../lib/engine/lboTemplate.js';
import { fmtTpl } from '../lib/format.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, rnd, tone, attempt } from './parts/format.js';
import { themed, xCat, tipBy, COL, lineSeries, moneyAxis, yVal, axisName, alpha } from './parts/charts.js';

/**
 * LBO output — the chosen template's Sources & Uses, Returns (exit waterfall,
 * IRR / MOIC, value creation bridge), the four sensitivity tables and the LBO
 * Model behind them. Every figure is the engine's (lboTemplate.js), which
 * reproduces the template's formulas.
 */
export default function LboOutput({ a }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => computeLboT(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The LBO" error={model.error} /></div>;
  return <LboPage a={a} f={f} r={model.value} />;
}

const num = (v) => (fin(v) ? v : NaN);

function LboPage({ a, f, r }) {
  const L = f.locale;
  const t = (x, fmt = 'n1') => fmtTpl(x, fmt, L);
  const x2 = (v) => (fin(v) ? `${v.toFixed(2)}x` : 'NM');
  const { n, m, F, S, C } = r;
  const hold = r.labels.fcst;
  const yearsWithEntry = [r.labels.hist[n - 1], ...hold];
  const kind = repayKind(r.repay);
  const shortYears = hold.filter((_, j) => C.shortfall[j] === 'SHORTFALL');
  const fullYears = hold.filter((_, j) => C.headroom[j] !== 'OK');
  // a blank driver counts as 0 (as in the template) — name the years where any is blank
  const stored = a.lbo?.drivers || {};
  const blankYears = hold.filter((_, j) => LBO_DRIVERS.some((d) => d.key && !fin(stored[d.key]?.[j])));

  /* ---------------- charts ---------------- */
  const b = r.bridge;
  const bridgeItems = [
    { label: 'Entry equity', value: b.entry, total: true },
    { label: 'EBITDA growth', value: b.parts[0] },
    { label: 'Multiple exp.', value: b.parts[1] },
    { label: 'Net debt reduction', value: b.parts[2] },
    { label: 'Fees', value: b.parts[3] },
    { label: 'Exit equity', value: b.exit, total: true },
  ];
  const debtOpt = themed({
    tooltip: { ...tipBy({ 'Net debt / EBITDA': (v) => `${v}x` }, f.num), axisPointer: { type: 'shadow' } },
    xAxis: xCat(yearsWithEntry),
    yAxis: [moneyAxis(f, axisName(f.unitLabel, 14)), yVal({ position: 'right', splitLine: { show: false }, ...axisName('× EBITDA', 14), axisLabel: { color: COL.gold, formatter: '{value}x' } })],
    series: [
      { name: 'Senior A', type: 'bar', stack: 'd', barMaxWidth: 38, itemStyle: { color: COL.teal }, data: [r.tranches.senA.amount, ...S.aClose].map((v) => rnd(v)) },
      { name: 'Senior B', type: 'bar', stack: 'd', barMaxWidth: 38, itemStyle: { color: alpha(COL.teal, 0.55) }, data: [r.tranches.senB.amount, ...S.bClose].map((v) => rnd(v)) },
      { name: 'Mezzanine (incl. PIK)', type: 'bar', stack: 'd', barMaxWidth: 38, itemStyle: { color: COL.violet }, data: [r.tranches.mezz.amount, ...S.mClose].map((v) => rnd(v)) },
      ...(r.rcf.commit > 0 ? [{ name: 'Revolver', type: 'bar', stack: 'd', barMaxWidth: 38, itemStyle: { color: COL.red }, data: [0, ...S.rClose].map((v) => rnd(v)) }] : []),
      { ...lineSeries('Net debt / EBITDA', COL.gold, C.ndEbitda.map((v) => rnd(v, 2)), { yAxisIndex: 1 }), label: { show: C.ndEbitda.length <= 8, position: 'top', color: COL.gold, fontSize: 10, formatter: (p) => (Number.isFinite(p.value) ? `${p.value.toFixed(1)}x` : '') } },
    ],
  });

  /* ---------------- tables ---------------- */
  const cols = [...r.labels.hist, ...hold];
  const yr = (i) => (i < n - 1 ? '' : i - (n - 1));
  const FROWS = [
    ['OPERATING MODEL'],
    ['Revenue from Operations', F.rev], ['  Revenue growth', F.growth, 'pct'],
    ['Cost of Materials', F.materials], ['Employee Benefits Expense', F.employee], ['Other Expenses', F.otherExp],
    ['EBITDA', F.ebitda, 'n1', true], ['  EBITDA margin', F.margin, 'pct'], ['Depreciation & Amortisation', F.da], ['EBIT', F.ebit, 'n1', true],
    ['Interest – Senior A', S.intA, 'n1', false, true], ['Interest – Senior B', S.intB, 'n1', false, true],
    ['Interest – Mezzanine (cash)', S.intMezz, 'n1', false, true], ['Interest – Revolver (drawn) + commitment fee', S.intRcf, 'n1', false, true], ['Interest – Mezzanine (PIK, non-cash)', S.pik, 'n1', false, true],
    ['Amortisation of financing fees (non-cash)', S.feeAmort, 'n1', false, true],
    ['Profit Before Tax', S.pbt, 'n1', true, true], ['Tax', S.tax, 'n1', false, true], ['Net Income', S.ni, 'n1', true, true],
    ['WORKING CAPITAL & CAPEX'],
    ['Inventories', F.inv], ['Trade Receivables', F.rec], ['Other Current Assets', F.oca], ['Trade Payables', F.pay],
    ['Other Current Liabilities & Provisions', F.ocl], ['Net Working Capital', F.nwc, 'n1', true], ['Increase / (Decrease) in NWC', F.dNwc], ['Capex', F.capex],
    ['FREE CASH FLOW AVAILABLE FOR DEBT REPAYMENT'],
    ['(−) Lease payments (Ind AS 116)', S.leasePay, 'n1', false, true],
    ['Free Cash Flow', S.fcf, 'n1', true, true],
    ['CASH & DEBT SCHEDULE'],
    ['Opening cash', S.cashOpen, 'n1', false, true], ['(+) Free cash flow', S.fcf, 'n1', false, true], ['(−) Mandatory repayments (incl. balloon at maturity)', S.mand, 'n1', false, true],
    ['Cash after mandatory repayments', S.cashAfter, 'n1', false, true],
    ['(+) Revolver draw', S.rcfDraw, 'n1', false, true], ['(−) Revolver repayment', S.rcfRepay, 'n1', false, true],
    ['(−) Minimum cash balance', S.minCash, 'n1', false, true],
    [r.repay === 'mandatory' ? 'Cash available for sweep (none in this structure)' : 'Cash available for sweep', S.avail, 'n1', false, true], ['(−) Cash sweep', S.sweep, 'n1', false, true],
    ['Closing cash', [r.entry.cashAfter, ...S.cashClose], 'n1', true, 'entry'],
    ['Revolver — closing balance', [0, ...S.rClose], 'n1', false, 'entry'],
    ['Revolver — undrawn commitment (opening)', S.rUndrawn, 'n1', false, true],
    ['Senior A — closing balance', [r.tranches.senA.amount, ...S.aClose], 'n1', false, 'entry'],
    ['Senior B — closing balance', [r.tranches.senB.amount, ...S.bClose], 'n1', false, 'entry'],
    ['Mezzanine — closing balance (incl. PIK)', [r.tranches.mezz.amount, ...S.mClose], 'n1', false, 'entry'],
    ['CREDIT STATISTICS'],
    ['Total debt (incl. revolver)', C.totalDebt, 'n1', true, 'entry'], ['Lease liabilities (held constant)', C.leases, 'n1', false, 'entry'], ['Net debt', C.netDebt, 'n1', true, 'entry'],
    ['Total debt / EBITDA', C.debtEbitda, 'x', false, 'entry'], ['Net debt / EBITDA', C.ndEbitda, 'x', false, 'entry'],
    ['EBITDA / Cash interest', C.intCover, 'x', false, true], ['Cumulative senior debt repaid (% of original)', C.seniorRepaid, 'pct', false, true],
    ['Cash shortfall check (after revolver)', C.shortfall, 'txt', false, true],
    ['Revolver headroom check', C.headroom, 'txt', false, true],
  ];
  /** Values across all columns: full (n + m), hold years only, or entry + hold. */
  const spread = (vals, part) => (part === true ? [...Array(n).fill(null), ...vals] : part === 'entry' ? [...Array(n - 1).fill(null), ...vals] : vals);

  const su = r.su;
  const USES = ['Equity purchase price', 'Refinance existing borrowings', 'Transaction fees', 'Financing fees'];
  const SRCS = ['Senior A (Term Loan A)', 'Senior B (Term Loan B)', 'Mezzanine', 'Existing cash used', 'Sponsor equity (balancing figure)'];
  const w = r.exit;
  const ss = r.sens;
  const heat = (grid) => grid.map((row) => row.map((v) => (fin(v) ? v : NaN)));

  return (
    <div className="qo">
      {[
          blankYears.length ? `Blank operating drivers in ${blankYears.join(', ')} count as 0, as in the template — fill them on the Assumptions step.` : null,
          shortYears.length ? `Cash goes negative in ${shortYears.join(', ')} — ${r.repay === 'sweep'
            ? 'free cash flow is negative and larger than the cash on hand (there are no mandatory repayments)'
            : 'mandatory repayments exceed the cash available (opening cash plus free cash flow)'}, even after the revolver; it would need a larger revolver or lower leverage.` : null,
          fullYears.length ? `The revolver is fully drawn (or over its limit) in ${fullYears.join(', ')}.` : null,
          r.mezzWarn ? r.mezzWarn.replace(/^⚠ /, '') + '.' : null,
          su.sponsor < 0 ? 'Sponsor equity is negative — the structure is over-levered.' : null,
          r.entry.cashWarn ? 'The existing cash used exceeds the existing cash on the balance sheet.' : null,
          su.check !== 0 ? `Sources − uses = ${t(su.check)} (must be 0).` : null,
        ].filter(Boolean).map((x) => <div key={x} className="warn2" style={{ marginBottom: 10 }}>{x}</div>)}
      <div className="yby">
        <div className="yc dark"><h4>Entry <span>{r.labels.hist[n - 1]}</span></h4>
          <div className="r"><span>EBITDA</span><b>{f.num(F.ebitda[n - 1])}</b></div><div className="r"><span>Debt</span><b>{f.num(C.totalDebt[0])}</b></div>
          <div className="r"><span>Leverage</span><b>{t(C.debtEbitda[0], 'x')}</b></div><div className="r"><span>Equity in</span><b>{f.num(su.sponsor)}</b></div></div>
        {hold.map((lab, j) => (
          <div className="yc" key={lab}><h4>Year {j + 1} <span>{lab}</span></h4>
            <div className="r"><span>EBITDA</span><b>{f.num(F.ebitda[n + j])}</b></div><div className="r"><span>Debt</span><b>{f.num(C.totalDebt[j + 1])}</b></div>
            <div className="r"><span>Leverage</span><b>{t(C.debtEbitda[j + 1], 'x')}</b></div>
            <div className="r"><span>Repaid</span><b className={C.totalDebt[j] - C.totalDebt[j + 1] >= 0 ? 'up' : 'dn'}>{f.num(C.totalDebt[j] - C.totalDebt[j + 1])}</b></div></div>
        ))}
        <div className="yc teal"><h4>Exit</h4>
          <div className="r"><span>Exit EV</span><b>{f.num(w.ev)}</b></div><div className="r"><span>Equity out</span><b>{f.num(w.equity)}</b></div>
          <div className="yc-big">{fin(r.irr) ? t(r.irr, 'pct') : 'NM'}</div><div className="yc-s">IRR · {x2(r.moic)}</div></div>
      </div>
      <div className="grid2" style={{ marginBottom: 18 }}>
        <ChartBox title={`Debt paydown by tranche (${f.unitLabel}) and leverage`} sub="Closing debt stacked by tranche; net debt / EBITDA on the right axis" option={debtOpt} />
        <div className="chartbox">
          <div className="ct">IRR sensitivity — entry multiple ↓ · exit multiple →</div>
          <Heatmap corner="Entry ↓ / exit →" rowLabels={ss.entryRows} colLabels={ss.exitRows} grid={heat(ss.multIrr)} fmt={(v) => t(v, 'pct')} fmtRow={(v) => t(v, 'x')} fmtCol={(v) => t(v, 'x')} />
        </div>
      </div>

      <Sections>
        <Collapsible title="Sources & Uses of funds (at entry)" tag="S&U" defaultOpen>
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin compact">
                <thead><tr><th>Uses</th><th>{f.unitLabel}</th><th>% of total</th><th>x EBITDA</th></tr></thead>
                <tbody>
                  {USES.map((lab, i) => <tr key={lab}><td>{lab}</td><td>{t(su.uses[i])}</td><td>{t(su.usesPct[i], 'pct')}</td><td>{t(su.usesX[i], 'x')}</td></tr>)}
                  <tr className="tp-sub"><td>Total uses</td><td>{t(su.totalUses)}</td><td>{t(su.usesPct[4], 'pct')}</td><td>{t(su.usesX[4], 'x')}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="tablewrap">
              <table className="fin compact">
                <thead><tr><th>Sources</th><th>{f.unitLabel}</th><th>% of total</th><th>x EBITDA</th></tr></thead>
                <tbody>
                  {SRCS.map((lab, i) => <tr key={lab} className={i === 4 ? 'bold' : ''}><td>{lab}</td><td>{t(su.sources[i])}</td><td>{t(su.sourcesPct[i], 'pct')}</td><td>{t(su.sourcesX[i], 'x')}</td></tr>)}
                  <tr className="tp-sub"><td>Total sources</td><td>{t(su.totalSources)}</td><td>{t(su.sourcesPct[5], 'pct')}</td><td>{t(su.sourcesX[5], 'x')}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="tablewrap" style={{ maxWidth: 560, marginTop: 12 }}>
            <table className="fin compact">
              <thead><tr><th>Entry</th><th /></tr></thead>
              <tbody>
                <tr><td>Entry EBITDA ({r.labels.hist[n - 1]})</td><td>{t(r.entry.ebitda)}</td></tr>
                <tr><td>Entry EV / EBITDA</td><td>{t(su.stats.entryMultiple, 'x')}</td></tr>
                <tr><td>Entry Enterprise Value</td><td>{t(r.entry.ev)}</td></tr>
                <tr><td>(−) Existing borrowings (refinanced)</td><td>{t(r.entry.borrowings)}</td></tr>
                <tr><td>(−) Lease liabilities (per toggle)</td><td>{t(r.entry.leases)}</td></tr>
                <tr><td>(+) Existing cash, bank balances & current investments</td><td>{t(r.entry.cash)}</td></tr>
                <tr><td>(−) Non-controlling interest</td><td>{t(r.entry.nci)}</td></tr>
                <tr className="tp-sub"><td>Equity purchase price</td><td>{t(r.entry.equityPrice)}</td></tr>
                <tr><td>Total debt / EBITDA · senior debt / EBITDA</td><td>{t(su.stats.debtEbitda, 'x')} · {t(su.stats.seniorEbitda, 'x')}</td></tr>
                <tr><td>Debt / (debt + sponsor equity)</td><td>{t(su.stats.debtPct, 'pct')}</td></tr>
                <tr><td>Check: sources − uses (must be 0) · sponsor equity</td><td>{t(su.check)} · {su.equityFlag}</td></tr>
              </tbody>
            </table>
          </div>
        </Collapsible>

        <Collapsible title="Exit, sponsor returns & value creation" tag="RETURNS" defaultOpen>
          <div className="grid2">
            <div className="tablewrap">
              <table className="fin compact">
                <thead><tr><th>Exit waterfall</th><th>{f.unitLabel}</th></tr></thead>
                <tbody>
                  <tr><td>Exit-year EBITDA</td><td>{t(w.ebitda)}</td></tr>
                  <tr><td>Exit EV / EBITDA multiple</td><td>{t(w.multiple, 'x')}</td></tr>
                  <tr className="tp-sub"><td>Exit Enterprise Value</td><td>{t(w.ev)}</td></tr>
                  <tr><td>(−) Senior A outstanding</td><td>{t(w.senA)}</td></tr>
                  <tr><td>(−) Senior B outstanding</td><td>{t(w.senB)}</td></tr>
                  <tr><td>(−) Mezzanine outstanding (incl. PIK)</td><td>{t(w.mezz)}</td></tr>
                  <tr><td>(−) Revolver outstanding</td><td>{t(w.rcf)}</td></tr>
                  <tr><td>(−) Lease liabilities</td><td>{t(w.leases)}</td></tr>
                  <tr><td>(−) Non-controlling interest</td><td>{t(w.nci)}</td></tr>
                  <tr><td>(+) Cash on balance sheet</td><td>{t(w.cash)}</td></tr>
                  <tr className="tp-sub"><td>Exit Equity Value (to sponsor)</td><td>{t(w.equity)}</td></tr>
                  <tr><td>Sponsor equity invested</td><td>{t(su.sponsor)}</td></tr>
                  <tr className="bold"><td>MOIC · IRR</td><td>{x2(r.moic)} · {fin(r.irr) ? t(r.irr, 'pct') : 'NM'}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="tablewrap">
              <table className="fin compact">
                <thead><tr><th>Value creation bridge</th><th>{f.unitLabel}</th><th>% of value created</th></tr></thead>
                <tbody>
                  <tr><td>Sponsor equity at entry</td><td>{t(b.entry)}</td><td /></tr>
                  {['(+) EBITDA growth', '(+) Multiple expansion / (contraction)', '(+) Net debt reduction', '(−) Transaction & financing fees'].map((lab, i) => (
                    <tr key={lab}><td>{lab}</td><td>{t(b.parts[i])}</td><td>{t(b.pct[i], 'pct')}</td></tr>
                  ))}
                  <tr className="tp-sub"><td>Sponsor equity at exit</td><td>{t(b.exit)}</td><td /></tr>
                  <tr><td>Check: bridge vs exit waterfall (must be 0)</td><td>{t(b.check)}</td><td /></tr>
                  <tr><td>Entry → exit EBITDA CAGR</td><td>{t(r.summary.ebitdaCagr, 'pct')}</td><td /></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="qo-note">EBITDA growth uses the exit multiple; multiple expansion uses entry EBITDA — this pairing adds up exactly. Sponsor cash flows: {r.flows.map((v) => t(v)).join(' · ')} (years 0 to {m}; no interim dividends).</div>
        </Collapsible>

        <Collapsible title="Returns sensitivity" tag="SENS" defaultOpen>
          <div className="grid2">
            {[['IRR – exit multiple vs revenue growth', ss.growthIrr, 'pct'], ['MOIC – exit multiple vs revenue growth', ss.growthMoic, 'x']].map(([title, grid, fmt]) => (
              <div key={title} style={{ minWidth: 0 }}>
                <div className="ct" style={{ marginBottom: 6 }}>{title}</div>
                <Heatmap corner="Exit ↓ / growth shift →" rowLabels={ss.exitRows} colLabels={ss.cases.map((c) => c.shift)} grid={heat(grid)}
                  fmt={(v) => (fmt === 'pct' ? t(v, 'pct') : x2(v))} fmtRow={(v) => t(v, 'x')} fmtCol={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`} />
              </div>
            ))}
            {[['IRR – entry multiple vs exit multiple (base-case operations)', ss.multIrr, 'pct'], ['MOIC – entry multiple vs exit multiple (base-case operations)', ss.multMoic, 'x']].map(([title, grid, fmt]) => (
              <div key={title} style={{ minWidth: 0 }}>
                <div className="ct" style={{ marginBottom: 6 }}>{title}</div>
                <Heatmap corner="Entry ↓ / exit →" rowLabels={ss.entryRows} colLabels={ss.exitRows} grid={heat(grid)}
                  fmt={(v) => (fmt === 'pct' ? t(v, 'pct') : x2(v))} fmtRow={(v) => t(v, 'x')} fmtCol={(v) => t(v, 'x')} />
              </div>
            ))}
          </div>
          <div className="qo-note">
            EBITDA CAGR by growth case: {ss.cases.map((c) => `${c.shift >= 0 ? '+' : ''}${(c.shift * 100).toFixed(1)}% → ${t(c.ebitdaCagr, 'pct')}`).join(' · ')}.
            The growth tables re-run the full model (debt paydown, interest, tax) for each case. n/m = NM. Steps are set on the Exit & sensitivity step.
          </div>
        </Collapsible>

        <Collapsible title="LBO model" tag="MODEL">
          <div className="tablewrap tp-grid">
            <table className="fin compact">
              <thead>
                <tr><th>{f.unitLabel}</th>{cols.map((l, i) => <th key={i} className={i < n - 1 ? 'dg-hist' : ''}>{l}</th>)}</tr>
                <tr className="dg-band"><th>Year</th>{cols.map((_, i) => <th key={i}>{yr(i)}</th>)}</tr>
              </thead>
              <tbody>
                {FROWS.map(([lab, vals, fmt = 'n1', bold, part]) => (vals
                  ? (
                    <tr key={lab} className={bold ? 'tp-sub' : ''}>
                      <td>{lab}</td>
                      {spread(vals, part).map((v, i) => <td key={i} className={`${i < n - 1 ? 'dg-hist' : ''}${v === 'n.a.' ? ' tp-mute' : ''}${v === 'SHORTFALL' ? ' neg' : ''}`}>{fmt === 'txt' ? (v || '') : t(v, fmt)}</td>)}
                    </tr>
                  )
                  : <tr key={lab} className="tp-sec dg-sec"><td colSpan={cols.length + 1}>{lab}</td></tr>))}
              </tbody>
            </table>
          </div>
          <div className="qo-note">Interest on each tranche’s opening balance (no circularity). Other income is not forecast. Leases and NCI are held at the entry balance sheet level and deducted at entry and exit.</div>
        </Collapsible>

        <Collapsible title="Assumptions (drivers)" tag="DRIVERS">
          <div className="tablewrap tp-grid">
            <table className="fin compact">
              <thead><tr><th>Driver</th>{cols.map((l, i) => <th key={i} className={i < n ? 'dg-hist' : ''}>{l}</th>)}</tr></thead>
              <tbody>
                {LBO_DRIVERS.map((d) => (d.section
                  ? <tr key={d.section} className="tp-sec dg-sec"><td colSpan={cols.length + 1}>{d.section}</td></tr>
                  : (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      {r.ref[d.key].map((v, i) => <td key={`h${i}`} className={`dg-hist${v === 'n.a.' ? ' tp-mute' : ''}`}>{t(v, d.fmt === 'pct' ? 'pct' : 'n0')}</td>)}
                      {r.drivers[d.key].map((v, j) => <td key={`f${j}`}>{t(v, d.fmt === 'pct' ? 'pct' : 'n0')}</td>)}
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
        </Collapsible>
      </Sections>
    </div>
  );
}
