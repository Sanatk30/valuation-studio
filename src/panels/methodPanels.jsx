import React, { useMemo } from 'react';
import NumberInput from '../components/NumberInput.jsx';
import Section from '../components/Section.jsx';
import { PeerSearchAdd, PeerRowFetch, PeerBatchAdd, mergePeerRow } from '../components/PeerYahoo.jsx';
import { blankCompany, nextId, computeCompany } from '../lib/engine/compsCo.js';
import PasteDialog from '../components/PasteDialog.jsx';
import { fetchPeersBatch } from '../lib/yahoo.js';
import { applyScenario } from '../lib/engine/scenario.js';
import { computeComps } from '../lib/engine/comps.js';
import { computeRegression } from '../lib/engine/regression.js';
import { computePrecedent } from '../lib/engine/precedent.js';
import { fmtMoney, fmtPrice, fmtPct, CURRENCIES, UNITS } from '../lib/format.js';
import { convertAssumptionsCurrency } from '../lib/currency.js';

/* ------------------------------------------------------------------ */
/* Method-specific assumption panels, shown in the dock per view.      */
/* ------------------------------------------------------------------ */

export function TerminalValuePanel({ a, set }) {
  const primary = a.dcf.primaryTV;
  return (
    <Section title="Terminal Value">
      <NumberInput label="Terminal growth rate" value={a.dcf.terminalGrowth} onChange={(v) => set('dcf.terminalGrowth', v)} min={0} max={8} step={0.1} suffix="%" hint="Must stay below WACC and CoE" />
      <NumberInput label="Exit EV/EBITDA (FCFF)" value={a.dcf.exitMultiple} onChange={(v) => set('dcf.exitMultiple', v)} min={3} max={30} step={0.5} suffix="x" />
      <NumberInput label="Exit P/E (FCFE)" value={a.dcf.exitPE} onChange={(v) => set('dcf.exitPE', v)} min={5} max={50} step={0.5} suffix="x" />
      <label className="toggle">
        <input type="checkbox" checked={a.dcf.midYear} onChange={(e) => set('dcf.midYear', e.target.checked)} />
        Mid-year discounting convention
      </label>
      <div className="seg">
        <button className={primary === 'gordon' ? 'on' : ''} onClick={() => set('dcf.primaryTV', 'gordon')}>Gordon primary</button>
        <button className={primary === 'exit' ? 'on' : ''} onClick={() => set('dcf.primaryTV', 'exit')}>Exit multiple primary</button>
      </div>
    </Section>
  );
}

export function FinancingPolicyPanel({ a, set, full = true }) {
  return (
    <Section title="Financing & Policy" note="Interest accrues on opening balances — no circular refs, the Excel export stays clean. Shared by the 3-statement, FCFE and ratio models.">
      <NumberInput label="Interest rate on debt" value={a.ts.interestRateDebt} onChange={(v) => set('ts.interestRateDebt', v)} min={0} max={20} step={0.1} suffix="%" />
      {full && <NumberInput label="Interest earned on cash" value={a.ts.interestRateCash} onChange={(v) => set('ts.interestRateCash', v)} min={0} max={12} step={0.1} suffix="%" />}
      <NumberInput label="Mandatory debt repayment" value={a.ts.debtRepayPct} onChange={(v) => set('ts.debtRepayPct', v)} min={0} max={50} step={1} suffix="%" hint="% of opening debt repaid each year" />
      {full && (
        <>
          <NumberInput label="Dividend payout" value={a.ts.dividendPayout} onChange={(v) => set('ts.dividendPayout', v)} min={0} max={100} step={1} suffix="%" hint="% of net income" />
          <NumberInput label="Opening net PP&E" value={a.ts.startingPPE} onChange={(v) => set('ts.startingPPE', v)} slider={false} step={100} />
        </>
      )}
    </Section>
  );
}

