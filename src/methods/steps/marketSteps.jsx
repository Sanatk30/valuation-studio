import React, { useMemo, useState } from 'react';
import CompanyPageEditor from '../../components/CompanyPageEditor.jsx';
import DealPageEditor from '../../components/DealPageEditor.jsx';
import PasteDialog from '../../components/PasteDialog.jsx';
import { PeerSearchAdd, PeerRowFetch, PeerBatchAdd, mergePeerRow } from '../../components/PeerYahoo.jsx';
import { blankCompany, computeCompany, nextId } from '../../lib/engine/compsCo.js';
import { blankDeal, computeDeal } from '../../lib/engine/precedentDeal.js';
import { runRegression, allVars } from '../../lib/engine/regressionModel.js';
import { compsPeerRows } from '../../lib/engine/comps.js';
import { toEngineInput } from '../../store/methodModel.js';
import { NumBox } from '../../wizard/Field.jsx';
import { fmtX, fmtPct, fmtNum, CURRENCIES } from '../../lib/format.js';

export const MIN_PEERS = 3;
export const MIN_DEALS = 3;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ltm = (m) => (m && Array.isArray(m.values) ? m.values[0] : NaN);

/** A peer is usable when its EV computes and at least one LTM multiple does. */
export function peerStatus(co) {
  let page;
  try { page = computeCompany(co); } catch { return { ok: false, page: null, why: 'Page incomplete' }; }
  const mult = page.multiples || {};
  const any = ['evSales', 'evEbitda', 'evEbit', 'pe'].some((k) => fin(ltm(mult[k])));
  if (!String(co.name || '').trim()) return { ok: false, page, why: 'Needs a name' };
  if (!fin(page.enterpriseValue)) return { ok: false, page, why: 'Needs price, shares, debt and cash' };
  if (!any) return { ok: false, page, why: 'Needs LTM sales / EBITDA / EBIT / net income' };
  return { ok: true, page };
}

/* ============================== Peer set ============================== */

