import React, { useMemo, useState } from 'react';
import FootballField from '../components/FootballField.jsx';
import Hero from '../components/Hero.jsx';
import DealPageEditor from '../components/DealPageEditor.jsx';
import { Anim } from '../lib/anim.jsx';
import { applyScenario } from '../lib/engine/scenario.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { blankDeal, PREMIUM_DAYS } from '../lib/engine/precedentDeal.js';
import { fmtMoney, fmtPrice, fmtPct, fmtX, fmtNum, CURRENCIES } from '../lib/format.js';

/** Output / List tables share one column-spec renderer with the Excel export. */
function DealTable({ groups, cols, deals, output, settings, onPick }) {
  const locale = CURRENCIES[settings.currency].locale;
  const flat = groups ? groups.flatMap((g) => g.cols) : cols;
  const fmt = (c, v) => {
    if (c.kind === 'text') return v || '—';
    if (c.kind === 'date') return v || '—';
    if (!isFinite(v)) return c.nm ? 'NM' : 'NA';
    if (c.kind === 'money') return fmtNum(v, 0, locale);
    if (c.kind === 'pct') return fmtPct(v * 100, 1);
    if (c.kind === 'x') return fmtX(v, 2);
    return fmtNum(v, 2, locale);
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
          {deals.map((d) => (
            <tr key={d.deal.id} className={onPick ? 'clickable' : ''} onClick={onPick ? () => onPick(d.deal.id) : undefined}>
              {flat.map((c) => (
                <td key={c.key} className={c.kind === 'text' || c.kind === 'date' ? 'txt' : ''}>{fmt(c, c.get(d))}</td>
              ))}
            </tr>
          ))}
          {output && (
            <>
              <tr className="sechead"><td colSpan={flat.length}>Statistics</td></tr>
              {[['Mean', 'mean'], ['Median', 'median'], ['High', 'high'], ['Low', 'low']].map(([label, k], i) => (
                <tr key={k} className={i < 2 ? 'bold' : 'sub'}>
                  {flat.map((c, j) => (
                    <td key={c.key}>{j === 0 ? label : (c.stat && output[c.key] ? fmt(c, output[c.key][k]) : '')}</td>
                  ))}
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PrecedentTab({ a, set }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const prec = useMemo(() => computePrecedent(am), [am]);
  const s = a.settings;
  const locale = CURRENCIES[s.currency].locale;
  const deals = a.precedent.deals || [];
  const [view, setView] = useState('output');
  const [openId, setOpenId] = useState(deals[0]?.id ?? null);
  const openDeal = deals.find((d) => d.id === openId) || deals[0];

  const setDeal = (id, next) => set('precedent.deals', (rows) => rows.map((d) => (d.id === id ? next : d)));
  const delDeal = (id) => set('precedent.deals', (rows) => rows.filter((d) => d.id !== id));
  const addDeal = () => {
    const d = blankDeal({ acquirer: `Acquirer ${deals.length + 1}` });
    set('precedent.deals', (rows) => [...rows, d]);
    setOpenId(d.id);
    setView('pages');
  };

  const evRow = prec.rows[1];

  return (
    <div className="view">
      <Hero
        eyebrow="Precedent transactions — implied takeover value"
        value={evRow.impliedMedian}
        fmt={(v) => fmtPrice(v, s)}
        sub={`What control has cost in this sector: ${prec.deals.length} transactions at a median ${fmtX(evRow.median, 1)} LTM EBITDA and a ${fmtPct(prec.premia.median, 0)} one-day premium. Every deal is a full input page — the target's reported financials priced at the offer.`}
        chips={[
          { label: 'EV/Sales', value: prec.rows[0].impliedMedian, fmt: (v) => fmtPrice(v, s) },
          ...(a.company.currentPrice > 0 ? [{ label: 'premia', value: prec.premia.impliedMedian, fmt: (v) => fmtPrice(v, s), tone: 'warn' }] : []),
          { label: 'median premium', value: prec.premia.median, fmt: (v) => fmtPct(v, 0) },
        ]}
      />

      <div className="cards">
        <div className="card hero">
          <div className="k">EV / LTM EBITDA — implied price</div>
          <div className="v"><Anim value={evRow.impliedMedian} fmt={(v) => fmtPrice(v, s)} /></div>
          <div className="s">{fmtPrice(evRow.impliedLow, s)} – {fmtPrice(evRow.impliedHigh, s)} (25th–75th pct)</div>
        </div>
        <div className="card">
          <div className="k">EV / LTM Sales — implied price</div>
          <div className="v"><Anim value={prec.rows[0].impliedMedian} fmt={(v) => fmtPrice(v, s)} /></div>
          <div className="s">{fmtPrice(prec.rows[0].impliedLow, s)} – {fmtPrice(prec.rows[0].impliedHigh, s)}</div>
        </div>
        <div className="card">
          <div className="k">Premia analysis — implied price</div>
          <div className="v">{a.company.currentPrice > 0 ? <Anim value={prec.premia.impliedMedian} fmt={(v) => fmtPrice(v, s)} /> : 'n/m'}</div>
          <div className="s">
            {a.company.currentPrice > 0
              ? `Median 1-day premium ${fmtPct(prec.premia.median, 0)} on ${fmtPrice(a.company.currentPrice, s)}`
              : 'Enter a current share price'}
          </div>
        </div>
      </div>

      <h3 className="blocktitle">
        Precedent transactions
        <span className="viewtabs">
          {[['output', 'Output'], ['list', 'List'], ['pages', 'Input pages']].map(([k, lab]) => (
            <button key={k} className={`vt${view === k ? ' on' : ''}`} onClick={() => setView(k)}>{lab}</button>
          ))}
        </span>
      </h3>

      {view === 'output' && (
        <>
          <div className="sec-note">Transaction multiples on the target's LTM metrics, the LTM EBITDA margin, and premiums paid at {PREMIUM_DAYS.join(' / ')} days prior to the unaffected price. Click a row to open that deal's input page.</div>
          <DealTable groups={prec.cols.output} deals={prec.deals} output={prec.output} settings={s}
            onPick={(id) => { setOpenId(id); setView('pages'); }} />
        </>
      )}
      {view === 'list' && (
        <DealTable cols={prec.cols.list} deals={prec.deals} settings={s}
          onPick={(id) => { setOpenId(id); setView('pages'); }} />
      )}
      {view === 'pages' && (
        <div className="cp-wrap">
          <div className="cp-list">
            <div className="cp-list-h">Transactions</div>
            {deals.map((d) => (
              <button key={d.id} className={`cp-pick${openId === d.id ? ' on' : ''}`} onClick={() => setOpenId(d.id)}>
                {d.acquirer} <span className="cp-pick-s">/ {d.target?.name}</span>
              </button>
            ))}
            <button className="btn sm" style={{ marginTop: 8 }} onClick={addDeal}>+ Add transaction</button>
          </div>
          <div className="cp-body">
            {openDeal ? (
              <DealPageEditor
                deal={openDeal} settings={s}
                onChange={(next) => setDeal(openDeal.id, next)}
                onDelete={() => { delDeal(openDeal.id); setOpenId(deals.find((d) => d.id !== openDeal.id)?.id ?? null); }}
              />
            ) : (
              <div className="sec-note">No transactions yet — add one on the left.</div>
            )}
          </div>
        </div>
      )}

      <h3 className="blocktitle">Bottom-up: deal multiple → implied takeover price ({CURRENCIES[s.currency].symbol})</h3>
      <div className="tablewrap" style={{ marginBottom: 20 }}>
        <table className="fin">
          <thead><tr><th></th><th>25th pct</th><th>Median</th><th>75th pct</th></tr></thead>
          <tbody>
            {prec.rows.map((r) => {
              const steps = [r.q1, r.median, r.q3];
              return (
                <React.Fragment key={r.key}>
                  <tr className="sechead"><td colSpan={4}>{r.label} × {r.metricLabel} ({fmtMoney(r.metric, s)})</td></tr>
                  <tr className="sub"><td>Deal multiple</td>{steps.map((m, i) => <td key={i}>{fmtX(m, 2)}</td>)}</tr>
                  <tr><td>Implied enterprise value</td>{steps.map((m, i) => <td key={i}>{fmtNum(m * r.metric, 0, locale)}</td>)}</tr>
                  <tr className="sub"><td>Less: Net debt</td>{steps.map((_, i) => <td key={i} className="neg">{fmtNum(-prec.netDebt, 0, locale)}</td>)}</tr>
                  <tr><td>Implied equity value</td>{steps.map((m, i) => <td key={i}>{fmtNum(m * r.metric - prec.netDebt, 0, locale)}</td>)}</tr>
                  <tr className="bold"><td>Implied price (÷ {fmtNum(a.company.sharesOut, 2, locale)} shares)</td>{steps.map((m, i) => <td key={i}>{fmtPrice((m * r.metric - prec.netDebt) / a.company.sharesOut, s)}</td>)}</tr>
                </React.Fragment>
              );
            })}
            {a.company.currentPrice > 0 && (
              <React.Fragment>
                <tr className="sechead"><td colSpan={4}>Premia analysis × current price ({fmtPrice(a.company.currentPrice, s)})</td></tr>
                <tr className="sub"><td>1-day premium</td><td>{fmtPct(prec.premia.q1, 0)}</td><td>{fmtPct(prec.premia.median, 0)}</td><td>{fmtPct(prec.premia.q3, 0)}</td></tr>
                <tr className="bold"><td>Implied offer price</td><td>{fmtPrice(prec.premia.impliedLow, s)}</td><td>{fmtPrice(prec.premia.impliedMedian, s)}</td><td>{fmtPrice(prec.premia.impliedHigh, s)}</td></tr>
              </React.Fragment>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="blocktitle">Implied takeover value</h3>
      <div className="chartbox">
        <FootballField
          items={[
            { label: 'EV / LTM Sales', low: prec.rows[0].impliedLow, mid: prec.rows[0].impliedMedian, high: prec.rows[0].impliedHigh, color: '#A78BFA' },
            { label: 'EV / LTM EBITDA', low: evRow.impliedLow, mid: evRow.impliedMedian, high: evRow.impliedHigh, color: '#A78BFA' },
            ...(a.company.currentPrice > 0
              ? [{ label: 'Premia analysis', low: prec.premia.impliedLow, mid: prec.premia.impliedMedian, high: prec.premia.impliedHigh, color: '#F472B6' }]
              : []),
          ]}
          currentPrice={a.company.currentPrice}
          fmt={(v) => fmtNum(v, 0, locale)}
        />
      </div>

      <div className="footer-note">
        Every transaction is a full input page: the target's reported financials with the LTM stub bridge and
        non-recurring adjustments — the same page the comparable companies use — priced at the offer rather than at
        the market, so the transaction multiples and the trading multiples are built the same way. Deal multiples
        embed the control premium, so they apply to LTM metrics where trading comps apply to NTM. The premia analysis
        applies the observed premiums straight to today's share price.
      </div>
    </div>
  );
}
