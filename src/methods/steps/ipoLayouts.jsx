import React from 'react';
import { toEngineInput } from '../../store/methodModel.js';
import { computeIpo } from '../../lib/engine/ipo.js';
import { CURRENCIES, UNITS, fmtNum } from '../../lib/format.js';
import { NumBox } from '../../wizard/Field.jsx';
import CalcMap from '../../components/CalcMap.jsx';
import { CountUp } from '../../lib/motion.jsx';

/*
 * The IPO input pages exactly as the approved samples: Financing rates (a
 * short form with hover explanations), Pricing basis (option B: both bases
 * side by side) and Offer structure (option B: the shares as a flow map).
 */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ipoOf = (company, data) => { try { return computeIpo(toEngineInput(company, data)); } catch { return null; } };

export function IpoLiveCard({ company, data }) {
  const r = ipoOf(company, data);
  const L = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const unit = UNITS[company.unit] || '';
  const px = (v) => (fin(v) ? `${sym}${fmtNum(v, 2, L)}` : '—');
  const m = (v) => (fin(v) ? `${sym}${fmtNum(v, 0, L)} ${unit}` : '—');
  return (
    <div className="live2">
      <div className="live2-l">Offer price, live</div>
      <div className="live2-v"><CountUp>{px(r?.offerPrice)}</CountUp></div>
      <div className="live2-g up">{r && fin(r.rangeLow) && fin(r.offerPrice) ? `price band ${px(r.rangeLow)} – ${px(r.offerPrice)}` : 'finish the steps to see the price'}</div>
      <div className="live2-kv"><span>Fair value a share</span><b>{px(r?.fairPricePre)}</b></div>
      <div className="live2-kv"><span>Market cap at offer</span><b>{m(r?.mktCapAtOffer)}</b></div>
      <div className="live2-kv"><span>Issue size</span><b>{r ? m(r.grossPrimary + r.grossSecondary) : '—'}</b></div>
    </div>
  );
}

export function IpoFinancingLayout({ data, company, F, rest }) {
  const r = ipoOf(company, data);
  const L = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const used = ['ts.interestRateDebt', 'ts.interestRateCash', 'ts.debtRepayPct', 'ts.dividendPayout'];
  return (
    <div className="gLb">
      <div className="box2">
        <h3>Financing rates</h3>
        <div className="box2-s">four rates take the forecast down to net income — the earnings the P/E prices · hover the i for what each does</div>
        <div className="g2f rates">{used.map((p) => F(p, { inline: true }))}</div>
        {rest(used)}
      </div>
      <div className="col16 stick">
        <IpoLiveCard company={company} data={data} />
        <div className="box2"><div className="lbl">Year-1 net income</div><div className="mid2">{r && fin(r.ntm.netIncome) ? `${sym}${fmtNum(r.ntm.netIncome, 0, L)} ${UNITS[company.unit] || ''}` : '—'}</div><div className="fa" style={{ fontSize: 12.5 }}>the P/E is applied to this</div></div>
      </div>
    </div>
  );
}

export function IpoPricingLayout({ data, setData, company, F }) {
  const L = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const p = data.ipo || {};
  const setIpo = (patch) => setData((d) => ({ ...d, ipo: { ...d.ipo, ...patch } }));
  const withB = (basis) => ipoOf(company, { ...data, ipo: { ...p, basis } });
  const rP = withB('pe'), rE = withB('evEbitda');
  const px = (v) => (fin(v) ? `${sym}${fmtNum(v, 2, L)}` : '—');
  const m = (v) => (fin(v) ? `${sym}${fmtNum(v, 0, L)}` : '—');
  const card = (basis, title, field, other, desc, r) => {
    const on = p.basis === basis;
    return (
      <div className={`opt2${on ? ' on' : ''}`} onClick={() => !on && setIpo({ basis })} role="radio" aria-checked={on} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && !on) setIpo({ basis }); }}>
        <div className="opt2-k"><span className="radio2" />{title}{on ? ' · in use' : ''}</div>
        <div className="opt2-r">
          <div onClick={(e) => e.stopPropagation()}>{on ? F(field.path, { label: field.label }) : other}</div>
          <div><div className="lbl">{on ? 'Offer price' : 'Would give'}</div><div className="mid2">{px(r?.offerPrice)}</div></div>
        </div>
        <p>{desc(r)}</p>
      </div>
    );
  };
  return (
    <>
      <div className="g2b">
        {card('pe', 'P / E', { path: 'ipo.offerPE', label: 'Fair-value P / E' },
          <label className="opt2-f"><span>Fair-value P / E</span><NumBox value={p.offerPE ?? null} onChange={(v) => setIpo({ offerPE: v })} suffix="x" /></label>,
          (r) => (r && fin(r.fairEquityPre) ? `${fin(p.offerPE) ? p.offerPE : '—'}x × Year-1 net income ${m(r.ntm.netIncome)} = fair equity ${m(r.fairEquityPre)} · ${px(r.fairPricePre)} a share before the discount` : 'Fair equity = P/E × Year-1 net income; take the multiple from trading comps.'), rP)}
        {card('evEbitda', 'EV / EBITDA', { path: 'ipo.offerEvEbitda', label: 'Fair-value EV / EBITDA' },
          <label className="opt2-f"><span>Fair-value EV / EBITDA</span><NumBox value={p.offerEvEbitda ?? null} onChange={(v) => setIpo({ offerEvEbitda: v })} suffix="x" /></label>,
          (r) => (r && fin(r.fairEquityPre) ? `${fin(p.offerEvEbitda) ? p.offerEvEbitda : '—'}x × Year-1 EBITDA ${m(r.ntm.ebitda)} − net debt ${m(r.netDebt)} = ${m(r.fairEquityPre)} · then the same discount` : 'Fair equity = EV/EBITDA × Year-1 EBITDA − net debt.'), rE)}
      </div>
      <div className="g2b">
        <div className="box2">
          <h3>Discount and band</h3>
          <div className="g2f">{F('ipo.ipoDiscount', { label: 'IPO discount to fair value' })}{F('ipo.rangeBand', { label: 'Bookbuild band below the offer' })}</div>
          {(() => { const r = p.basis === 'evEbitda' ? rE : rP; return r && fin(r.rangeLow) ? <div className="hint" style={{ marginTop: 12 }}>Price band {px(r.rangeLow)} – {px(r.offerPrice)} a share</div> : null; })()}
          {!p.basis && <div className="fld-e" style={{ marginTop: 8 }}>Pick a basis — click one of the two cards.</div>}
        </div>
        <IpoLiveCard company={company} data={data} />
      </div>
    </>
  );
}

