import React, { useMemo, useState } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import { computeThreeStatement } from '../lib/engine/threeStatement.js';
import { periodLabels } from '../lib/period.js';
import { buildHistoryStatements, hasQuarterly, hasStatements } from '../lib/history.js';
import { hasHistory, HISTORY_LINES, HISTORY_GROUPS, fyLabel } from '../lib/historyModel.js';
import Headline from './parts/Headline.jsx';
import LabelBars from '../components/LabelBars.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { useThemeMode } from '../lib/theme.js';

import { makeFmt, fin, rnd, attempt, tone } from './parts/format.js';
import { themed, xCat, tipBy, COL, barSeries, lineSeries, moneyAxis, stackedOption } from './parts/charts.js';

/**
 * 3-Statement Analysis output.
 * Props: { a, set, company, skipped } — nothing here edits an input.
 * Headline: final-year net income and whether the balance sheet ties; key
 * charts: revenue / net income / cash / debt and the balance-sheet mix.
 * Detail: income statement, cash flow, balance sheet (with the "other net
 * assets / (liabilities)" line that ties it to reported opening equity), the
 * debt and tax-loss schedules, and the reported history when one was entered.
 */
export default function ThreeStatementOutput({ a, skipped = {} }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => computeThreeStatement(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The three-statement model" error={model.error} /></div>;
  return <TsPage a={a} f={f} ts={model.value} showHistory={!skipped.history} />;
}

function TsPage({ a, f, ts, showHistory }) {
  const ops = ts.ops;
  const n = ops.n;
  const last = n - 1;
  const labels = useMemo(() => periodLabels(a.settings, 'Y', n), [a.settings, n]);
  // the workbook's cash check: closing cash must stay at or above 0
  const negCash = labels.filter((_, i) => fin(ts.closeCash[i]) && ts.closeCash[i] < -0.001);
  const maxCheck = Math.max(...ts.check.map((c) => (fin(c) ? Math.abs(c) : Infinity)));
  const ties = ts.balanceOk;
  const shares = a.company.sharesOut;
  const growth = ops.growth;
  const effTax = ts.taxAmt.map((t, i) => (ts.ebt[i] > 0 ? (t / ts.ebt[i]) * 100 : NaN));
  const hasOther = fin(ts.otherNetAssets) && Math.abs(ts.otherNetAssets) > 1e-9;
  const nolAdded = ts.nolClose.map((c, i) => c - ts.nolOpen[i] + ts.nolUsed[i]);

  const theme = useThemeMode();
  const mainOpt = useMemo(() => themed({
    tooltip: tipBy({}, f.num),
    xAxis: xCat(labels), yAxis: moneyAxis(f),
    series: [
      barSeries('Revenue', COL.tealDeep, ops.revenue.map((v) => rnd(v))),
      lineSeries('Net income', COL.green, ts.netIncome.map((v) => rnd(v))),
      lineSeries('Closing cash', COL.gold, ts.closeCash.map((v) => rnd(v)), { dashed: true, symbol: false }),
      lineSeries('Closing debt', COL.red, ts.closeDebt.map((v) => rnd(v)), { symbol: false, width: 1.8 }),
    ],
  }, { zoom: n > 9 }), [ts, labels, f, n, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const bsOpt = useMemo(() => stackedOption(f, labels, [
    { name: 'Cash', color: COL.gold, data: ts.closeCash },
    { name: 'Net working capital', color: COL.cyan, data: ops.nwcBalance },
    { name: 'Net PP&E', color: COL.teal, data: ts.ppe },
    ...(hasOther ? [{ name: 'Other net assets', color: COL.violet, data: ops.nwcBalance.map(() => ts.otherNetAssets) }] : []),
  ], { line: { name: "Shareholders' equity", color: COL.green, data: ts.equity } }), [ts, labels, f, hasOther, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qo">
      {[!ties && 'The balance sheet does not tie — an input is NA. Use the steps above to complete it.',
        negCash.length > 0 && `Closing cash goes negative in ${negCash.join(', ')} — the plan needs funding (a revolver or new debt), or lower payouts.`].filter(Boolean).map((x) => <div key={x} className="warn2" style={{ marginBottom: 10 }}>{x}</div>)}
      <div className="mp-ok">{ties ? <span className="up">✓ The balance sheet ties every year</span> : <span className="dn">✕ The balance sheet does not tie</span>}</div>
      <TsBlock title="Income statement" f={f} labels={labels}
        chart={<LabelBars labels={labels} fmt={f.num} series={[{ name: 'Revenue', data: ops.revenue, color: 'var(--accent)' }, { name: 'EBITDA', data: ops.ebitda, color: '#9CCBCF' }, { name: 'Net income', data: ts.netIncome, color: 'var(--green)' }]}
          lines={[{ name: 'Net margin', data: ts.netIncome.map((v, i) => (ops.revenue[i] ? (v / ops.revenue[i]) * 100 : NaN)), color: '#E0A33A' }]} />}
        notes={tsNotes('is', { ops, ts, labels, f, last })}
        rows={[['Revenue', ops.revenue, 1, 1], ['EBITDA', ops.ebitda, 1, 1], ['Depreciation', ops.da.map((x) => -x)], ['Interest (net)', ts.interestExp.map((x, i) => -(x - ts.interestInc[i]))], ['Tax', ts.taxAmt.map((x) => -x)], ['Net income', ts.netIncome, 1, 1]]} />
      <TsBlock title="Cash flow" f={f} labels={labels}
        chart={<LabelBars labels={labels} fmt={f.num} series={[{ name: 'From operations', data: ts.cfo, color: 'var(--green)' }, { name: 'Investing', data: ts.cfi, color: 'var(--red)' }, { name: 'Financing', data: ts.cff, color: '#F5B4B6' }, { name: 'Change in cash', data: ts.deltaCash, color: 'var(--accent)' }]} />}
        notes={tsNotes('cf', { ops, ts, labels, f, last })}
        rows={[['Cash from operations', ts.cfo, 1], ['Investing', ts.cfi], ['Financing', ts.cff], ['Change in cash', ts.deltaCash, 1], ['Closing cash', ts.closeCash, 1]]} />
      <TsBlock title="Balance sheet" f={f} labels={labels}
        chart={<LabelBars labels={labels} fmt={f.num} series={[{ name: 'Cash', data: ts.closeCash, color: 'var(--green)' }, { name: 'Net PP&E', data: ts.ppe, color: 'var(--accent)' }, { name: 'Working capital', data: ops.nwcBalance, color: '#9CCBCF' }, { name: 'Debt', data: ts.closeDebt, color: 'var(--red)' }]} />}
        notes={tsNotes('bs', { ops, ts, labels, f, last })}
        rows={[['Cash', ts.closeCash], ['Net PP&E', ts.ppe], ['Net working capital', ops.nwcBalance], ['Total assets', ts.assets, 1, 1], ['Debt', ts.closeDebt], ["Shareholders' equity", ts.equity, 1, 1]]} />

      <Sections>
        <Collapsible title={`Income statement (${f.unitLabel})`} tag="IS">
          <StatementTable labels={labels} years={ops.years} showYear0 rows={[
            { label: 'Revenue', values: ops.revenue, year0: ops.revenue0, fmt: f.num, bold: true },
            { label: 'Revenue growth', values: growth, fmt: f.pct, sub: true },
            { label: 'EBITDA', values: ops.ebitda, year0: ops.ebitda0, fmt: f.num },
            { label: 'EBITDA margin', values: ops.margin, fmt: f.pct, sub: true },
            { label: 'Less: D&A', values: ops.da.map((v) => -v), fmt: f.num, sub: true },
            { label: 'EBIT', values: ops.ebit, fmt: f.num, bold: true },
            { label: 'Less: interest expense', values: ts.interestExp.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Add: interest income', values: ts.interestInc, fmt: f.num, sub: true },
            { label: 'Pre-tax income', values: ts.ebt, fmt: f.num },
            { label: 'Less: tax (after tax losses)', values: ts.taxAmt.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Effective tax rate', values: effTax, fmt: f.pct, sub: true },
            { label: 'Net income', values: ts.netIncome, fmt: f.num, bold: true },
            { label: 'Net margin', values: ts.netIncome.map((v, i) => (ops.revenue[i] ? (v / ops.revenue[i]) * 100 : NaN)), fmt: f.pct, sub: true },
            { label: 'EPS (today’s share count)', values: ts.netIncome.map((v) => (shares > 0 ? v / shares : NaN)), fmt: (v) => f.price(v), sub: true },
          ]} />
        </Collapsible>

        <Collapsible title={`Cash flow statement (${f.unitLabel})`} tag="CF">
          <StatementTable labels={labels} years={ops.years} rows={[
            { label: 'Net income', values: ts.netIncome, fmt: f.num },
            { label: 'Add: D&A', values: ops.da, fmt: f.num, sub: true },
            { label: 'Less: increase in NWC', values: ops.deltaNwc.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Cash from operations', values: ts.cfo, fmt: f.num, bold: true },
            { label: 'Capex', values: ts.cfi, fmt: f.num },
            { label: 'Cash from investing', values: ts.cfi, fmt: f.num, bold: true },
            { label: 'Debt repaid', values: ts.repay.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Dividends paid', values: ts.dividends.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Cash from financing', values: ts.cff, fmt: f.num, bold: true },
            { label: 'Net change in cash', values: ts.deltaCash, fmt: f.num, bold: true },
            { label: 'Opening cash', values: ts.openCash, fmt: f.num, sub: true },
            { label: 'Closing cash', values: ts.closeCash, fmt: f.num, bold: true },
            { label: 'Cash check (closing cash ≥ 0)', values: ts.closeCash.map((v) => (fin(v) ? (v < -0.001 ? 'NEGATIVE – add funding' : 'OK') : 'NA')), fmt: (v) => v, sub: true },
          ]} />
        </Collapsible>

        <Collapsible title={`Balance sheet — closing balances (${f.unitLabel})`} tag="BS" note={ties ? 'ties every year' : 'does not tie'}>
          <StatementTable labels={labels} years={ops.years} showYear0 rows={[
            { label: 'Cash & equivalents', values: ts.closeCash, year0: ts.cash0, fmt: f.num },
            { label: 'Net working capital', values: ops.nwcBalance, year0: ops.nwc0, fmt: f.num },
            { label: 'Net PP&E', values: ts.ppe, year0: ts.ppe0, fmt: f.num },
            { label: 'Other net assets / (liabilities)', values: ops.nwcBalance.map(() => ts.otherNetAssets), year0: ts.otherNetAssets, fmt: f.num },
            { label: 'Total net assets', values: ts.assets, year0: ts.assets0, fmt: f.num, bold: true },
            { label: 'Total debt', values: ts.closeDebt, year0: ts.debt0, fmt: f.num },
            { label: "Shareholders' equity", values: ts.equity, year0: ts.equity0, fmt: f.num },
            { label: 'Debt + equity', values: ts.liabEq, year0: ts.debt0 + ts.equity0, fmt: f.num, bold: true },
            { label: 'Net debt (memo)', values: ts.closeDebt.map((d, i) => d - ts.closeCash[i]), year0: ts.debt0 - ts.cash0, fmt: f.num, sub: true },
            { label: 'Check (assets − debt − equity)', values: ts.check, year0: 0, fmt: (v) => f.dec(v, 2), sub: true },
          ]} />
          <div className="qo-note">
            Other net assets / (liabilities) = reported opening equity − (cash + NWC + PP&amp;E − debt) = {f.num(ts.otherNetAssets)}, held
            constant so the balance sheet ties to the equity you entered. Working capital is shown net (operating assets less operating liabilities).
          </div>
        </Collapsible>

        <Collapsible title={`Debt and tax-loss schedules (${f.unitLabel})`} tag="SCHED">
          <StatementTable labels={labels} years={ops.years} rows={[
            { label: 'Opening debt', values: ts.openDebt, fmt: f.num },
            { label: `Mandatory repayment (${f.pct0(a.ts.debtRepayPct)} of opening)`, values: ts.repay.map((v) => -v), fmt: f.num, sub: true },
            { label: 'Closing debt', values: ts.closeDebt, fmt: f.num, bold: true },
            { label: `Interest @ ${f.pct(a.ts.interestRateDebt)} on opening debt`, values: ts.interestExp, fmt: f.num, sub: true },
            { label: `Interest @ ${f.pct(a.ts.interestRateCash)} on opening cash`, values: ts.interestInc, fmt: f.num, sub: true },
            { label: 'Tax-loss (NOL) balance — opening', values: ts.nolOpen, fmt: f.num },
            { label: 'Add: losses', values: nolAdded, fmt: f.num, sub: true },
            { label: 'Less: NOL used', values: ts.nolUsed.map((v) => -v), fmt: f.num, sub: true },
            { label: 'NOL balance — closing', values: ts.nolClose, fmt: f.num, bold: true },
            { label: `Dividends (${f.pct0(a.ts.dividendPayout)} of positive net income)`, values: ts.dividends, fmt: f.num, sub: true },
          ]} />
          <div className="qo-note">A loss year pays no tax and adds to the tax-loss balance; later profits use it up before any tax is charged.</div>
        </Collapsible>

        {showHistory && hasHistory(a.history) && <ReportedHistory a={a} f={f} />}
      </Sections>
    </div>
  );
}

/** The reported history: full Yahoo statements when present, else the typed core lines. */
export function ReportedHistory({ a, f }) {
  const h = a.history;
  const full = hasStatements(h);
  const hasQ = hasQuarterly(h);
  const [freq, setFreq] = useState('Y');
  const H = useMemo(() => (full ? buildHistoryStatements(h, freq) : null), [h, full, freq]);
  const fmtOf = { num: f.num, pct: (v) => f.pct(v), ps: (v) => f.price(v), sh: f.shares };
  const TAGS = { 'Income Statement': 'IS', 'Balance Sheet': 'BS', 'Cash Flow Statement': 'CF' };

  if (!full) {
    const heads = h.annual.dates.map(fyLabel);
    return (
      <Collapsible title={`Reported history — ${h.label} (${f.unitLabel})`} tag="PAST">
        {HISTORY_GROUPS.map((g) => (
          <div key={g.id}>
            <div className="qo-sub">{g.label}</div>
            <StatementTable labels={heads} years={heads.map((_, i) => i + 1)} rows={HISTORY_LINES.filter((l) => l.group === g.id).map((l) => ({
              label: l.label, values: h.annual.lines[l.key].map((v) => (typeof v === 'number' ? v : NaN)), fmt: f.num,
            }))} />
          </div>
        ))}
        <div className="qo-note">As entered; — = not reported. Nothing is back-cast.</div>
      </Collapsible>
    );
  }
  return (
    <Collapsible title={`Reported statements — ${h.label}`} tag="PAST" note={H ? `${H.labels[0]}–${H.labels[H.labels.length - 1]}` : ''}>
      {hasQ && (
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={freq === 'Y' ? 'on' : ''} onClick={() => setFreq('Y')}>Yearly</button>
          <button className={freq === 'Q' ? 'on' : ''} onClick={() => setFreq('Q')}>Quarterly</button>
        </div>
      )}
      {H ? H.sections.map((sec) => (
        <div key={sec.title}>
          <div className="qo-sub">{TAGS[sec.title]} · {sec.title} ({f.unitLabel})</div>
          <StatementTable
            labels={H.labels} years={H.labels.map((_, i) => i + 1)}
            rows={sec.rows.map((r) => ({ label: r.label, values: r.vals.map((v) => (v == null ? NaN : v)), fmt: fmtOf[r.fmt] || f.num, bold: r.bold, sub: r.sub }))}
          />
        </div>
      )) : <div className="sec-note">No reported statements at this frequency.</div>}
      <div className="qo-note">
        As reported (Yahoo Finance), converted into {f.unitLabel} at the rate you confirmed. Lines the company doesn’t report are hidden;
        margins, growth and the balance check are computed from the reported figures.
      </div>
    </Collapsible>
  );
}

/** One statement as the approved sample (option I): a labelled chart, the points worth knowing, every number underneath. */
function TsBlock({ title, chart, notes, rows, labels, f }) {
  const g = (v, i) => (i > 0 && fin(v[i]) && fin(v[i - 1]) && v[i - 1] !== 0 ? (v[i] / Math.abs(v[i - 1]) - 1) * 100 : null);
  return (
    <div className="box2 tsb">
      <h3>{title}</h3>
      <div className="tsb-g">
        <div>{chart}</div>
        <div className="tsb-n">{notes.map(([k, b, t]) => <div key={b} className={`ins2 ${k}`}><span className="ic2">{k === 'g' ? '▲' : k === 'r' ? '▼' : '!'}</span><div><b>{b}</b>{t}</div></div>)}</div>
      </div>
      <table className="alt">
        <thead><tr><th>{f.unitLabel}</th>{labels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>{rows.map(([l, v, sub, gr]) => (
          <tr key={l} className={sub ? 't' : ''}><td>{l}</td>{v.map((x, i) => { const gg = gr ? g(v, i) : null; return <td key={i}>{fin(x) ? (x < 0 ? `(${f.num(-x)})` : f.num(x)) : '—'}{gg !== null && <small className={gg >= 0 ? 'up' : 'dn'}>{gg >= 0 ? '+' : ''}{gg.toFixed(1)}%</small>}</td>; })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Three plain points per statement, from the figures. */
function tsNotes(kind, { ops, ts, labels, f, last }) {
  const pct = (v) => `${v.toFixed(1)}%`;
  const out = [];
  if (kind === 'is') {
    const g = ops.revenue[0] > 0 && ops.revenue[last] > 0 && last > 0 ? (Math.pow(ops.revenue[last] / ops.revenue[0], 1 / last) - 1) * 100 : NaN;
    if (fin(g)) out.push([g >= 0 ? 'g' : 'r', `Revenue ${g >= 0 ? 'grows' : 'shrinks'} ${pct(Math.abs(g))} a year`, ` ${f.money(ops.revenue[0])} in ${labels[0]} → ${f.money(ops.revenue[last])} in ${labels[last]}.`]);
    const m0 = ops.revenue[0] ? ops.ebitda[0] / ops.revenue[0] * 100 : NaN, m1 = ops.revenue[last] ? ops.ebitda[last] / ops.revenue[last] * 100 : NaN;
    if (fin(m0) && fin(m1)) out.push([m1 >= m0 ? 'g' : 'r', `EBITDA margin ${m1 >= m0 ? 'up' : 'down'} ${Math.abs(m1 - m0).toFixed(1)} pts`, ` ${pct(m0)} → ${pct(m1)}.`]);
    const n0 = ts.netIncome[0], n1 = ts.netIncome[last];
    if (fin(n0) && fin(n1)) out.push([n1 >= n0 ? 'g' : 'r', `Net income ${f.money(n1)} by ${labels[last]}`, ` from ${f.money(n0)} in ${labels[0]}.`]);
  } else if (kind === 'cf') {
    const cov = ts.cfo[0] + ts.cfi[0];
    if (fin(cov)) out.push([cov >= 0 ? 'g' : 'a', cov >= 0 ? 'Pays for its own investment' : 'Investment exceeds operating cash', ` Operations bring in ${f.money(ts.cfo[0])} in ${labels[0]}; investing uses ${f.money(-ts.cfi[0])}.`]);
    if (fin(ts.closeCash[last])) out.push([ts.closeCash[last] >= ts.cash0 ? 'g' : 'a', `Cash ${ts.closeCash[last] >= ts.cash0 ? 'builds' : 'falls'} to ${f.money(ts.closeCash[last])}`, ` from ${f.money(ts.cash0)} today.`]);
    const div = ts.dividends.reduce((a2, x) => a2 + (fin(x) ? x : 0), 0);
    out.push(['a', `${f.money(div)} paid in dividends`, ` over ${labels[0]}–${labels[last]}.`]);
  } else {
    out.push([ts.closeDebt[last] <= ts.debt0 ? 'g' : 'a', `Debt ${ts.closeDebt[last] <= ts.debt0 ? 'falls' : 'rises'} to ${f.money(ts.closeDebt[last])}`, ` from ${f.money(ts.debt0)} today.`]);
    out.push(['g', `Equity reaches ${f.money(ts.equity[last])}`, ` from the reported ${f.money(ts.equity0)}.`]);
    out.push([ts.balanceOk ? 'g' : 'r', ts.balanceOk ? 'Ties every year' : 'Does not tie', ts.balanceOk ? ' Assets = debt + equity in every forecast year.' : ' An input is NA — check the steps.']);
  }
  return out;
}
