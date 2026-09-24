import React, { useMemo } from 'react';
import StatementTable from '../components/StatementTable.jsx';
import Hero from '../components/Hero.jsx';
import LiveChart from '../components/LiveChart.jsx';
import { themed, xCat, yVal, tipBy, vgrad, valueLabels, scenGhostSeries, COL } from '../lib/chartkit.js';
import { Anim } from '../lib/anim.jsx';
import { requestAssumption } from '../lib/assume.js';
import { applyScenario, SCENARIOS } from '../lib/engine/scenario.js';
import { projectPeriods } from '../lib/engine/periodModel.js';
import { projectOperations } from '../lib/engine/drivers.js';
import { editDriverValue } from '../lib/driverEdit.js';
import { buildHistoryStatements, hasQuarterly } from '../lib/history.js';
import { FREQS, freqWord } from '../lib/period.js';
import { fmtMoney, fmtPct, fmtNum, fmtPrice, CURRENCIES, UNITS } from '../lib/format.js';

/** One statement in its own clearly-separated block. */
function StatementBlock({ title, tag, note, children }) {
  return (
    <div className="stmt-block">
      <div className="stmt-head">
        <span className="stmt-tag">{tag}</span>
        <h3>{title}</h3>
        {note && <span className="stmt-note">{note}</span>}
      </div>
      {children}
    </div>
  );
}