function PeerSet({ data, setData, company }) {
  const comps = data.comps;
  const peers = comps.peers || [];
  const tiers = comps.tiers || [];
  const [open, setOpen] = useState(null);
  const [pasting, setPasting] = useState(false);

  const setComps = (fn) => setData((d) => ({ ...d, comps: fn(d.comps) }));
  const setPeers = (fn) => setComps((c) => ({ ...c, peers: fn(c.peers || []) }));
  const firstTier = tiers[0]?.id ?? null;

  const addTier = () => setComps((c) => ({ ...c, tiers: [...(c.tiers || []), { id: nextId('t'), name: `Tier ${(c.tiers?.length || 0) + 1}` }] }));
  const renameTier = (id, name) => setComps((c) => ({ ...c, tiers: c.tiers.map((t) => (t.id === id ? { ...t, name } : t)) }));
  const delTier = (id) => setComps((c) => ({
    ...c,
    tiers: c.tiers.filter((t) => t.id !== id),
    peers: c.peers.map((p) => (p.tierId === id ? { ...p, tierId: null } : p)),
  }));

  const statuses = peers.map(peerStatus);
  const usable = statuses.filter((s) => s.ok).length;

  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Add peers</div>
        <div className="fld-h" style={{ marginBottom: 8 }}>
          Listed peers fill their reported LTM lines from Yahoo, converted into {company.currency} {company.unit}. Anything the feed
          does not report stays blank (NA) until you type it on the peer’s page. Blank adjustment lines (non-recurring items,
          NCI, preferred, options, converts, stubs) count as none.
        </div>
        <PeerSearchAdd company={company} onAdd={(m) => setPeers((ps) => [...ps, { ...mergePeerRow(blankCompany(), m, company), tierId: firstTier }])} />
        <PeerBatchAdd
          company={company}
          existingNames={peers.flatMap((p) => [p.name, p.symbol]).filter(Boolean)}
          onAddMany={(rows) => setPeers((ps) => [...ps, ...rows.map((r) => ({ ...r, tierId: firstTier }))])}
        />
        <div className="row-btns">
          <button className="btn sm" onClick={() => setPeers((ps) => [...ps, { ...blankCompany(), tierId: firstTier }])}>+ Blank peer (private / type it in)</button>
          <button className="btn sm" onClick={() => setPasting(true)}>Paste a peer table from Excel</button>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Tiers <span className="fld-opt">optional</span></div>
        <div className="tier-list">
          {tiers.map((t) => (
            <div className="tier-row" key={t.id}>
              <input className="fld-in txt" value={t.name} onChange={(e) => renameTier(t.id, e.target.value)} />
              <span className="tier-n">{peers.filter((p) => p.tierId === t.id).length} peers</span>
              <button className="peer-del" title="Remove tier (its peers become unassigned)" onClick={() => delTier(t.id)}>×</button>
            </div>
          ))}
          <button className="btn sm" onClick={addTier}>+ Add tier</button>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-h">
          Peer set · {usable} usable of {peers.length}
          <span className={`pill ${usable >= MIN_PEERS ? 'ok' : 'warn'}`}>{usable >= MIN_PEERS ? 'enough' : `need ${MIN_PEERS - usable} more`}</span>
        </div>
        {peers.length === 0 && <div className="fld-h">No peers yet.</div>}
        {peers.map((p, i) => {
          const st = statuses[i];
          const m = st.page?.multiples || {};
          return (
            <div key={p.id} className={`peer-item${open === p.id ? ' open' : ''}`}>
              <div className="peer-line">
                <button className="peer-toggle" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? '▾' : '▸'}</button>
                <input className="fld-in txt peer-name" value={p.name || ''} placeholder="Peer name" onChange={(e) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
                <select className="fld-in" value={p.tierId ?? ''} onChange={(e) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, tierId: e.target.value || null } : x)))}>
                  <option value="">no tier</option>
                  {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="peer-mults">
                  EV/EBITDA {fin(ltm(m.evEbitda)) ? fmtX(ltm(m.evEbitda), 1) : 'NA'} · P/E {fin(ltm(m.pe)) ? fmtX(ltm(m.pe), 1) : 'NA'}
                </span>
                <span className={`pill ${st.ok ? 'ok' : 'warn'}`} title={st.why}>{st.ok ? 'usable' : st.why}</span>
                {(p.symbol || p.ticker) && (
                  <PeerRowFetch
                    name={p.symbol || p.ticker} company={company}
                    onFilled={(fm) => setPeers((ps) => ps.map((x) => (x.id === p.id ? mergePeerRow(x, fm, company) : x)))}
                  />
                )}
                <button className="peer-del" onClick={() => setPeers((ps) => ps.filter((x) => x.id !== p.id))} title="Remove peer">×</button>
              </div>
              {open === p.id && (
                <div className="peer-page">
                  <CompanyPageEditor
                    co={p} settings={company} tiers={tiers}
                    onChange={(co) => setPeers((ps) => ps.map((x) => (x.id === p.id ? co : x)))}
                    onDelete={() => setPeers((ps) => ps.filter((x) => x.id !== p.id))}
                  />
                </div>
              )}
            </div>
          );
        })}
        {peers.length > 0 && <div className="fld-h">Open a peer (▸) to see and edit its full input page. Numbers in {company.currency} {company.unit}; share counts in {company.unit}; prices in {company.currency}.</div>}
      </div>

      {pasting && (
        <PasteDialog
          mode="wide" tiers={tiers}
          onApply={(rows) => setPeers((ps) => [...ps, ...rows])}
          onClose={() => setPasting(false)}
        />
      )}
    </div>
  );
}

export const peersStep = () => ({
  id: 'peers',
  title: 'Peer set',
  blurb: `Comparable listed companies — at least ${MIN_PEERS} usable peers, each with its own reported LTM figures.`,
  Extra: PeerSet,
  fields: () => [],
  validate: (data) => {
    const usable = (data.comps?.peers || []).map(peerStatus).filter((s) => s.ok).length;
    return usable >= MIN_PEERS ? [] : [`${usable} usable peer${usable === 1 ? '' : 's'} — at least ${MIN_PEERS} are needed.`];
  },
});

/* ============================= Regression ============================= */

const TRANSFORMS = [{ v: 'lin', label: 'x' }, { v: 'ln', label: 'ln x' }];
const DEGREES = [1, 2, 3];

