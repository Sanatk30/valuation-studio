import React, { useMemo, useState } from 'react';
import LiveChart from '../components/LiveChart.jsx';
import { computeForecastRatios, computeHistoryRatios } from '../lib/engine/ratios.js';
import { hasHistory } from '../lib/historyModel.js';
import Headline from './parts/Headline.jsx';
import LabelBars from '../components/LabelBars.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { ReportedHistory } from './ThreeStatementOutput.jsx';
import { makeFmt, fin, rnd, attempt } from './parts/format.js';
import { themed, xCat, yVal, tipBy, COL, lineSeries } from './parts/charts.js';

const TAGS = {
  'Profitability & margins': 'MARGIN', 'Returns (annualised) & DuPont': 'RETURN', 'Returns & DuPont': 'RETURN',
  'Leverage & solvency': 'LEV', Coverage: 'COVER', 'Efficiency & liquidity': 'EFF', 'Per share': 'PS',
  'Cash flow': 'CF', 'Cash flow & payout': 'CF', Growth: 'GROWTH', 'Valuation (at current price)': 'VAL',
};

/**
 * Ratio Analysis output.
 * Props: { a, set, company, skipped }. `set` only for the display settings
 * `ratio.freq` (Yearly / Quarterly, past only) and `ratio.histYears`.
 * Past = reported history only (never back-cast); Future = the annual
 * forecast off the linked 3-statement model. The period is chosen in the
 * Ratio settings step.
 */
export default function RatioOutput({ a, set, skipped = {} }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  // a skipped history step means no history — as in the Excel file, which then has no Past Ratios sheet
  const wantPast = a.ratio?.span === 'past';
  const past = wantPast && hasHistory(a.history) && !skipped.history;
  const freq = past && a.ratio?.freq === 'Q' && a.history?.quarterly?.dates?.length ? 'Q' : 'Y';
  const periods = Number.isInteger(a.ratio?.histYears) ? a.ratio.histYears * (freq === 'Q' ? 4 : 1) : null;
  const model = useMemo(() => attempt(() => (past ? computeHistoryRatios(a, freq, periods) : computeForecastRatios(a))), [a, past, freq, periods]);
  if (model.error) return <div className="qo"><EngineError what="The ratio analysis" error={model.error} /></div>;
  if (!model.value || (wantPast && !past)) return <div className="qo"><div className="warn">No reported history to analyse — enter it in the Historical financials step, or choose Future in Ratio settings.</div></div>;
  return <RatioPage a={a} set={set} f={f} R={model.value} past={past} freq={freq} />;
}