export function IpoStructureLayout({ data, company, F, rest }) {
  const r = ipoOf(company, data);
  const L = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const u = UNITS[company.unit] || '';
  const sh = (v) => (fin(v) ? `${fmtNum(v, 3, L)} ${u}` : '—');
  const m = (v) => (fin(v) ? `${sym}${fmtNum(v, 0, L)}` : '—');
  const pc = (v) => (fin(v) ? `${(v * 100).toFixed(1)}%` : '—');
  const S0 = data.company?.sharesOut;
  const kept = r ? S0 - r.secondaryShares - (fin(r.gsSecondary) ? r.gsSecondary : 0) : NaN;
  const gsSec = r?.greenshoeType === 'secondary';
  const cols = [
    { title: 'Before the IPO', groups: [{ nodes: [
      { id: 'b1', label: 'Existing shares', value: sh(S0), sub: 'held by the current owners' },
      { id: 'b2', label: 'New shares issued', value: sh(r ? r.primaryShares + (fin(r.gsPrimary) ? r.gsPrimary : 0) : NaN), sub: `primary raise ${m(data.ipo?.primaryRaise)}` },
    ] }] },
    { title: 'In the offer', groups: [{ nodes: [
      { id: 'o1', label: 'Kept by existing holders', value: sh(kept) },
      { id: 'o2', label: 'Secondary sale', value: sh(r?.secondaryShares), sub: r ? `${m(r.secondaryShares * r.offerPrice)} to selling holders` : '' },
      { id: 'o3', label: `Greenshoe ${gsSec ? 'from holders' : 'new shares'}`, value: sh(r?.greenshoeShares), sub: r ? m(r.greenshoeProceeds) : '' },
      { id: 'o4', label: 'Primary to the public', value: sh(r?.primaryShares), sub: r ? m(r.primaryShares * r.offerPrice) : '' },
    ] }] },
  ];
  const edges = [['b1', 'o1', 1], ['b1', 'o2'], ...(gsSec ? [['b1', 'o3']] : [['b2', 'o3']]), ['b2', 'o4', 1], ['o1', 'after', 1], ['o2', 'after'], ['o3', 'after'], ['o4', 'after', 1]];
  return (
    <>
      <div className="box2 flowbox">
        <h3>Follow the shares</h3>
        <div className="box2-s">what existing holders keep and sell, what is newly issued, and who owns the company afterwards</div>
        <CalcMap cols={cols} edges={edges} widths="minmax(0, 1fr) minmax(0, 1fr) minmax(240px, 300px)" result={{
          id: 'after', title: `After the IPO · ${sh(r?.postShares)}`, label: 'Ownership after the IPO',
          value: pc(r?.existingPost), sub: 'existing holders', rows: [['Public (free float)', pc(r?.freeFloat)], ['Issue size', r ? m(r.grossPrimary + r.grossSecondary) : '—'], ['Market cap at offer', m(r?.mktCapAtOffer)]],
        }} />
      </div>
      <div className="box2">
        <h3>The deal</h3>
        <div className="g3f">{['ipo.primaryRaise', 'ipo.secondaryPct', 'ipo.greenshoePct', 'ipo.greenshoeExercisedPct', 'ipo.feesPct', 'ipo.useProceedsDebtPct'].map((p) => F(p))}</div>
        {F('ipo.greenshoeType', { row: true, label: 'Greenshoe shares are', sub: 'new shares from the company, or sold by existing holders' })}
        {rest(['ipo.primaryRaise', 'ipo.secondaryPct', 'ipo.greenshoePct', 'ipo.greenshoeExercisedPct', 'ipo.feesPct', 'ipo.useProceedsDebtPct', 'ipo.greenshoeType'])}
      </div>
    </>
  );
}