function RegressionSetup({ data, setData, company }) {
  const a = useMemo(() => toEngineInput(company, data), [company, data]);
  const spec = data.regression;
  const vars = allVars(a);
  const yVar = spec.yVar;
  const activeX = spec.xVars || [];
  const xOf = (key) => activeX.find((x) => x.key === key);
  const setSpec = (patch) => setData((d) => ({ ...d, regression: { ...d.regression, ...patch } }));
  const [newVar, setNewVar] = useState('');
  const R = useMemo(() => {
    if (!yVar || !activeX.length) return null;
    try { return runRegression(a); } catch { return null; }
  }, [a, yVar, activeX.length]);
  const peers = useMemo(() => { try { return compsPeerRows(a); } catch { return []; } }, [a]);
  const locale = CURRENCIES[company.currency]?.locale;
  const customs = spec.customVars || [];

  const addCustomVar = () => {
    const label = newVar.trim();
    if (!label) return;
    const key = 'c_' + label.replace(/\W+/g, '_').toLowerCase();
    if (vars.some((v) => v.key === key)) return;
    setSpec({ customVars: [...customs, { key, label, fmt: 'num' }] });
    setNewVar('');
  };
  const delCustomVar = (key) => setSpec({
    customVars: customs.filter((v) => v.key !== key),
    xVars: activeX.filter((x) => x.key !== key),
    ...(yVar === key ? { yVar: null } : {}),
  });
  const setPeerVar = (id, key, v) => setData((d) => ({ ...d, comps: { ...d.comps, peers: d.comps.peers.map((p) => (p.id === id ? { ...p, [key]: v } : p)) } }));
  const fmtV = (fmt) => (v) => (!fin(v) ? 'NA' : fmt === 'x' ? fmtX(v, 2) : fmt === 'pct' ? fmtPct(v, 1) : fmtNum(v, Math.abs(v) >= 100 ? 0 : 2, locale));
  const fit = R?.fit;

  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Model</div>
        <div className="reg-spec">
          <div className="reg-y">
            <label>Dependent (y)</label>
            <select className="fld-in" value={yVar || ''} onChange={(e) => setSpec({ yVar: e.target.value || null, xVars: activeX.filter((x) => x.key !== e.target.value) })}>
              <option value="">choose…</option>
              {vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
            <label className="reg-ck"><input type="checkbox" checked={!!spec.yLog} onChange={(e) => setSpec({ yLog: e.target.checked })} /> fit ln(y)</label>
          </div>
          <div className="reg-x">
            <label>Regressors (x)</label>
            <div className="reg-chips">
              {vars.filter((v) => v.key !== yVar).map((v) => {
                const on = xOf(v.key);
                return (
                  <div key={v.key} className={`reg-chip${on ? ' on' : ''}`}>
                    <button className="reg-chip-main" onClick={() => setSpec({ xVars: on ? activeX.filter((x) => x.key !== v.key) : [...activeX, { key: v.key, transform: 'lin', degree: 1 }] })}>{on ? '✓ ' : '+ '}{v.label}</button>
                    {on && (
                      <>
                        <select value={on.transform || 'lin'} onChange={(e) => setSpec({ xVars: activeX.map((x) => (x.key === v.key ? { ...x, transform: e.target.value } : x)) })}>
                          {TRANSFORMS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                        </select>
                        <select value={on.degree || 1} onChange={(e) => setSpec({ xVars: activeX.map((x) => (x.key === v.key ? { ...x, degree: +e.target.value } : x)) })}>
                          {DEGREES.map((d) => <option key={d} value={d}>{d === 1 ? 'x¹' : d === 2 ? '+x²' : '+x³'}</option>)}
                        </select>
                      </>
                    )}
                    {v.custom && <button className="peer-del" title="Delete this variable" onClick={() => delCustomVar(v.key)}>×</button>}
                  </div>
                );
              })}
              <div className="reg-newvar">
                <input className="fld-in txt" placeholder="Add your own variable…" value={newVar} onChange={(e) => setNewVar(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustomVar(); }} />
                <button className="btn sm" onClick={addCustomVar} disabled={!newVar.trim()}>+ Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Data</div>
        <div className="fld-h" style={{ marginBottom: 8 }}>
          Built-in variables are computed from each peer’s page and the target’s LTM inputs (read-only). Your own variables are typed
          here. A target cell can be overridden; clear it to go back to the computed value.
        </div>
        <div className="tablewrap">
          <table className="fin compact reg-data">
            <thead>
              <tr><th>Company</th>{vars.map((v) => <th key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>{v.label}{v.key === yVar ? ' (y)' : xOf(v.key) ? ' (x)' : ''}</th>)}</tr>
            </thead>
            <tbody>
              {peers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name || 'unnamed'}</td>
                  {vars.map((v) => (
                    <td key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>
                      {v.custom
                        ? <NumBox small value={fin(p[v.key]) ? p[v.key] : null} onChange={(val) => setPeerVar(p.id, v.key, val)} />
                        : fmtV(v.fmt)(p[v.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="reg-target">
                <td><b>{company.name} (target)</b></td>
                {vars.map((v) => {
                  const ov = spec.targetOverrides?.[v.key];
                  const derived = R?.target?.[v.key];
                  return (
                    <td key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>
                      <NumBox
                        small value={fin(ov) ? ov : null}
                        placeholder={fin(derived) ? String(+Number(derived).toFixed(2)) : 'NA'}
                        onChange={(val) => setSpec({ targetOverrides: { ...spec.targetOverrides, [v.key]: val } })}
                      />
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {fit && (
        <div className="readout">
          {fit.ok
            ? <>Fitted over <b>{fit.n}</b> peers — R² <b>{fmtPct(fit.r2 * 100, 1)}</b>, adjusted <b>{fmtPct(fit.adjR2 * 100, 1)}</b>{R.price ? <> · predicted implied price shown on the output</> : null}</>
            : <>Not estimable yet: {fit.reason}</>}
        </div>
      )}
    </div>
  );
}

export const regressionStep = () => ({
  id: 'regression',
  title: 'Regression',
  optional: true,
  blurb: 'Explain a peer multiple with fundamentals (growth, margin, leverage, size…) and predict the target’s multiple.',
  Extra: RegressionSetup,
  fields: () => [],
  validate: (data, { company }) => {
    const spec = data.regression || {};
    if (!spec.yVar) return ['Choose the dependent variable (y).'];
    if (!spec.xVars?.length) return ['Choose at least one regressor (x).'];
    let R;
    try { R = runRegression(toEngineInput(company, data)); } catch (e) { return [`Regression failed: ${e.message}`]; }
    if (!R?.fit?.ok) return [`Model not estimable: ${R?.fit?.reason || 'check the data'}`];
    if (R.pred && !R.pred.ok) return ['The target is missing a value for one of the regressors — enter it in the target row.'];
    return [];
  },
});

/* ============================== Deal set ============================== */

export function dealStatus(d) {
  let page;
  try { page = computeDeal(d); } catch { return { ok: false, why: 'Page incomplete' }; }
  if (!fin(page.enterpriseValue)) return { ok: false, page, why: 'Needs offer terms, shares, debt and cash' };
  if (!fin(page.evEbitda) && !fin(page.evSales)) return { ok: false, page, why: 'Needs target LTM sales / EBITDA' };
  return { ok: true, page };
}

function DealSet({ data, setData, company }) {
  const deals = data.precedent.deals || [];
  const [open, setOpen] = useState(null);
  const setDeals = (fn) => setData((d) => ({ ...d, precedent: { ...d.precedent, deals: fn(d.precedent.deals || []) } }));
  const statuses = deals.map(dealStatus);
  const usable = statuses.filter((s) => s.ok).length;

  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">
          Transactions · {usable} usable of {deals.length}
          <span className={`pill ${usable >= MIN_DEALS ? 'ok' : 'warn'}`}>{usable >= MIN_DEALS ? 'enough' : `need ${MIN_DEALS - usable} more`}</span>
        </div>
        <div className="fld-h" style={{ marginBottom: 8 }}>
          Each deal is the target’s reported financials priced at the offer, plus the offer terms and the unaffected prices for premiums.
          Amounts in {company.currency} {company.unit}; prices in {company.currency}. Blank adjustment lines count as none.
        </div>
        {deals.map((d, i) => {
          const st = statuses[i];
          const label = [d.acquirer, d.target?.name].filter((s) => String(s || '').trim()).join(' / ') || `Deal ${i + 1}`;
          return (
            <div key={d.id} className={`peer-item${open === d.id ? ' open' : ''}`}>
              <div className="peer-line">
                <button className="peer-toggle" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? '▾' : '▸'}</button>
                <span className="peer-name-static">{label}</span>
                <span className="peer-mults">EV/EBITDA {fin(st.page?.evEbitda) ? fmtX(st.page.evEbitda, 1) : 'NA'}</span>
                <span className={`pill ${st.ok ? 'ok' : 'warn'}`} title={st.why}>{st.ok ? 'usable' : st.why}</span>
                <button className="peer-del" onClick={() => setDeals((ds) => ds.filter((x) => x.id !== d.id))} title="Remove deal">×</button>
              </div>
              {open === d.id && (
                <div className="peer-page">
                  <DealPageEditor
                    deal={d} settings={company}
                    onChange={(nd) => setDeals((ds) => ds.map((x) => (x.id === d.id ? nd : x)))}
                    onDelete={() => setDeals((ds) => ds.filter((x) => x.id !== d.id))}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div className="row-btns">
          <button className="btn sm" onClick={() => { const nd = blankDeal(); setDeals((ds) => [...ds, nd]); setOpen(nd.id); }}>+ Add transaction</button>
        </div>
      </div>
    </div>
  );
}

export const dealsStep = () => ({
  id: 'deals',
  title: 'Transaction set',
  blurb: `Past acquisitions of comparable businesses — at least ${MIN_DEALS} usable deals.`,
  Extra: DealSet,
  fields: () => [],
  validate: (data) => {
    const usable = (data.precedent?.deals || []).map(dealStatus).filter((s) => s.ok).length;
    return usable >= MIN_DEALS ? [] : [`${usable} usable deal${usable === 1 ? '' : 's'} — at least ${MIN_DEALS} are needed.`];
  },
});
