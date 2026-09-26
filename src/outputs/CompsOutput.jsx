import React, { useMemo } from 'react';
import FootballField from '../components/FootballField.jsx';
import * as COMPS from '../lib/engine/comps.js';
import * as REG from '../lib/engine/regressionModel.js';
import { STAT_LABELS, STAT_SHORT } from '../lib/engine/templateStats.js';
import { fmtTpl, fmtDate } from '../lib/format.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import RegressionSections from './parts/RegressionSections.jsx';
import { makeFmt, fin, upsidePct, attempt, tone } from './parts/format.js';
import { boxOption } from './parts/charts.js';

/**
 * Comparable Company Analysis output — the template's Comps Summary (Table 1
 * market data & multiples, Table 2 benchmarking, statistics overall and per
 * tier) and Implied Valuation, plus the football field and (unless skipped)
 * the regression. `set('comps.headline', key)` picks the multiple that feeds
 * the Combined valuation.
 */
export default function CompsOutput({ a, set, skipped = {} }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const showReg = !skipped.regression;
  const model = useMemo(() => attempt(() => ({
    comps: COMPS.computeComps(a),
    reg: showReg ? REG.runRegression(a) : null,
  })), [a, showReg]);
  if (model.error) return <div className="qo"><EngineError what="The comparable company analysis" error={model.error} /></div>;
  return <CompsPage a={a} f={f} set={set} c={model.value.comps} R={model.value.reg} showReg={showReg} />;
}

/** Statistics rows (the chosen ones) for a set of columns. */
export function StatRows({ stats, cols, show, fmtOf, lead, title, locale }) {
  return (
    <>
      {title && <tr className="tpl-stat-h"><td colSpan={lead + cols.length}>{title}</td></tr>}
      {show.map((k, i) => (
        <tr key={k} className={`tpl-stat${i === 0 ? ' first' : ''}`}>
          <td colSpan={lead}>{STAT_LABELS[k]}</td>
          {cols.map((c) => <td key={c.key}>{c.stat === false ? '' : fmtTpl(stats[c.key]?.[k], fmtOf(c), locale)}</td>)}
        </tr>
      ))}
    </>
  );
}