function RatioPage({ a, set, f, R, past, freq }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const cell = (fmt, v) => {
    if (!fin(v)) return '—';
    if (fmt === 'pct') return f.pct(v);
    if (fmt === 'x') return f.x(v);
    if (fmt === 'price') return f.price(v);
    if (fmt === 'num') return f.num(v);
    return f.num2(v);
  };
  const find = (label) => {
    for (const sec of R.sections) { const r = sec.rows.find((x) => x.label === label); if (r) return r; }
    return null;
  };
  // headline period: the latest reported period, or the first forecast year
  const ref = past ? R.N - 1 : 0;
  const refLbl = R.labels[ref];
  const pick = (label) => find(label)?.vals[ref];

  const trend = (labels, rows) => themed({
    tooltip: tipBy({}, (v) => f.pct(v)),
    xAxis: xCat(labels, { boundaryGap: false }),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}%' } }),
    series: rows.filter(Boolean).map((r, i) => lineSeries(r.label, [COL.teal, COL.green, COL.gold, COL.violet][i], r.vals.map((v) => rnd(v, 2)), { area: i === 0 })),
  });
  const marginRows = ['EBITDA margin', 'Net profit margin', 'Return on equity (ROE)'].map(find).filter(Boolean);
  // the past annual table labels it without "(ann.)"; the forecast and past quarterly ones annualise
  const ndLabel = past && freq !== 'Q' ? 'Net debt / EBITDA' : 'Net debt / EBITDA (ann.)';
  const levRows = [find(ndLabel), find('Interest coverage (EBIT / int.)')].filter(Boolean);
  const levOpt = levRows.length ? themed({
    tooltip: tipBy({}, (v) => f.x(v)),
    xAxis: xCat(R.labels, { boundaryGap: false }),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: '{value}x' } }),
    series: levRows.map((r, i) => lineSeries(r.label, [COL.red, COL.cyan][i], r.vals.map((v) => rnd(v, 2)))),
  }) : null;

  const rowOption = (r) => themed({
    tooltip: tipBy({}, (v) => cell(r.fmt, v)),
    xAxis: xCat(R.labels, { boundaryGap: false }),
    yAxis: yVal({ scale: true, axisLabel: { color: COL.axis, formatter: r.fmt === 'pct' ? '{value}%' : r.fmt === 'x' ? '{value}x' : undefined } }),
    series: [lineSeries(r.label, COL.teal, r.vals.map((v) => rnd(v, 4)), { area: true })],
  });

  const nRatios = R.sections.reduce((s, x) => s + x.rows.length, 0);
  const span = `${R.labels[0]}–${R.labels[R.labels.length - 1]}`;
  // years the reported periods cover (a part year of quarters counts), and the choice shown within them
  const avail = past ? (freq === 'Q' ? Math.ceil((R.available || R.N) / 4) : R.available || R.N) : 0;
  const yearsShown = Number.isInteger(a.ratio?.histYears) ? Math.min(a.ratio.histYears, Math.max(1, avail)) : '';

  return (
    <div className="qo">
      <Headline
        eyebrow={`${a.company.name} — ratio analysis · ${past ? `reported ${freq === 'Q' ? 'quarters' : 'years'}` : 'forecast'} · ${span}`}
        sub={past
          ? `Ratios on the reported history (${a.history.label}); a ratio whose line was not reported reads —. Balance-based ratios use the average of opening and closing balances.`
          : `Ratios on the annual forecast off the linked 3-statement model (tax after losses, reported opening equity). ${R.balanceOk ? 'The balance sheet ties every year.' : 'The balance sheet does not tie — an input is NA.'}`}
        kpis={[
          { label: `ROE · ${refLbl}`, value: pick('Return on equity (ROE)'), fmt: (v) => f.pct(v) },
          { label: `EBITDA margin · ${refLbl}`, value: pick('EBITDA margin'), fmt: (v) => f.pct(v) },
          { label: `Net debt / EBITDA · ${refLbl}`, value: pick(ndLabel), fmt: (v) => f.x(v) },
          { label: `Interest coverage · ${refLbl}`, value: pick('Interest coverage (EBIT / int.)'), fmt: (v) => f.x1(v) },
          !past && { label: `EPS · ${refLbl}`, value: pick('EPS (ann.)'), fmt: (v) => f.price(v) },
          { label: 'Ratios', text: `${nRatios}`, sub: `${R.N} period${R.N > 1 ? 's' : ''}` },
        ]}
      >
        {past && (
          <div className="qo-steps">
            {a.history?.quarterly?.dates?.length ? (
              <div className="seg" style={{ margin: 0 }}>
                <button className={freq === 'Y' ? 'on' : ''} onClick={() => set('ratio.freq', 'Y')}>Yearly</button>
                <button className={freq === 'Q' ? 'on' : ''} onClick={() => set('ratio.freq', 'Q')}>Quarterly</button>
              </div>
            ) : null}
            <label className="qo-step">
              <span>Years shown</span>
              <select className="fld-in" value={yearsShown} onChange={(e) => set('ratio.histYears', Number(e.target.value))}>
                {Array.from({ length: Math.max(1, avail) }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
        )}
      </Headline>

      {R.sections.map((sec) => {
        // lower is better for borrowing ratios (Debt / …, Net debt / …), leverage, days and cycles — not for covers like DSCR or Cash / debt
        const lowBetter = (r) => /^(net )?debt \/|leverage|gearing|days|cycle|payout|tax rate/i.test(r.label);
        const better = (r) => { const v = r.vals.filter(fin); if (v.length < 2) return null; return lowBetter(r) ? v[v.length - 1] <= v[0] : v[v.length - 1] >= v[0]; };
        const okN = sec.rows.filter((r) => better(r) === true).length, known = sec.rows.filter((r) => better(r) !== null).length;
        const avg = (r) => { const v = r.vals.filter(fin); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
        return (
          <div className="box2 rgp" key={sec.title}>
            <div className="rgp-h"><h3>{sec.title}</h3>{known > 0 && <span className={`pill2 ${okN === known ? 'ok' : okN ? 'pr' : 'bad'}`}>{okN} of {known} improving</span>}</div>
            <div className="rgp-g">
              {sec.rows.map((r) => {
                const lb = lowBetter(r), av = avg(r);
                return (
                  <div key={r.label} className="rgp-c">
                    <div className="rgp-ct"><b>{r.label}</b>{r.note && <span className="fa" title={r.note}>{r.note.length > 46 ? `${r.note.slice(0, 44)}…` : r.note}</span>}<span className="rgp-avg">--- avg {cell(r.fmt, av)}</span></div>
                    <LabelBars labels={R.labels} small h={170} w={460} legend={false} fmt={(v) => cell(r.fmt, v)}
                      series={[{ name: r.label, data: r.vals, color: 'var(--accent)' }]} refLine={fin(av) ? { value: av, label: 'average' } : undefined}
                      colorOf={(_, i, v) => (fin(av) && (lb ? v > av : v < av) ? '#E5484D' : 'var(--accent)')} />
                  </div>
                );
              })}
            </div>
            <table className="alt">
              <thead><tr><th>Ratio</th>{R.labels.map((l, i) => <th key={i}>{l}</th>)}<th>Average</th></tr></thead>
              <tbody>{sec.rows.map((r) => <tr key={r.label}><td title={r.note || ''}>{r.label}</td>{r.vals.map((v, i) => <td key={i}>{cell(r.fmt, v)}</td>)}<td className="am">{cell(r.fmt, avg(r))}</td></tr>)}</tbody>
            </table>
          </div>
        );
      })}
      <Sections>
        {past && <ReportedHistory a={a} f={f} />}
      </Sections>
      <div className="qo-note">
        {past
          ? 'Past ratios use reported figures only — nothing is back-cast. There are no per-share or market ratios for the past, because the history carries no share counts or prices.'
          : '“(ann.)” marks a figure put on an annual basis; valuation ratios use the current share price and appear only when a price was entered.'}
      </div>
    </div>
  );
}