export function LboTransactionPanel({ a, set }) {
  const l = a.lbo;
  return (
    <Section title="LBO — Transaction">
      <NumberInput label="Entry EV / EBITDA" value={l.entryMultiple} onChange={(v) => set('lbo.entryMultiple', v)} min={4} max={25} step={0.25} suffix="x" />
      <NumberInput label="Exit EV / EBITDA" value={l.exitMultiple} onChange={(v) => set('lbo.exitMultiple', v)} min={4} max={25} step={0.25} suffix="x" />
      <NumberInput label="Exit year" value={l.exitYear} onChange={(v) => set('lbo.exitYear', Math.round(v))} min={1} max={a.drivers.years} step={1} hint={`Capped at the ${a.drivers.years}-year projection`} />
      <NumberInput label="Transaction fees (% of EV)" value={l.feesPctEV} onChange={(v) => set('lbo.feesPctEV', v)} min={0} max={6} step={0.25} suffix="%" />
      <NumberInput label="Financing fees (% of debt)" value={l.finFeesPct} onChange={(v) => set('lbo.finFeesPct', v)} min={0} max={6} step={0.25} suffix="%" hint="Capitalized; amortized straight-line over the hold (tax-deductible, non-cash)" />
      <NumberInput label="IRR hurdle (floor pricing)" value={l.hurdleRate} onChange={(v) => set('lbo.hurdleRate', v)} min={8} max={35} step={0.5} suffix="%" hint="Drives the max-affordable-price (LBO floor) output" />
    </Section>
  );
}

export function LboDebtPanel({ a, set }) {
  const l = a.lbo;
  return (
    <Section title="LBO — Debt Financing">
      <NumberInput label="Senior debt (x LTM EBITDA)" value={l.seniorX} onChange={(v) => set('lbo.seniorX', v)} min={0} max={7} step={0.25} suffix="x" />
      <NumberInput label="Senior interest rate" value={l.seniorRate} onChange={(v) => set('lbo.seniorRate', v)} min={3} max={18} step={0.25} suffix="%" />
      <NumberInput label="Senior amortization p.a." value={l.seniorAmort} onChange={(v) => set('lbo.seniorAmort', v)} min={0} max={25} step={0.5} suffix="%" hint="% of the original facility, mandatory" />
      <NumberInput label="Mezzanine debt (x LTM EBITDA)" value={l.mezzX} onChange={(v) => set('lbo.mezzX', v)} min={0} max={4} step={0.25} suffix="x" />
      <NumberInput label="Mezzanine interest rate" value={l.mezzRate} onChange={(v) => set('lbo.mezzRate', v)} min={6} max={22} step={0.25} suffix="%" />
      <label className="toggle">
        <input type="checkbox" checked={l.mezzPIK} onChange={(e) => set('lbo.mezzPIK', e.target.checked)} />
        Mezzanine is PIK (interest accrues, no cash pay)
      </label>
      <NumberInput label="Cash sweep" value={l.sweepPct} onChange={(v) => set('lbo.sweepPct', v)} min={0} max={100} step={5} suffix="%" hint="% of post-amortization FCF; senior first, then cash-pay mezz" />
      <NumberInput label="Minimum operating cash" value={l.minCash} onChange={(v) => set('lbo.minCash', v)} slider={false} step={25} hint="Cash floor — the sweep never drains below this" />
    </Section>
  );
}

