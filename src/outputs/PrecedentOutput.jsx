import React, { useMemo } from 'react';
import FootballField from '../components/FootballField.jsx';
import * as PREC from '../lib/engine/precedent.js';
import { STAT_SHORT } from '../lib/engine/templateStats.js';
import { fmtTpl, fmtDate } from '../lib/format.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { StatRows } from './CompsOutput.jsx';
import { makeFmt, fin, upsidePct, attempt, tone } from './parts/format.js';
import { boxOption } from './parts/charts.js';
import { useThemeMode } from '../lib/theme.js';


/**
 * Precedent Transactions output — the template's Transaction Summary
 * (Table 1 deal values & multiples, Table 2 target operating profile, with
 * statistics over the included deals) and Implied Valuation, plus the
 * football field. `set('precedent.headline', key)` picks the method that feeds
 * the Combined valuation.
 */
export default function PrecedentOutput({ a, set }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => PREC.computePrecedent(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The precedent transactions analysis" error={model.error} /></div>;
  return <PrecPage a={a} f={f} set={set} p={model.value} />;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

function PrecPage({ a, f, set, p }) {
  const px = p.companyMarket.price;
  const hasPx = fin(px) && px > 0;
  const sel = p.statSel;
  const locale = f.locale;
  const headline = a.precedent?.headline || null;
  const nIncl = p.deals.filter((d) => d.include === 1 && !d.empty).length;
  const nDeals = p.deals.filter((d) => !d.empty).length;
  const s = p.summary;
  const hRow = p.implied.find((r) => r.key === headline);

  const ffItems = p.implied.map((r) => {
    const v = [r.price.low, r.price.mid, r.price.high].filter(fin);
    return { label: r.label, low: v.length ? Math.min(...v) : NaN, mid: num(r.price.mid), high: v.length ? Math.max(...v) : NaN, highlight: r.key === headline };
  }).filter((it) => fin(it.low));

  const theme = useThemeMode();
  const boxOpt = useMemo(() => boxOption(PREC.DEAL_MULTIPLES.map((m) => ({
    label: m.label, values: p.deals.filter((d) => d.include === 1).map((d) => d.mult[m.key]).filter(fin),
  }))), [p, theme]);

  const idCols = [
    { key: 'date', label: 'Date', get: (d) => fmtDate(d.deal.date) },
    { key: 'target', label: 'Target', get: (d) => d.deal.target },
    { key: 'acquirer', label: 'Acquirer', get: (d) => d.deal.acquirer },
    { key: 'type', label: 'Acquirer Type', get: (d) => d.deal.acquirerType },
    { key: 'stake', label: 'Stake', get: (d) => (fin(d.deal.stakePct) ? fmtTpl(d.deal.stakePct / 100, 'pct', locale) : '') },
    { key: 'include', label: 'Include', get: (d) => d.include ?? '' },
  ];
  const t1 = [
    { key: 'equity', label: 'Implied Equity Value (100%)', fmt: 'n1', get: (d) => d.equity },
    { key: 'netDebt', label: 'Net Debt', fmt: 'n1', stat: false, get: (d) => d.netDebt },
    { key: 'ev', label: 'Implied Enterprise Value', fmt: 'n1', get: (d) => d.ev },
    { key: 'rev', label: 'LTM Revenue', fmt: 'n1', stat: false, get: (d) => d.revLtm },
    { key: 'ebitda', label: 'LTM EBITDA', fmt: 'n1', stat: false, get: (d) => d.ebitdaLtm },
    { key: 'pat', label: 'LTM PAT', fmt: 'n1', stat: false, get: (d) => d.patLtm },
    ...PREC.DEAL_MULTIPLES.map((m) => ({ key: m.key, label: m.label, fmt: 'x', get: (d) => d.mult[m.key] })),
    { key: 'premium', label: 'Control Premium', fmt: 'pct', get: (d) => d.premium },
  ];
  const t2 = PREC.DEAL_BENCH.map((b) => ({ key: b.key, label: b.name, fmt: b.fmt === 'days' ? 'n0' : b.fmt, get: (d) => d.bench[b.key] }));

  const table = (cols, stats) => (
    <div className="tablewrap tpl-sum">
      <table className="fin compact">
        <thead><tr><th>Deal</th>{idCols.map((c) => <th key={c.key}>{c.label}</th>)}{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {p.deals.map((d) => (
            <tr key={d.id} className={d.include === 1 ? '' : 'tpl-excl'}>
              <td>{d.role}</td>
              {idCols.map((c) => <td key={c.key}>{c.get(d)}</td>)}
              {cols.map((c) => <td key={c.key}>{fmtTpl(c.get(d), c.fmt, locale)}</td>)}
            </tr>
          ))}
          <StatRows stats={stats} cols={cols} show={sel.show} fmtOf={(c) => c.fmt} lead={1 + idCols.length} locale={locale}
            title="Statistics (deals flagged 1 in Include only)" />
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="qo">
      <Headline
        eyebrow={`Precedent transactions — ${nIncl} of ${nDeals} deals in the statistics`}
        sub={`Implied value = deal ${STAT_SHORT[sel.low]} / ${STAT_SHORT[sel.mid]} / ${STAT_SHORT[sel.high]} multiple × the company’s LTM metric; EV methods less net debt ${f.money(p.companyMarket.netDebt)} and NCI ${f.money(p.companyMarket.nci)}${p.companyMarket.nonOp ? `, plus non-operating investments ${f.money(p.companyMarket.nonOp)}` : ''}. Transaction multiples include a control premium — they value a controlling stake.${hasPx ? ` Current price ${f.price(px)}.` : ''}`}
        kpis={[
          hRow && {
            label: `Headline — ${hRow.label} (${STAT_SHORT[sel.mid]})`, value: num(hRow.price.mid), fmt: (v) => f.price(v), hero: true,
            tone: hasPx ? tone(upsidePct(num(hRow.price.mid), px)) : undefined,
            sub: `${f.price(num(hRow.price.low))} – ${f.price(num(hRow.price.high))} (${STAT_SHORT[sel.low]} – ${STAT_SHORT[sel.high]})`,
          },
          { label: 'Median of the mid-based prices', value: num(s.medianMid), fmt: (v) => f.price(v), tone: hasPx ? tone(upsidePct(num(s.medianMid), px)) : undefined, sub: fin(num(s.upside)) ? `${f.pct(s.upside * 100)} vs the current price` : 'no current price' },
          { label: 'Lowest implied price', value: num(s.lowest), fmt: (v) => f.price(v) },
          { label: 'Highest implied price', value: num(s.highest), fmt: (v) => f.price(v) },
        ].filter(Boolean)}
      >
        <div className="headline-pick">
          <label>Headline method for the Combined valuation</label>
          <select className="fld-in" value={headline || ''} onChange={(e) => set('precedent.headline', e.target.value || null)}>
            <option value="">none — offer every method</option>
            {p.implied.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Implied share price ({f.sym}) — {STAT_SHORT[sel.low]} to {STAT_SHORT[sel.high]}, {STAT_SHORT[sel.mid]} marked</div>
            {ffItems.length ? <FootballField items={ffItems} currentPrice={hasPx ? px : NaN} fmt={f.gridPrice} />
              : <div className="sec-note">No implied price could be computed — see NM cells in the tables below.</div>}
          </div>
          <ChartBox title="Included deals’ multiples — distribution" option={boxOpt} empty="No included deal has a meaningful multiple." />
        </div>
      </Headline>

      <Sections>
        <Collapsible title="Implied valuation from precedent transactions" tag="IMPLIED" defaultOpen>
          <div className="tablewrap tpl-sum">
            <table className="fin compact">
              <thead>
                <tr>
                  <th>Method</th><th>Company metric</th>
                  <th>Deals {STAT_SHORT[sel.low]}</th><th>Deals {STAT_SHORT[sel.mid]}</th><th>Deals {STAT_SHORT[sel.high]}</th>
                  <th>Equity Value @{STAT_SHORT[sel.low]}</th><th>Equity Value @{STAT_SHORT[sel.mid]}</th><th>Equity Value @{STAT_SHORT[sel.high]}</th>
                  <th>Price/Share @{STAT_SHORT[sel.low]} ({f.sym})</th><th>Price/Share @{STAT_SHORT[sel.mid]} ({f.sym})</th><th>Price/Share @{STAT_SHORT[sel.high]} ({f.sym})</th>
                </tr>
              </thead>
              <tbody>
                {p.implied.map((r) => (
                  <tr key={r.key} className={r.key === headline ? 'tpl-target' : ''}>
                    <td>{r.label}</td><td>{fmtTpl(r.metric, r.premium ? 'n2' : 'n1', locale)}</td>
                    {['low', 'mid', 'high'].map((k) => <td key={`m${k}`}>{fmtTpl(r.mults[k], r.premium ? 'pct' : 'x', locale)}</td>)}
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
                <tr className="tp-sub"><td>Premium / (discount) to the current price</td><td>{fmtTpl(s.upside, 'pct', locale)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="qo-note">
            EV methods: equity = multiple × metric − net debt − NCI + non-operating investments. P/E, P/B: equity = multiple × metric. A negative implied equity value is NM. The control-premium method applies only to a listed company
            (for an unlisted one leave the price blank — that row shows NM). Precedent values are usually higher than trading comps because they include a control premium;
            older deals may reflect different market conditions.
          </div>
        </Collapsible>

        <Collapsible title="Table 1: Deal values & transaction multiples" tag="TABLE 1" defaultOpen>
          {table(t1, p.stats1)}
          <div className="qo-note">{f.unitLabel} unless stated · multiples on the target’s LTM financials at announcement · NM = zero or negative denominator, excluded from the statistics.</div>
        </Collapsible>

        <Collapsible title="Table 2: Target operating profile at announcement" tag="TABLE 2" defaultOpen>
          {table(t2, p.stats2)}
          <div className="qo-note">Compare the company being valued with Table 2 to decide which deals are most relevant.</div>
        </Collapsible>
      </Sections>
    </div>
  );
}
