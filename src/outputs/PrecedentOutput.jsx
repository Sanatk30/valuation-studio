import React, { useMemo } from 'react';
import FootballField from '../components/FootballField.jsx';
import * as PREC from '../lib/engine/precedent.js';
import * as DEAL from '../lib/engine/precedentDeal.js';
import Headline from './parts/Headline.jsx';
import Collapsible, { Sections } from './parts/Collapsible.jsx';
import ChartBox, { EngineError } from './parts/ChartBox.jsx';
import { makeFmt, fin, upsidePct, upsideText, attempt, tone, rnd } from './parts/format.js';
import { themed, xCat, yVal, tipBy, COL, barStyle, bandBarsOption } from './parts/charts.js';

const DASH = '—';

/** Output / list tables driven by the engine's column specs (shared with the Excel export). */
function DealTable({ groups, cols, deals, output, f }) {
  const flat = groups ? groups.flatMap((g) => g.cols) : cols;
  const fmt = (c, v) => {
    if (c.kind === 'text' || c.kind === 'date') return v || DASH;
    if (!fin(v)) return c.nm ? 'NM' : 'NA';
    if (c.kind === 'money') return f.num(v);
    if (c.kind === 'pct') return f.pct(v * 100);
    if (c.kind === 'x') return f.x(v);
    return f.num2(v);
  };
  return (
    <div className="tablewrap bm">
      <table className="fin">
        <thead>
          {groups && (
            <tr className="bm-groups">
              {groups.map((g, i) => <th key={i} colSpan={g.cols.length} className="bm-grp">{g.title}</th>)}
            </tr>
          )}
          <tr>{flat.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {deals.map((d, i) => (
            <tr key={d.deal?.id ?? i}>
              {flat.map((c) => <td key={c.key} className={c.kind === 'text' || c.kind === 'date' ? 'txt' : ''}>{fmt(c, c.get(d))}</td>)}
            </tr>
          ))}
          {output && (
            <>
              <tr className="sechead"><td colSpan={flat.length}>Statistics</td></tr>
              {[['Mean', 'mean'], ['Median', 'median'], ['High', 'high'], ['Low', 'low']].map(([label, k], i) => (
                <tr key={k} className={i < 2 ? 'bold' : 'sub'}>
                  {flat.map((c, j) => <td key={c.key}>{j === 0 ? label : (c.stat && output[c.key] ? fmt(c, output[c.key][k]) : '')}</td>)}
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Precedent transactions output.
 * Props: { a, set, company, skipped } — nothing here is editable. The premia
 * analysis appears only when a market price was entered.
 */
export default function PrecedentOutput({ a }) {
  const f = useMemo(() => makeFmt(a.settings), [a.settings]);
  const model = useMemo(() => attempt(() => PREC.computePrecedent(a)), [a]);
  if (model.error) return <div className="qo"><EngineError what="The precedent transactions analysis" error={model.error} /></div>;
  return <PrecedentPage a={a} f={f} prec={model.value} />;
}

function PrecedentPage({ a, f, prec }) {
  const px = a.company.currentPrice;
  const hasPx = fin(px) && px > 0;
  const rows = prec.rows || [];
  const deals = prec.deals || [];
  const netDebt = prec.netDebt;
  const shares = prec.shares ?? a.company.sharesOut;
  const premDays = DEAL.PREMIUM_DAYS || [1, 7, 30];
  const target = a.precedent?.target || {};
  const ltmNote = target.ltmLabel ? ` (${target.ltmLabel})` : '';

  const ffItems = [
    ...rows.map((r) => ({ label: r.label, low: r.impliedLow, mid: r.impliedMedian, high: r.impliedHigh, color: '#A78BFA' })),
    ...(hasPx ? [{ label: 'Premia analysis (1-day)', low: prec.premia.impliedLow, mid: prec.premia.impliedMedian, high: prec.premia.impliedHigh, color: '#F472B6' }] : []),
  ];
  const ffOk = ffItems.some((it) => fin(it.low) && fin(it.high));

  const byVintage = useMemo(() => {
    const evRow = rows.find((r) => r.key === 'evEbitda');
    if (!evRow) return null;
    const sorted = [...deals].sort((x, y) => (fin(x.year) ? x.year : Infinity) - (fin(y.year) ? y.year : Infinity));
    return bandBarsOption(sorted.map((d) => ({
      name: `${fin(d.year) ? d.year : 'n.d.'} · ${d.deal?.acquirer || ''} / ${d.page?.co?.name || ''}`,
      value: d.evEbitda,
    })), { color: COL.amber, name: 'EV / LTM EBITDA', rotate: 14 });
  }, [prec]); // eslint-disable-line react-hooks/exhaustive-deps

  const premiaOpt = useMemo(() => {
    const pts = [...deals].sort((x, y) => (fin(x.year) ? x.year : Infinity) - (fin(y.year) ? y.year : Infinity))
      .map((d) => ({ name: `${fin(d.year) ? d.year : 'n.d.'} · ${d.page?.co?.name || d.deal?.acquirer || ''}`, v: d.premiums?.[1] * 100 }))
      .filter((p) => fin(p.v));
    if (!pts.length) return null;
    return themed({
      tooltip: { ...tipBy({}, (v) => f.pct0(v)), axisPointer: { type: 'shadow' } }, legend: { show: false },
      xAxis: xCat(pts.map((p) => p.name), { axisLabel: { color: COL.axis, fontSize: 10, interval: 0, rotate: 14 } }),
      yAxis: yVal({ axisLabel: { color: COL.axis, formatter: '{value}%' } }),
      series: [{
        name: '1-day premium', type: 'bar', barMaxWidth: 44, itemStyle: barStyle(COL.rose),
        label: { show: pts.length <= 14, position: 'top', color: COL.axisStrong, fontSize: 10, formatter: (p) => `${p.value}%` },
        data: pts.map((p) => rnd(p.v, 1)),
        ...(fin(prec.premia.median) ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: COL.gold, type: 'dashed' }, label: { formatter: `median ${f.pct0(prec.premia.median)}`, color: COL.gold, fontSize: 11 }, data: [{ yAxis: prec.premia.median }] } } : {}),
      }],
    });
  }, [prec]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qo">
      {/* every implied-price row side by side — no single headline row (the user's choice) */}
      <Headline
        eyebrow={`Precedent transactions — implied takeover value from ${deals.length} deals`}
        sub={`Transaction LTM multiples (median, 25th–75th percentile) × the target's LTM revenue and EBITDA${ltmNote}, bridged to equity through net debt of ${f.money(netDebt)}. Deal multiples embed the control premium paid.${hasPx ? ` Market price ${f.price(px)}.` : ''}`}
        kpis={[
          ...rows.map((r) => {
            const ev = r.median * r.metric;
            const up = upsideText(r.impliedMedian, px);
            return {
              label: `${r.label} — implied price`, value: r.impliedMedian, fmt: (v) => f.price(v),
              tone: hasPx && fin(r.impliedMedian) ? tone(upsidePct(r.impliedMedian, px)) : undefined,
              sub: `${f.price(r.impliedLow)} – ${f.price(r.impliedHigh)} · EV ${f.money(ev)} · equity ${f.money(ev - netDebt)}${up ? ` · ${up}` : ''}`,
            };
          }),
          hasPx && {
            label: 'Premia analysis — implied offer', value: prec.premia.impliedMedian, fmt: (v) => f.price(v),
            tone: tone(upsidePct(prec.premia.impliedMedian, px)),
            sub: `median 1-day premium ${f.pct0(prec.premia.median)} on ${f.price(px)} · ${f.price(prec.premia.impliedLow)} – ${f.price(prec.premia.impliedHigh)}`,
          },
        ]}
      >
        <div className="grid2">
          <div className="chartbox">
            <div className="ct">Implied takeover value per share ({f.sym}) — 25th to 75th percentile, median marked</div>
            {ffOk
              ? <FootballField items={ffItems} currentPrice={hasPx ? px : NaN} fmt={f.gridPrice} />
              : <div className="sec-note">No implied range could be computed — check the deal multiples below.</div>}
          </div>
          <ChartBox title="Deal EV / LTM EBITDA by vintage — median and quartile band" option={byVintage} empty="No deal has a meaningful EV / LTM EBITDA." />
        </div>
      </Headline>

      <Sections>
        <Collapsible title={`Bottom-up: deal multiple → implied takeover price (${f.sym})`} tag="PRICE">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th /><th>25th pct</th><th>Median</th><th>75th pct</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const steps = [r.q1, r.median, r.q3];
                  const prices = [r.impliedLow, r.impliedMedian, r.impliedHigh];
                  return (
                    <React.Fragment key={r.key}>
                      <tr className="sechead"><td colSpan={4}>{r.label} × {r.metricLabel} ({f.money(r.metric)})</td></tr>
                      <tr className="sub"><td>Deal multiple</td>{steps.map((m, i) => <td key={i}>{f.x(m)}</td>)}</tr>
                      <tr><td>Implied enterprise value</td>{steps.map((m, i) => <td key={i}>{f.num(m * r.metric)}</td>)}</tr>
                      <tr className="sub"><td>Less: net debt</td>{steps.map((_, i) => <td key={i} className="neg">{f.num(-netDebt)}</td>)}</tr>
                      <tr><td>Implied equity value</td>{steps.map((m, i) => <td key={i}>{f.num(m * r.metric - netDebt)}</td>)}</tr>
                      <tr className="sub"><td>÷ Shares outstanding</td>{steps.map((_, i) => <td key={i}>{f.shares(shares)}</td>)}</tr>
                      <tr className="bold"><td>Implied price</td>{prices.map((v, i) => <td key={i}>{f.price(v)}</td>)}</tr>
                      {hasPx && <tr className="sub"><td>vs market ({f.price(px)})</td>{prices.map((v, i) => <td key={i}>{f.pct(upsidePct(v, px))}</td>)}</tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="qo-note">Money in {f.unitLabel}. Statistics over deals with a meaningful multiple only.</div>
        </Collapsible>

        <Collapsible title="Transaction multiples and premiums paid" tag="OUTPUT" note={`${deals.length} deals`}>
          <div className="qo-note">Each deal's target priced at the offer: transaction multiples on the target's LTM metrics, LTM EBITDA margin, and premiums paid {premDays.join(' / ')} days before the unaffected date.</div>
          <DealTable groups={prec.cols.output} deals={deals} output={prec.output} f={f} />
        </Collapsible>

        <Collapsible title="Transaction list" tag="LIST">
          <DealTable cols={prec.cols.list} deals={deals} f={f} />
        </Collapsible>

        <Collapsible title="Multiple statistics — quartiles" tag="STATS">
          <div className="tablewrap">
            <table className="fin">
              <thead><tr><th>Transaction multiple</th><th>Deals used</th><th>Low</th><th>25th pct</th><th>Median</th><th>Mean</th><th>75th pct</th><th>High</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td><td>{fin(r.n) ? r.n : DASH}</td>
                    <td>{f.x(r.low)}</td><td>{f.x(r.q1)}</td><td className="bold">{f.x(r.median)}</td>
                    <td>{f.x(r.mean)}</td><td>{f.x(r.q3)}</td><td>{f.x(r.high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>

        {hasPx && (
          <Collapsible title="Premia analysis — observed premiums on today's price" tag="PREMIA" note={`on ${f.price(px)}`}>
            <div className="tablewrap">
              <table className="fin">
                <thead><tr><th /><th>25th pct</th><th>Median</th><th>75th pct</th></tr></thead>
                <tbody>
                  <tr className="sub"><td>1-day premium paid</td><td>{f.pct0(prec.premia.q1)}</td><td>{f.pct0(prec.premia.median)}</td><td>{f.pct0(prec.premia.q3)}</td></tr>
                  <tr className="sub"><td>× Current share price</td><td>{f.price(px)}</td><td>{f.price(px)}</td><td>{f.price(px)}</td></tr>
                  <tr className="bold"><td>Implied offer price</td><td>{f.price(prec.premia.impliedLow)}</td><td>{f.price(prec.premia.impliedMedian)}</td><td>{f.price(prec.premia.impliedHigh)}</td></tr>
                  <tr className="sub"><td>Implied equity value ({f.unitLabel})</td>{[prec.premia.impliedLow, prec.premia.impliedMedian, prec.premia.impliedHigh].map((v, i) => <td key={i}>{f.num(v * shares)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            {prec.premiaByWindow && (
              <div className="tablewrap">
                <table className="fin">
                  <thead><tr><th>Premium window</th><th>Deals</th><th>Low</th><th>25th pct</th><th>Median</th><th>Mean</th><th>75th pct</th><th>High</th></tr></thead>
                  <tbody>
                    {premDays.map((d) => {
                      const st = prec.premiaByWindow[d] || {};
                      return (
                        <tr key={d}>
                          <td>{d} day{d > 1 ? 's' : ''} prior</td><td>{fin(st.n) ? st.n : DASH}</td>
                          <td>{f.pct(st.low)}</td><td>{f.pct(st.q1)}</td><td className="bold">{f.pct(st.median)}</td>
                          <td>{f.pct(st.mean)}</td><td>{f.pct(st.q3)}</td><td>{f.pct(st.high)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <ChartBox title="1-day premium paid, by deal, vs the median" option={premiaOpt} empty="No deal has an unaffected share price." />
          </Collapsible>
        )}
      </Sections>
    </div>
  );
}