function CompsPage({ a, f, set, c, R, showReg }) {
  const px = c.targetMarket.price;
  const hasPx = fin(px) && px > 0;
  const sel = c.statSel;
  const locale = f.locale;
  const headline = a.comps?.headline || null;
  const regPrice = R?.fit?.ok ? R.price : null;
  const lab = c.labels;
  const nIncl = c.peers.filter((p) => p.include === 1 && !p.empty).length;
  const nPeers = c.peers.filter((p) => !p.empty).length;

  const ffItems = [
    ...c.implied.map((r) => ({ label: r.label, low: num(r.price.low), mid: num(r.price.mid), high: num(r.price.high), color: r.key === headline ? '#F5B942' : undefined })),
    ...(regPrice ? [{ label: `Regression (${R.yDef?.label || R.yVar}, ±1 SE)`, low: regPrice.lo, mid: regPrice.mid, high: regPrice.hi, color: '#22D3EE' }] : []),
  ].map((it) => ({ ...it, low: Math.min(...[it.low, it.mid, it.high].filter(fin)), high: Math.max(...[it.low, it.mid, it.high].filter(fin)) }));
  const ffOk = ffItems.some((it) => fin(it.low) && fin(it.high));

  const boxOpt = useMemo(() => boxOption(COMPS.COMPS_MULTIPLES.map((m) => ({
    label: COMPS.multipleLabel(m, lab),
    values: c.peers.filter((p) => p.include === 1).map((p) => p.mult[m.key]).filter(fin),
  }))), [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const hRow = c.implied.find((r) => r.key === headline);
  const s = c.summary;

  const t1Cols = [
    { key: 'price', label: `Share Price (${f.sym})`, fmt: 'n2', stat: false, get: (r) => r.price },
    { key: 'mcap', label: 'Market Cap', fmt: 'n1', stat: false, get: (r) => r.mcap },
    { key: 'netDebt', label: 'Net Debt', fmt: 'n1', stat: false, get: (r) => r.netDebt },
    { key: 'ev', label: 'Enterprise Value', fmt: 'n1', stat: false, get: (r) => r.ev },
    { key: 'revLtm', label: `Revenue ${lab.ltm}`, fmt: 'n1', stat: false, get: (r) => r.revLtm },
    { key: 'ebitdaLtm', label: `EBITDA ${lab.ltm}`, fmt: 'n1', stat: false, get: (r) => r.ebitdaLtm },
    { key: 'patLtm', label: `PAT ${lab.ltm}`, fmt: 'n1', stat: false, get: (r) => r.patLtm },
    ...COMPS.COMPS_MULTIPLES.map((m) => ({ key: m.key, label: COMPS.multipleLabel(m, lab), fmt: 'x', get: (r) => r.mult[m.key] })),
  ];
  const t2Cols = COMPS.COMPS_BENCH.map((b) => ({
    key: b.key, label: `${b.name} ${b.period === 'fy' ? lab.fy[lab.fy.length - 1] : lab.ltm}`,
    fmt: b.fmt === 'days' ? 'n0' : b.fmt, get: (r) => r.bench[b.key],
  }));
  const hasTiers = c.tiers.length > 0;

  const table = (cols, stats, tierKey) => (
    <div className="tablewrap tpl-sum">
      <table className="fin compact">
        <thead>
          <tr><th>Company</th><th>Ticker</th><th>Include</th>{hasTiers && <th>Tier</th>}{cols.map((col) => <th key={col.key}>{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {[c.target, ...c.peers].map((r) => (
            <tr key={r.id} className={r.role === 'Target' ? 'tpl-target' : r.include === 1 ? '' : 'tpl-excl'}>
              <td>{r.name || r.role}</td><td>{r.ticker}</td><td>{r.role === 'Target' ? 'n.a.' : r.include ?? ''}</td>
              {hasTiers && <td>{r.tier}</td>}
              {cols.map((col) => <td key={col.key}>{fmtTpl(col.get(r), col.fmt, locale)}</td>)}
            </tr>
          ))}
          <StatRows stats={stats} cols={cols} show={sel.show} fmtOf={(col) => col.fmt} lead={hasTiers ? 4 : 3} locale={locale}
            title="Peer statistics (included peers only; target excluded)" />
          {c.tiers.map((tr) => (
            <StatRows key={tr.id ?? 'none'} stats={tr[tierKey]} cols={cols} show={sel.show} fmtOf={(col) => col.fmt} lead={hasTiers ? 4 : 3} locale={locale}
              title={`${tr.name} — statistics (included peers in this tier)`} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="qo">
      <Headline
        eyebrow={`Comparable companies — ${nIncl} of ${nPeers} peers in the statistics`}
        sub={`Implied value = peer ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiple × the target’s metric; EV methods less net debt ${f.money(c.targetMarket.netDebt)} and NCI ${f.money(c.targetMarket.nci)}, over ${f.shares(c.targetMarket.shares)} ${f.unit} diluted shares.${hasPx ? ` Current price ${f.price(px)}.` : ''}`}
        kpis={[
          hRow && {
            label: `Headline — ${hRow.label} (${STAT_SHORT[sel.mid]})`, value: num(hRow.price.mid), fmt: (v) => f.price(v), hero: true,
            tone: hasPx ? tone(upsidePct(num(hRow.price.mid), px)) : undefined,
            sub: `${f.price(num(hRow.price.low))} – ${f.price(num(hRow.price.high))} (${STAT_SHORT[sel.low]} – ${STAT_SHORT[sel.high]})`,
          },
          { label: 'Median of the mid-based prices', value: num(s.medianMid), fmt: (v) => f.price(v), tone: hasPx ? tone(upsidePct(num(s.medianMid), px)) : undefined, sub: fin(num(s.upside)) ? `${f.pct(s.upside * 100)} vs the current price` : 'no current price' },
          { label: 'Lowest implied price', value: num(s.lowest), fmt: (v) => f.price(v) },
          { label: 'Highest implied price', value: num(s.highest), fmt: (v) => f.price(v) },
          regPrice && { label: 'Regression — implied price', value: regPrice.mid, fmt: (v) => f.price(v), sub: `${f.price(regPrice.lo)} – ${f.price(regPrice.hi)} (±1 SE) · R² ${f.dec(R.fit.r2, 2)}` },
        ].filter(Boolean)}
      >
        <div className="headline-pick">
          <label>Headline multiple for the Combined valuation</label>
          <select className="fld-in" value={headline || ''} onChange={(e) => set('comps.headline', e.target.value || null)}>
            <option value="">none — offer every multiple</option>
            {c.implied.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Implied share price ({f.sym}) — {STAT_SHORT[sel.low]} to {STAT_SHORT[sel.high]}, {STAT_SHORT[sel.mid]} marked</div>
            {ffOk ? <FootballField items={ffItems.filter((it) => fin(it.low))} currentPrice={hasPx ? px : NaN} fmt={f.gridPrice} />
              : <div className="sec-note">No implied price could be computed — see NM cells in the tables below.</div>}
          </div>
          <ChartBox title="Included peers’ multiples — distribution" option={boxOpt} empty="No included peer has a meaningful multiple." />
        </div>
      </Headline>

      <Sections>
        <Collapsible title="Implied valuation of the target" tag="IMPLIED" defaultOpen>
          <div className="tablewrap tpl-sum">
            <table className="fin compact">
              <thead>
                <tr>
                  <th>Method</th><th>Target metric</th>
                  <th>Peer {STAT_SHORT[sel.low]}</th><th>Peer {STAT_SHORT[sel.mid]}</th><th>Peer {STAT_SHORT[sel.high]}</th>
                  <th>Equity Value @{STAT_SHORT[sel.low]}</th><th>Equity Value @{STAT_SHORT[sel.mid]}</th><th>Equity Value @{STAT_SHORT[sel.high]}</th>
                  <th>Price/Share @{STAT_SHORT[sel.low]} ({f.sym})</th><th>Price/Share @{STAT_SHORT[sel.mid]} ({f.sym})</th><th>Price/Share @{STAT_SHORT[sel.high]} ({f.sym})</th>
                </tr>
              </thead>
              <tbody>
                {c.implied.map((r) => (
                  <tr key={r.key} className={r.key === headline ? 'tpl-target' : ''}>
                    <td>{r.label}</td><td>{fmtTpl(r.metric, 'n1', locale)}</td>
                    {['low', 'mid', 'high'].map((k) => <td key={`m${k}`}>{fmtTpl(r.mults[k], 'x', locale)}</td>)}
                    {['low', 'mid', 'high'].map((k) => <td key={`e${k}`}>{fmtTpl(r.equity[k], 'n1', locale)}</td>)}
                    {['low', 'mid', 'high'].map((k) => <td key={`p${k}`}>{fmtTpl(r.price[k], 'n2', locale)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tablewrap" style={{ maxWidth: 520 }}>
            <table className="fin compact">
              <tbody>
                <tr><td>Lowest implied price ({f.sym})</td><td>{fmtTpl(s.lowest, 'n2', locale)}</td></tr>
                <tr className="tp-sub"><td>Median of {STAT_SHORT[sel.mid].toLowerCase()}-based prices ({f.sym})</td><td>{fmtTpl(s.medianMid, 'n2', locale)}</td></tr>
                <tr><td>Highest implied price ({f.sym})</td><td>{fmtTpl(s.highest, 'n2', locale)}</td></tr>
                <tr><td>Current share price ({f.sym})</td><td>{fmtTpl(s.currentPrice, 'n2', locale)}</td></tr>
                <tr className="tp-sub"><td>Upside / (downside) to the median-based price</td><td>{fmtTpl(s.upside, 'pct', locale)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="qo-note">EV-based methods: equity value = multiple × metric − net debt − non-controlling interest. Equity-based methods (P/E, P/B): equity value = multiple × metric. NM = not meaningful (no peer statistic, or a zero / negative target metric).</div>
        </Collapsible>

        <Collapsible title="Table 1: Market data & valuation multiples" tag="TABLE 1" defaultOpen>
          {table(t1Cols, c.stats1, 'stats1')}
          <div className="qo-note">{f.unitLabel} unless stated · prices as of {a.comps?.settings?.priceDate ? fmtDate(a.comps.settings.priceDate) : '[price date not set]'}. NM = zero or negative denominator; NM values are excluded from the statistics.</div>
        </Collapsible>

        <Collapsible title="Table 2: Operating & financial benchmarking" tag="TABLE 2" defaultOpen>
          {table(t2Cols, c.stats2, 'stats2')}
          <div className="qo-note">Growth and cash-flow quality use the latest fiscal year (LTM growth needs prior-LTM data).</div>
        </Collapsible>

        {showReg && <RegressionSections a={a} f={f} R={R} px={px} />}
      </Sections>
    </div>
  );
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