export default function ThreeStatementTab({ a, set }) {
  const s = a.settings;
  const span = s.tsSpan || 'future';
  const past = span === 'past';
  const freq = past ? (s.tsFreq === 'Q' ? 'Q' : 'Y') : (s.tsFreq || 'Y');
  const locale = CURRENCIES[s.currency].locale;
  const unitLabel = `${CURRENCIES[s.currency].symbol} ${UNITS[s.unit]}`;
  const num = (v) => (v == null || !isFinite(v) ? '—' : fmtNum(v, 0, locale));
  const pct = (v) => (v == null || !isFinite(v) ? '—' : fmtPct(v, 1));
  const cellFmt = { num, pct, ps: (v) => (v == null || !isFinite(v) ? '—' : fmtPrice(v, s)), sh: (v) => (v == null || !isFinite(v) ? '—' : fmtNum(v, 2, locale)) };

  /* ---------- FUTURE: the linked projection at the chosen frequency ---------- */
  const am = useMemo(() => applyScenario(a), [a]);
  const pm = useMemo(() => projectPeriods(am, freq === 'Q' && past ? 'Y' : freq), [am, freq, past]);
  const baseOps = useMemo(() => projectOperations(a), [a]);
  const canEdit = !past && freq === 'Y' && (s.scenario || 'base') === 'base';
  const ed = (line, mode, raw, abs = false) =>
    canEdit
      ? { values: raw, onChange: (i, v) => set('drivers.perYear', editDriverValue(a, line, mode, i, abs ? Math.abs(v) : v)) }
      : undefined;

  const N = pm.N;
  const lastIx = N - 1;
  const maxCheck = Math.max(...pm.check.map(Math.abs));
  const growth = pm.rev.map((r, i) => (i === 0 ? (a.drivers.revenue0 > 0 && pm.m === 1 ? (r / a.drivers.revenue0 - 1) * 100 : null) : (pm.rev[i - 1] ? (r / pm.rev[i - 1] - 1) * 100 : null)));
  const effTax = pm.tax.map((t, i) => (pm.ebt[i] > 0 ? (t / pm.ebt[i]) * 100 : null));
  const eps = pm.ni.map((v) => (a.company.sharesOut > 0 ? v / a.company.sharesOut : null));

  // dashed Bear/Bull ghosts of net income
  const scenOn = s.scenOverlay ?? true;
  const scenario = s.scenario || 'base';
  const scenTs = useMemo(
    () => (scenOn && !past
      ? Object.keys(SCENARIOS).filter((k) => k !== scenario)
          .map((k) => [k, projectPeriods(applyScenario({ ...a, settings: { ...a.settings, scenario: k } }), freq)])
      : []),
    [a, scenOn, scenario, freq, past],
  );

  const futOpt = useMemo(() => themed({
    tooltip: tipBy({}, (v) => fmtNum(v, 0, locale)),
    xAxis: xCat(pm.labels),
    yAxis: yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmtNum(v, 0, locale) } }),
    series: [
      { name: 'Revenue', type: 'bar', barMaxWidth: 28, itemStyle: { color: vgrad(COL.tealDeep), borderRadius: [3, 3, 0, 0] }, data: pm.rev.map(Math.round) },
      { name: 'Net income', type: 'line', smooth: true, showSymbol: true, symbolSize: 6, lineStyle: { width: 2.6, color: COL.green }, itemStyle: { color: COL.green }, label: valueLabels((v) => fmtNum(v, 0, locale), N), data: pm.ni.map(Math.round) },
      { name: 'Closing cash', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: COL.gold, type: 'dashed' }, itemStyle: { color: COL.gold }, data: pm.closeCash.map(Math.round) },
      { name: 'Closing debt', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 1.6, color: COL.red, opacity: 0.85 }, itemStyle: { color: COL.red }, data: pm.closeDebt.map(Math.round) },
      ...scenTs.map(([k, t]) => scenGhostSeries(k, SCENARIOS[k].label, t.ni.map(Math.round))),
    ],
  }, { zoom: N > 9 }), [pm, locale, N, scenTs]);

  /* ---------- PAST: reported statements from Fetch Live ---------- */
  const hist = a.history;
  const H = useMemo(() => (past ? buildHistoryStatements(hist, s, freq) : null), [past, hist, s, freq]);
  const hQ = hasQuarterly(hist);
  const hRow = (sec, label) => H?.sections.find((x) => x.title === sec)?.rows.find((r) => r.label === label)?.vals || [];
  const lastOf = (vals) => [...vals].reverse().find((v) => v != null && isFinite(v));

  const pastOpt = useMemo(() => {
    if (!H) return null;
    const rev = hRow('Income Statement', 'Revenue');
    const ni = hRow('Income Statement', 'Net income');
    const cfo = hRow('Cash Flow Statement', 'CASH FROM OPERATIONS');
    return themed({
      tooltip: tipBy({}, (v) => fmtNum(v, 0, locale)),
      xAxis: xCat(H.labels),
      yAxis: yVal({ axisLabel: { color: COL.axis, formatter: (v) => fmtNum(v, 0, locale) } }),
      series: [
        { name: 'Revenue', type: 'bar', barMaxWidth: 30, itemStyle: { color: vgrad(COL.tealDeep), borderRadius: [3, 3, 0, 0] }, data: rev.map((v) => (v == null ? null : Math.round(v))) },
        { name: 'Net income', type: 'line', smooth: true, showSymbol: true, symbolSize: 6, lineStyle: { width: 2.6, color: COL.green }, itemStyle: { color: COL.green }, data: ni.map((v) => (v == null ? null : Math.round(v))) },
        { name: 'Cash from operations', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: COL.gold, type: 'dashed' }, itemStyle: { color: COL.gold }, data: cfo.map((v) => (v == null ? null : Math.round(v))) },
      ],
    });
  }, [H, locale]);

  /* ---------- shared control bar ---------- */
  const bar = (
    <div className="ratio-bar">
      <div className="seg" style={{ margin: 0 }}>
        <button className={past ? 'on' : ''} onClick={() => set('settings.tsSpan', 'past')} title="Reported statements — actuals fetched from Yahoo Finance">Past</button>
        <button className={!past ? 'on' : ''} onClick={() => set('settings.tsSpan', 'future')} title="The linked projection">Future</button>
      </div>
      <div className="seg" style={{ margin: 0 }}>
        {(past ? ['Y', 'Q'] : ['Y', 'H', 'Q']).map((k) => (
          <button
            key={k}
            className={freq === k ? 'on' : ''}
            disabled={past && k === 'Q' && !hQ}
            title={past && k === 'Q' && !hQ ? 'No quarterly statements reported for this company' : undefined}
            onClick={() => set('settings.tsFreq', k)}
          >{FREQS[k].label}</button>
        ))}
      </div>
      {past
        ? <span className="ratio-hint">{hist ? `${hist.name || hist.symbol} · reported ${H?.note || 'as fetched'} · fetched ${hist.fetchedAt}` : 'Reported actuals need a company pulled from the top-bar search'}</span>
        : <span className="ratio-hint">horizon = Projection years ({pm.ny}y, set in the dock)</span>}
    </div>
  );

  /* ================= PAST VIEW ================= */
  if (past) {
    if (!H) {
      return (
        <div className="view">
          <Hero
            eyebrow="Three-statement model — reported history"
            value={0}
            fmt={() => 'No actuals yet'}
            sub="The Past view shows the company's real reported income statement, balance sheet and cash flow, exactly as filed. Fetch a listed company to load them."
            chips={[{ label: 'source', text: 'Yahoo Finance' }]}
          />
          {bar}
          <div className="card" style={{ maxWidth: 620 }}>
            <div className="k">How to load reported statements</div>
            <div className="s" style={{ fontSize: 13, marginTop: 8 }}>
              Type the company's name in the top-bar search (e.g. RELIANCE.NS, AAPL, TCS.BO), pick the listing
              and Apply. The full reported IS / BS / CF history rides along and appears here — annual, plus
              quarterly where the company reports it. Private and hand-entered companies have no reported history.
            </div>
          </div>
        </div>
      );
    }
    const rev = hRow('Income Statement', 'Revenue');
    const ni = hRow('Income Statement', 'Net income');
    const gr = hRow('Income Statement', 'Revenue growth (y/y)');
    const TAGS = { 'Income Statement': 'IS', 'Balance Sheet': 'BS', 'Cash Flow Statement': 'CF' };
    return (
      <div className="view">
        <Hero
          eyebrow={`${hist.name || hist.symbol} — reported statements · ${freqWord(freq).toLowerCase()} · ${H.labels[0]}–${H.labels[H.labels.length - 1]}`}
          value={lastOf(rev) ?? 0}
          fmt={(v) => fmtMoney(v, s)}
          sub={`Actuals as filed (source: Yahoo Finance). Latest revenue ${fmtMoney(lastOf(rev) ?? NaN, s)}, net income ${fmtMoney(lastOf(ni) ?? NaN, s)}. ${H.note ? H.note + '.' : ''} Switch to Future for the linked projection.`}
          chips={[
            { label: 'periods', text: `${H.labels.length}` },
            { label: 'latest growth y/y', value: lastOf(gr), fmt: (v) => fmtPct(v, 1) },
            { label: 'net margin', value: lastOf(ni) != null && lastOf(rev) ? (lastOf(ni) / lastOf(rev)) * 100 : null, fmt: (v) => fmtPct(v, 1) },
          ]}
        />
        {bar}
        {pastOpt && (
          <div className="chartbox">
            <div className="ct">Reported revenue, net income & operating cash flow ({unitLabel})</div>
            <LiveChart option={pastOpt} height={250} />
          </div>
        )}
        {H.sections.map((sec) => (
          <StatementBlock
            key={sec.title}
            tag={TAGS[sec.title]}
            title={sec.title}
            note={`${unitLabel} · as reported`}
          >
            <StatementTable
              labels={H.labels}
              years={H.labels.map((_, i) => i + 1)}
              rows={sec.rows.map((r) => ({ label: r.label, values: r.vals, fmt: cellFmt[r.fmt] || num, bold: r.bold, sub: r.sub }))}
            />
          </StatementBlock>
        ))}
        <div className="footer-note">
          Reported figures come straight from the company's filings via Yahoo Finance and are shown in {unitLabel}
          {H.note ? ` (${H.note})` : ''}. Line items a company doesn't report are hidden. Derived rows (margins,
          growth, effective tax, the balance check) are computed from the reported figures.
        </div>
      </div>
    );
  }

  /* ================= FUTURE VIEW ================= */
  return (
    <div className="view">
        <Hero
          eyebrow={`Three-statement model — final-${freq === 'Y' ? 'year' : 'period'} net income · ${freqWord(freq).toLowerCase()}`}
          value={pm.ni[lastIx]}
          fmt={(v) => fmtMoney(v, s)}
          sub={`Fully linked income statement, cash flow and balance sheet over the ${pm.ny}-year projection. Cash is the balancing item — the check row stays at zero in every period, every scenario.`}
          chips={[
            { label: 'net margin', value: (pm.ni[lastIx] / pm.rev[lastIx]) * 100, fmt: (v) => fmtPct(v, 1) },
            { label: `cash ${pm.labels[lastIx]}`, value: pm.closeCash[lastIx], fmt: (v) => fmtMoney(v, s) },
            { label: 'balance', text: maxCheck < 0.01 ? '✓ ties' : '✗ off', tone: maxCheck < 0.01 ? 'pos' : 'neg' },
          ]}
        />
        {bar}
        <div className="cards">
          <div className="card hero">
            <div className="k">Net income — {pm.labels[lastIx]}</div>
            <div className="v"><Anim value={pm.ni[lastIx]} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">Net margin {fmtPct((pm.ni[lastIx] / pm.rev[lastIx]) * 100)}</div>
          </div>
          <div className="card">
            <div className="k">Closing cash (final period)</div>
            <div className="v"><Anim value={pm.closeCash[lastIx]} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">From {fmtMoney(pm.cash0, s)} opening</div>
          </div>
          <div className="card">
            <div className="k">Closing debt (final period)</div>
            <div className="v"><Anim value={pm.closeDebt[lastIx]} fmt={(v) => fmtMoney(v, s)} /></div>
            <div className="s">From {fmtMoney(pm.debt0, s)} opening</div>
          </div>
          <div className="card">
            <div className="k">Balance check</div>
            <div className={`v ${maxCheck < 0.01 ? 'pos' : 'neg'}`}>{maxCheck < 0.01 ? '✓ Ties' : '✗ Off'}</div>
            <div className="s">Max |A − (D+E)| = {fmtNum(maxCheck, 4, 'en-US')}</div>
          </div>
        </div>

        <div className="chartbox">
          <div className="ct">Revenue, net income, cash & debt ({unitLabel})</div>
          <LiveChart
            option={futOpt} height={250}
            onEvents={{ click: (p) => requestAssumption({
              Revenue: { labels: ['Revenue growth — Year 1'], section: 'Operating Drivers' },
              'Net income': { labels: ['EBITDA margin — Year 1'], section: 'Operating Drivers' },
              'Closing cash': { labels: ['Dividend payout'], section: 'Financing & Policy' },
              'Closing debt': { labels: ['Mandatory debt repayment'], section: 'Financing & Policy' },
            }[p.seriesName] || { section: 'Operating Drivers' }) }}
          />
        </div>

        <StatementBlock tag="IS" title="Income Statement" note={`${unitLabel} · ${freqWord(freq).toLowerCase()}`}>
          <StatementTable
            labels={pm.labels}
            years={pm.labels.map((_, i) => i + 1)}
            showYear0={freq === 'Y'}
            rows={[
              { label: 'Revenue', values: pm.rev, year0: a.drivers.revenue0, fmt: num, bold: true, edit: ed('revenue', 'abs', baseOps.revenue, true) },
              { label: `Revenue growth (${freq === 'Y' ? 'y/y' : 'p/p'})`, values: growth, fmt: pct, sub: true },
              { label: 'EBITDA', values: pm.ebitda, fmt: num, edit: ed('ebitda', 'abs', baseOps.ebitda, true) },
              { label: 'EBITDA margin', values: pm.ebitda.map((e, i) => (pm.rev[i] ? (e / pm.rev[i]) * 100 : null)), fmt: pct, sub: true },
              { label: 'Less: D&A', values: pm.da.map((v) => -v), fmt: num, sub: true, edit: ed('da', 'abs', baseOps.da, true) },
              { label: 'EBIT', values: pm.ebit, fmt: num, bold: true },
              { label: 'Less: Interest expense', values: pm.interestExp.map((v) => -v), fmt: num, sub: true },
              { label: 'Add: Interest income', values: pm.interestInc, fmt: num, sub: true },
              { label: 'Pre-tax income', values: pm.ebt, fmt: num },
              { label: 'Less: Tax', values: pm.tax.map((v) => -v), fmt: num, sub: true },
              { label: 'Effective tax rate', values: effTax, fmt: pct, sub: true },
              { label: 'Net income', values: pm.ni, fmt: num, bold: true },
              { label: 'Net margin', values: pm.ni.map((v, i) => (pm.rev[i] ? (v / pm.rev[i]) * 100 : null)), fmt: pct, sub: true },
              { label: 'EPS', values: eps, fmt: cellFmt.ps, sub: true },
            ]}
          />
        </StatementBlock>

        <StatementBlock tag="CF" title="Cash Flow Statement" note={`${unitLabel} · ${freqWord(freq).toLowerCase()}`}>
          <StatementTable
            labels={pm.labels}
            years={pm.labels.map((_, i) => i + 1)}
            rows={[
              { label: 'Net income', values: pm.ni, fmt: num },
              { label: 'Add: D&A', values: pm.da, fmt: num, sub: true },
              { label: 'Less: Increase in NWC', values: pm.dNWC.map((v) => -v), fmt: num, sub: true },
              { label: 'Cash from operations', values: pm.cfo, fmt: num, bold: true },
              { label: 'Capex', values: pm.cfi, fmt: num, edit: ed('capex', 'abs', baseOps.capex, true) },
              { label: 'Cash from investing', values: pm.cfi, fmt: num, bold: true },
              { label: 'Debt repaid', values: pm.repay.map((v) => -v), fmt: num, sub: true },
              { label: 'Dividends paid', values: pm.div.map((v) => -v), fmt: num, sub: true },
              { label: 'Cash from financing', values: pm.cff, fmt: num, bold: true },
              { label: 'Net change in cash', values: pm.closeCash.map((c, i) => c - pm.openCash[i]), fmt: num, bold: true },
              { label: 'Opening cash', values: pm.openCash, fmt: num, sub: true },
              { label: 'Closing cash', values: pm.closeCash, fmt: num, bold: true },
              { label: 'FCFF (memo)', values: pm.fcff, fmt: num, sub: true },
              { label: 'FCFE (memo)', values: pm.fcfe, fmt: num, sub: true },
            ]}
          />
        </StatementBlock>

        <StatementBlock tag="BS" title="Balance Sheet" note={`${unitLabel} · ${freqWord(freq).toLowerCase()} · closing balances`}>
          <StatementTable
            labels={pm.labels}
            years={pm.labels.map((_, i) => i + 1)}
            showYear0={freq === 'Y'}
            rows={[
              { label: 'Cash & equivalents', values: pm.closeCash, year0: pm.cash0, fmt: num },
              { label: 'Net working capital', values: pm.nwcClose, year0: pm.nwc0, fmt: num, edit: ed('nwc', 'abs', baseOps.nwcBalance, true) },
              { label: 'Net PP&E', values: pm.closePpe, year0: pm.ppe0, fmt: num },
              { label: 'Total assets', values: pm.closeAssets, year0: pm.cash0 + pm.nwc0 + pm.ppe0, fmt: num, bold: true },
              { label: 'Total debt', values: pm.closeDebt, year0: pm.debt0, fmt: num },
              { label: "Shareholders' equity", values: pm.closeEquity, year0: pm.equity0, fmt: num },
              { label: 'Debt + equity', values: pm.closeDebt.map((d, i) => d + pm.closeEquity[i]), year0: pm.debt0 + pm.equity0, fmt: num, bold: true },
              { label: 'Net debt (memo)', values: pm.netDebtClose, year0: pm.debt0 - pm.cash0, fmt: num, sub: true },
              { label: 'Check (A − D − E)', values: pm.check, year0: 0, fmt: (v) => fmtNum(v, 2, 'en-US'), sub: true },
            ]}
          />
        </StatementBlock>

        <div className="edit-note">
          {canEdit
            ? '✎ Revenue, EBITDA, D&A, capex and NWC are direct inputs — click a cell and type (or hover to magnify); the statements, cash and balance sheet re-link instantly. Use Enter Data in the header to fill the whole model at once.'
            : past ? '' : freq !== 'Y'
              ? 'Sub-annual periods are derived from the annual model — switch to Yearly to type into the cells.'
              : 'Switch the scenario to Base to type into the cells.'}
        </div>
        <div className="footer-note">
          The three statements share the operating drivers with the DCF. Cash is the balancing item: every period the
          balance-sheet check row must be zero. Opening equity is derived so the opening balance sheet ties
          ({fmtMoney(pm.equity0, s)}). Half-yearly and quarterly periods subdivide the annual model — flows sum
          exactly back to the annual totals. Switch to Past for the company's reported statements.
        </div>
    </div>
  );
}