export function PeerSetPanel({ a, set }) {
  const peers = a.comps.peers || [];
  const tiers = a.comps.tiers || [];
  const [refreshing, setRefreshing] = React.useState(false);
  const [pasting, setPasting] = React.useState(false);

  const setPeer = (id, patch) => set('comps.peers', (rows) => rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const delPeer = (id) => set('comps.peers', (rows) => rows.filter((p) => p.id !== id));
  const addPeer = () => set('comps.peers', (rows) => [...rows, blankCompany({ name: `Peer ${rows.length + 1}`, tierId: tiers[0]?.id ?? null })]);

  const addTier = () => set('comps.tiers', (ts) => [...(ts || []), { id: nextId('t'), name: `Tier ${(ts?.length || 0) + 1}` }]);
  const renameTier = (id, name) => set('comps.tiers', (ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));
  const delTier = (id) => {
    set('comps.tiers', (ts) => ts.filter((t) => t.id !== id));
    set('comps.peers', (rows) => rows.map((p) => (p.tierId === id ? { ...p, tierId: null } : p)));
  };

  // re-pull every row that has a name; merge keeps prior values where Yahoo has nothing
  const refreshAll = async () => {
    if (refreshing) return;
    const named = peers.map((p, i) => ({ i, q: p.symbol || p.ticker || p.name })).filter((x) => x.q && x.q.trim());
    if (!named.length) return;
    setRefreshing(true);
    try {
      const results = await fetchPeersBatch(named.map((x) => x.q));
      const byIndex = Object.fromEntries(results.map((r, k) => [named[k].i, r]));
      set('comps.peers', (rows) => rows.map((r, i) => (byIndex[i]?.ok ? mergePeerRow(r, byIndex[i].m, a.settings) : r)));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Section
      title="Peer Set"
      note="Every peer is a full input page of reported financials — open the Comps tab → Input pages to fill one in. ⟳ pulls what Yahoo reports (revenue, EBITDA, D&A, capex, debt, cash, equity, shares); the COGS/SG&A split, the rest of the balance sheet and CFO stay yours to enter."
    >
      <div className="tier-block">
        <div className="tier-h">Tiers</div>
        {tiers.map((t) => (
          <div className="tier-row" key={t.id}>
            <input className="pname" value={t.name} onChange={(e) => renameTier(t.id, e.target.value)} />
            <span className="tier-n">{peers.filter((p) => p.tierId === t.id).length}</span>
            <button className="peer-del" title="Remove tier (its peers become unassigned)" onClick={() => delTier(t.id)}>×</button>
          </div>
        ))}
        <button className="btn sm" onClick={addTier}>+ Add tier</button>
      </div>

      {pasting && (
        <PasteDialog
          mode="wide" tiers={tiers}
          onApply={(rows) => set('comps.peers', (prev) => [...prev, ...rows])}
          onClose={() => setPasting(false)}
        />
      )}

      <PeerBatchAdd
        companyName={a.company.name}
        existingNames={peers.flatMap((p) => [p.name, p.symbol]).filter(Boolean)}
        settings={a.settings}
        onAddMany={(rows) => set('comps.peers', (prev) => [...prev, ...rows.map((r) => ({ ...r, tierId: tiers[0]?.id ?? null }))])}
      />
      <table className="peers">
        <thead>
          <tr><th>Name</th><th>Tier</th><th>EV/EBITDA</th><th colSpan={2} /></tr>
        </thead>
        <tbody>
          {peers.map((p) => {
            const pg = computeCompany(p);
            return (
              <tr key={p.id}>
                <td><input className="pname" value={p.name} onChange={(e) => setPeer(p.id, { name: e.target.value })} /></td>
                <td>
                  <select className="pname" value={p.tierId ?? ''} onChange={(e) => setPeer(p.id, { tierId: e.target.value || null })}>
                    <option value="">—</option>
                    {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="calc">{isFinite(pg.multiples.evEbitda.values[0]) ? `${pg.multiples.evEbitda.values[0].toFixed(1)}x` : 'NA'}</td>
                <td><PeerRowFetch name={p.symbol || p.ticker || p.name} onFilled={(m) => set('comps.peers', (rows) => rows.map((r) => (r.id === p.id ? mergePeerRow(r, m, a.settings) : r)))} /></td>
                <td><button className="peer-del" onClick={() => delPeer(p.id)} title="Remove peer">×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <PeerSearchAdd settings={a.settings} onAdd={(m) => set('comps.peers', (rows) => [...rows, { ...mergePeerRow(blankCompany({ name: '' }), m, a.settings), tierId: tiers[0]?.id ?? null }])} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn" style={{ flex: 1 }} onClick={addPeer}>+ Add blank peer</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => setPasting(true)} title="Paste a table of comparables — one row per company">Paste table</button>
        <button
          className="btn" style={{ flex: 1 }} onClick={refreshAll} disabled={refreshing}
          title="Re-fetch every row from Yahoo at today's prices (rows keep their values where Yahoo has nothing)"
        >
          {refreshing ? 'Refreshing…' : '⟳ Refresh all'}
        </button>
      </div>
    </Section>
  );
}

export function CompsTargetPanel({ a }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const comps = useMemo(() => computeComps(am), [am]);
  const reg = useMemo(() => computeRegression(am), [am]);
  const s = a.settings;
  return (
    <Section title="Target Metrics (auto)" note="NTM = Year 1 of the shared projection; net income from the 3-statement model.">
      <div className="sec-note">
        NTM Revenue <b>{fmtMoney(comps.target.revenue, s)}</b>
        <br />NTM EBITDA <b>{fmtMoney(comps.target.ebitda, s)}</b>
        <br />NTM Net income <b>{fmtMoney(comps.target.netIncome, s)}</b>
        <br />NTM growth (regression x) <b>{reg.ok ? fmtPct(reg.targetGrowth, 1) : '—'}</b>
        <br />Net debt <b>{fmtMoney(comps.netDebt, s)}</b>
      </div>
    </Section>
  );
}

export function DealSetPanel({ a, set }) {
  const deals = a.precedent.deals;
  const setDeal = (i, key, value) => set('precedent.deals', deals.map((d, j) => (j === i ? { ...d, [key]: value } : d)));
  const addDeal = () => set('precedent.deals', [...deals, { name: `Deal ${deals.length + 1}`, year: 2025, evSales: 3.5, evEbitda: 15.0, premium: 25 }]);
  const delDeal = (i) => set('precedent.deals', deals.filter((_, j) => j !== i));
  return (
    <Section title="Transaction Set" note="Announced/closed M&A deals in the sector. Deal multiples embed the control premium and apply to LTM metrics by convention.">
      <table className="peers">
        <thead>
          <tr><th>Deal</th><th>Yr</th><th>EV/S</th><th>EV/EBITDA</th><th>Prem%</th><th /></tr>
        </thead>
        <tbody>
          {deals.map((d, i) => (
            <tr key={i}>
              <td><input className="pname" value={d.name} onChange={(e) => setDeal(i, 'name', e.target.value)} /></td>
              <td><input type="number" step="1" value={d.year} onChange={(e) => setDeal(i, 'year', parseInt(e.target.value) || 0)} style={{ width: 56 }} /></td>
              <td><input type="number" step="0.1" value={d.evSales} onChange={(e) => setDeal(i, 'evSales', parseFloat(e.target.value) || 0)} /></td>
              <td><input type="number" step="0.5" value={d.evEbitda} onChange={(e) => setDeal(i, 'evEbitda', parseFloat(e.target.value) || 0)} /></td>
              <td><input type="number" step="1" value={d.premium} onChange={(e) => setDeal(i, 'premium', parseFloat(e.target.value) || 0)} /></td>
              <td><button className="peer-del" onClick={() => delDeal(i)} title="Remove deal">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={addDeal}>+ Add transaction</button>
    </Section>
  );
}

export function PrecTargetPanel({ a }) {
  const am = useMemo(() => applyScenario(a), [a]);
  const prec = useMemo(() => computePrecedent(am), [am]);
  const s = a.settings;
  return (
    <Section title="Target LTM Metrics (auto)" note="Precedents price the trailing year — the base-year drivers, not the projection.">
      <div className="sec-note">
        LTM Revenue <b>{fmtMoney(prec.target.revenue, s)}</b>
        <br />LTM EBITDA <b>{fmtMoney(prec.target.ebitda, s)}</b>
        <br />Net debt <b>{fmtMoney(prec.netDebt, s)}</b>
        <br />Current price <b>{a.company.currentPrice > 0 ? fmtPrice(a.company.currentPrice, s) : '— (needed for premia analysis)'}</b>
      </div>
    </Section>
  );
}

export function IpoPricingPanel({ a, set }) {
  const p = a.ipo;
  const peBasis = p.basis === 'pe';
  return (
    <Section title="IPO — Pricing" note="Fair value from the chosen multiple on NTM metrics; IPO investors get a discount that unwinds post-listing.">
      <div className="seg">
        <button className={peBasis ? 'on' : ''} onClick={() => set('ipo.basis', 'pe')}>P/E basis</button>
        <button className={!peBasis ? 'on' : ''} onClick={() => set('ipo.basis', 'evEbitda')}>EV/EBITDA basis</button>
      </div>
      {peBasis ? (
        <NumberInput label="Offer P/E (× NTM net income)" value={p.offerPE} onChange={(v) => set('ipo.offerPE', v)} min={8} max={60} step={0.5} suffix="x" />
      ) : (
        <NumberInput label="Offer EV/EBITDA (× NTM EBITDA)" value={p.offerEvEbitda} onChange={(v) => set('ipo.offerEvEbitda', v)} min={4} max={30} step={0.5} suffix="x" />
      )}
      <NumberInput label="IPO discount to fair value" value={p.ipoDiscount} onChange={(v) => set('ipo.ipoDiscount', v)} min={0} max={30} step={0.5} suffix="%" hint="Money left on the table for the bookbuild" />
      <NumberInput label="Bookbuild band below offer" value={p.rangeBand} onChange={(v) => set('ipo.rangeBand', v)} min={0} max={20} step={0.5} suffix="%" />
    </Section>
  );
}

export function IpoStructurePanel({ a, set }) {
  const p = a.ipo;
  return (
    <Section title="IPO — Deal Structure">
      <NumberInput label="Primary raise (fresh capital)" value={p.primaryRaise} onChange={(v) => set('ipo.primaryRaise', v)} slider={false} step={100} />
      <NumberInput label="Secondary sale" value={p.secondaryPct} onChange={(v) => set('ipo.secondaryPct', v)} min={0} max={50} step={1} suffix="%" hint="% of existing shares sold by current holders" />
      <NumberInput label="Greenshoe (over-allotment)" value={p.greenshoePct} onChange={(v) => set('ipo.greenshoePct', v)} min={0} max={20} step={1} suffix="%" hint="% of base deal; assumed primary & exercised" />
      <NumberInput label="Underwriting fees + expenses" value={p.feesPct} onChange={(v) => set('ipo.feesPct', v)} min={0} max={10} step={0.25} suffix="%" hint="% of gross primary proceeds" />
      <NumberInput label="Proceeds to debt repayment" value={p.useProceedsDebtPct} onChange={(v) => set('ipo.useProceedsDebtPct', v)} min={0} max={100} step={5} suffix="%" hint="Rest builds cash; both cut net debt equally" />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Shell panels — always in the dock.                                  */
/* ------------------------------------------------------------------ */

/** The highest-torque sliders across every method, one panel, always on top. */
export function KeyLeversPanel({ a, set }) {
  const d = a.drivers;
  const grid = !!d.perYear;
  return (
    <Section title="Key Levers" note="The assumptions that move price the most — drag and watch the ticker.">
      {!grid && (
        <>
          <NumberInput label="Revenue growth — Year 1" value={d.growthStart} onChange={(v) => set('drivers.growthStart', v)} min={-20} max={50} step={0.5} suffix="%" />
          <NumberInput label="EBITDA margin — Year 1" value={d.marginStart} onChange={(v) => set('drivers.marginStart', v)} min={1} max={70} step={0.5} suffix="%" />
        </>
      )}
      {grid && <div className="sec-note">Per-year grid is on — edit growth and margin in Operating Drivers below.</div>}
      <NumberInput label="Equity risk premium" value={a.wacc.erp} onChange={(v) => set('wacc.erp', v)} min={2} max={12} step={0.1} suffix="%" />
      <NumberInput label="Terminal growth" value={a.dcf.terminalGrowth} onChange={(v) => set('dcf.terminalGrowth', v)} min={0} max={8} step={0.1} suffix="%" />
      <NumberInput label="Exit EV/EBITDA (DCF)" value={a.dcf.exitMultiple} onChange={(v) => set('dcf.exitMultiple', v)} min={3} max={30} step={0.5} suffix="x" />
      <NumberInput label="LBO entry multiple" value={a.lbo.entryMultiple} onChange={(v) => set('lbo.entryMultiple', v)} min={4} max={25} step={0.25} suffix="x" />
    </Section>
  );
}

export function DisplayPanel({ a, set, setA }) {
  const s = a.settings;
  return (
    <Section title="Display & Period" defaultOpen={false} note="Currency conversion re-denominates every money figure at spot FX.">
      <div className="dock-field">
        <span>Currency</span>
        <select
          value={s.currency}
          onChange={(e) => setA((prev) => convertAssumptionsCurrency(prev, prev.settings.currency, e.target.value))}
        >
          {Object.entries(CURRENCIES).map(([k, v]) => (
            <option key={k} value={k}>{v.symbol} {k} — {v.name}</option>
          ))}
        </select>
      </div>
      <div className="dock-field">
        <span>Money unit</span>
        <select value={s.unit} onChange={(e) => set('settings.unit', e.target.value)}>
          {Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="dock-field">
        <span>Start year</span>
        <input
          type="number"
          value={s.period?.startYear ?? 2026}
          onChange={(e) => set('settings.period.startYear', parseInt(e.target.value, 10) || new Date().getFullYear())}
        />
      </div>
      <label className="toggle">
        <input type="checkbox" checked={a.settings.scenOverlay ?? true} onChange={(e) => set('settings.scenOverlay', e.target.checked)} />
        Bear/Bull ghost overlays on charts
      </label>
      <div className="dock-field">
        <span>Fiscal basis</span>
        <select value={s.period?.fyEndMonth ?? 12} onChange={(e) => set('settings.period.fyEndMonth', +e.target.value)}>
          <option value={12}>Calendar</option>
          <option value={3}>FY Apr–Mar</option>
          <option value={6}>FY Jul–Jun</option>
          <option value={9}>FY Oct–Sep</option>
        </select>
      </div>
    </Section>
  );
}
