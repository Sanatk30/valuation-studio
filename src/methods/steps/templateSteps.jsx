import React, { useMemo, useState } from 'react';
import { f } from '../fields.js';
import TemplatePageEditor from '../../components/TemplatePageEditor.jsx';
import PasteDialog from '../../components/PasteDialog.jsx';
import { PeerBatchAdd, YahooSearch, RowFetch, mergeFetch } from '../../components/PeerYahoo.jsx';
import { NumBox } from '../../wizard/Field.jsx';
import { computePage, MIN_YEARS, MAX_YEARS } from '../../lib/engine/companyPage.js';
import {
  COMPS_MULTIPLES, blankPeer, isBlankPeer, peerSlots, periodLabels, clampYears, multipleLabel, computeComps,
} from '../../lib/engine/comps.js';
import { PREC_METHODS, dealSlots, impliedEquity100, controlPremium } from '../../lib/engine/precedent.js';
import { STAT_KEYS, STAT_LABELS, statsSettings } from '../../lib/engine/templateStats.js';
import { runRegression, allVars, observations, targetValues } from '../../lib/engine/regressionModel.js';
import { toEngineInput } from '../../store/methodModel.js';
import { fmtX, fmtPct, fmtNum, fmtTpl, fmtDate, CURRENCIES } from '../../lib/format.js';

/**
 * Wizard steps for the two template methods:
 *   Comparable companies — Settings · Target · Peers · Regression (optional)
 *   Precedent transactions — Settings · Company being valued · Deal list · Deal financials
 *
 * Blank cells behave as in the templates (a blank counts as 0); the steps ask
 * for the structural choices (years, YTD columns, lease toggle, how many
 * peers / deals) and leave every financial cell to the user or a Yahoo fill.
 */

const fin = Number.isFinite;
const isNum = (v) => typeof v === 'number' && fin(v);

const leaseSpec = (path) => f.choice(path, 'Include lease liabilities in net debt / EV?', [
  { value: 1, label: 'Yes (1)' }, { value: 0, label: 'No (0)' },
], { hint: 'Template: 1 — under Ind AS 116 rent sits below EBITDA, so lease liabilities are debt-like.' });
const yearsSpec = (path) => f.int(path, 'Historical fiscal years on each page', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 3.` });
const ytdSpec = (path) => f.bool(path, 'Year-to-date columns', {
  yes: 'On — prior & current YTD', no: 'Off — LTM = latest FY',
  hint: 'With YTD columns, LTM = latest FY + current YTD − prior YTD, and the current-YTD column holds the interim balance sheet.',
});

/** Is a page slot untouched (nothing typed or fetched)? */

/* ======================== Valuation choices ======================== */

/**
 * The selectable valuation choices, shared by both methods: which multiples
 * go into the implied valuation, which statistics give the low / mid / high
 * values, the percentile method and which statistics rows the tables show.
 */
function ValuationChoices({ settings, onChange, methods }) {
  const st = statsSettings(settings?.stats || {});
  const sel = settings?.multiples || {};
  const setStats = (patch) => onChange({ ...settings, stats: { ...st, ...patch } });
  const setMult = (key, on) => onChange({ ...settings, multiples: { ...sel, [key]: on } });
  const used = methods.filter((m) => sel[m.key] !== false).length;
  return (
    <div className="tool-card">
      <div className="tool-h">Valuation choices <span className="fld-opt">template: all multiples · 25th / Median / 75th · inclusive · all six rows</span></div>
      <div className="vc-grid">
        <div>
          <div className="fld-l"><label>Multiples used in the implied valuation</label></div>
          {methods.map((m) => (
            <label key={m.key} className="vc-ck">
              <input type="checkbox" checked={sel[m.key] !== false} onChange={(e) => setMult(m.key, e.target.checked)} /> {m.label}
            </label>
          ))}
          {!used && <div className="fld-e">Tick at least one — the implied valuation needs a method.</div>}
        </div>
        <div>
          <div className="fld-l"><label>Low / mid / high values from</label></div>
          {[['low', 'Low'], ['mid', 'Mid'], ['high', 'High']].map(([k, lab]) => (
            <div key={k} className="vc-row">
              <span>{lab}</span>
              <select className="fld-in" value={st[k]} onChange={(e) => setStats({ [k]: e.target.value })}>
                {STAT_KEYS.map((s) => <option key={s} value={s}>{STAT_LABELS[s]}</option>)}
              </select>
            </div>
          ))}
          <div className="fld-l" style={{ marginTop: 10 }}><label>Percentile method</label></div>
          <div className="seg fld-seg">
            <button type="button" className={st.method === 'inc' ? 'on' : ''} onClick={() => setStats({ method: 'inc' })}>Inclusive (QUARTILE.INC)</button>
            <button type="button" className={st.method === 'exc' ? 'on' : ''} onClick={() => setStats({ method: 'exc' })}>Exclusive (QUARTILE.EXC)</button>
          </div>
          <div className="fld-h">Exclusive needs enough values: with too few it shows NM.</div>
        </div>
        <div>
          <div className="fld-l"><label>Statistics rows shown</label></div>
          {STAT_KEYS.map((s) => (
            <label key={s} className="vc-ck">
              <input type="checkbox" checked={st.show.includes(s)}
                onChange={(e) => setStats({ show: e.target.checked ? [...st.show, s] : st.show.filter((x) => x !== s) })} /> {STAT_LABELS[s]}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Period-label editor (comps: one set for every page). */
function LabelsEditor({ labels, ytd, onChange }) {
  const set = (id, v) => {
    const cur = { fy: [...labels.fy], p: labels.p, c: labels.c, ltm: labels.ltm };
    if (typeof id === 'number') cur.fy[id] = v; else cur[id] = v;
    onChange(cur);
  };
  return (
    <div className="tool-card">
      <div className="tool-h">Period labels <span className="fld-opt">labels only — change freely</span></div>
      <div className="lab-grid">
        {labels.fy.map((l, i) => (
          <label key={i}>{i === labels.fy.length - 1 ? 'Latest FY' : `Historical year ${i + 1}`}<input className="fld-in txt" value={l} onChange={(e) => set(i, e.target.value)} /></label>
        ))}
        {ytd && <label>Prior-year YTD<input className="fld-in txt" value={labels.p} onChange={(e) => set('p', e.target.value)} /></label>}
        {ytd && <label>Current YTD<input className="fld-in txt" value={labels.c} onChange={(e) => set('c', e.target.value)} /></label>}
        <label>LTM<input className="fld-in txt" value={labels.ltm} onChange={(e) => set('ltm', e.target.value)} /></label>
      </div>
    </div>
  );
}

/* ============================== COMPS ============================== */

const compsN = (data) => clampYears(data.comps?.settings?.years);
const compsYtd = (data) => data.comps?.settings?.ytd !== false;
const compsLabels = (data, company) => periodLabels(data.comps?.settings?.labels, compsN(data), company?.startYear);

function CompsSettingsExtra({ data, setData, company }) {
  const s = data.comps.settings || {};
  const setSettings = (next) => setData((d) => ({ ...d, comps: { ...d.comps, settings: next } }));
  const methods = COMPS_MULTIPLES.map((m) => ({ key: m.key, label: multipleLabel(m, compsLabels(data, company)) }));
  return (
    <div className="step-tools">
      <LabelsEditor labels={compsLabels(data, company)} ytd={compsYtd(data)} onChange={(labels) => setSettings({ ...s, labels })} />
      <ValuationChoices settings={s} onChange={setSettings} methods={methods} />
    </div>
  );
}

export const compsSettingsStep = () => ({
  id: 'compsSettings',
  title: 'Settings',
  blurb: 'How the workbook is laid out: price date, the lease toggle, how many fiscal years each page carries, YTD columns, period labels and the valuation choices.',
  fields: () => [
    f.date('comps.settings.priceDate', 'Share price date', { hint: 'The date the share prices are taken on.' }),
    leaseSpec('comps.settings.lease'),
    yearsSpec('comps.settings.years'),
    ytdSpec('comps.settings.ytd'),
  ],
  Extra: CompsSettingsExtra,
  extraBelow: true,
});

/** The target company page. */
function CompsTargetExtra({ data, setData, company }) {
  const t = data.comps.target;
  const n = compsN(data);
  const setTarget = (fn) => setData((d) => ({ ...d, comps: { ...d.comps, target: fn(d.comps.target) } }));
  const toggle = data.comps.settings?.lease === 0 ? 0 : 1;
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">optional</span></div>
        <YahooSearch company={company} action="Fill the page"
          onPick={(m) => setTarget((cur) => mergeFetch(cur, m, company, { n }))} />
        {t._fetched && <FetchNote f={t._fetched} />}
      </div>
      <div className="tool-card">
        <div className="tool-h">{company.name} — company page</div>
        <TemplatePageEditor
          page={t.page} onChange={(page) => setTarget((cur) => ({ ...cur, page }))}
          n={n} ytd={compsYtd(data)} labels={compsLabels(data, company)} toggle={toggle}
          market={{ price: t.price, shares: t.shares }} company={company}
        />
      </div>
    </div>
  );
}

function FetchNote({ f: fx }) {
  return (
    <div className="fld-h" style={{ marginTop: 6 }}>
      Filled from <b>{fx.symbol}</b> ({fx.financialCurrency}{fx.fyDates?.length ? `, ${fx.fyDates[0]} → ${fx.fyDates[fx.fyDates.length - 1]}` : ''}).
      Cost of Materials = cost of revenue, Employee Benefits = salaries (when reported), Other Expenses and Other Income balance to Yahoo’s EBITDA and pre-tax income,
      and the “Other” balance-sheet and cash-flow lines take the difference to Yahoo’s totals. YTD columns are left for you.
      {(fx.warnings || []).map((w) => <div key={w} className="fld-e">{w}</div>)}
    </div>
  );
}

export const compsTargetStep = () => ({
  id: 'compsTarget',
  title: 'Target company',
  blurb: 'The company being valued — market data and its full company page (income statement, balance sheet, cash flow).',
  fields: () => [
    f.text('comps.target.ticker', 'NSE / BSE ticker'),
    f.text('comps.target.sector', 'Sector / sub-sector'),
    f.price('comps.target.price', 'Share price', { required: false, gt: undefined, min: 0 }),
    f.shares('comps.target.shares', 'Diluted shares outstanding', { required: false, gt: undefined, min: 0, hint: 'Latest basic shares + dilutive ESOPs / convertibles.' }),
  ],
  Extra: CompsTargetExtra,
  extraBelow: true,
});

/** Peer slots: the chosen number of peers, each an input row + a company page. */
function PeersExtra({ data, setData, company }) {
  const comps = data.comps;
  const slots = peerSlots(comps);
  const tiers = comps.tiers || [];
  const n = compsN(data);
  const ytd = compsYtd(data);
  const labels = compsLabels(data, company);
  const toggle = comps.settings?.lease === 0 ? 0 : 1;
  const [open, setOpen] = useState(null);
  const [pasting, setPasting] = useState(false);

  const setComps = (fn) => setData((d) => ({ ...d, comps: fn(d.comps) }));
  /** Write peers: `fn(slots)` returns the new slot list; the count follows it when it grows. */
  const writeSlots = (fn) => setComps((c) => {
    const cur = peerSlots(c);
    const next = fn(cur);
    const stored = [...(c.peers || [])];
    next.forEach((p, k) => { stored[k] = p; });
    const count = Math.max(Number.isInteger(c.peerCount) ? c.peerCount : 0, next.length);
    return { ...c, peers: stored, peerCount: count };
  });
  const setPeer = (k, fn) => writeSlots((ss) => ss.map((p, i) => (i === k ? fn(p) : p)));
  /** Put fetched companies into the empty slots, adding slots when all are used. */
  const fillEmpty = (ms) => writeSlots((ss) => {
    const out = [...ss];
    for (const m of ms) {
      let k = out.findIndex(isBlankPeer);
      if (k < 0) { out.push(blankPeer({ tierId: tiers[0]?.id ?? null })); k = out.length - 1; }
      out[k] = mergeFetch(out[k], m, company, { n });
    }
    return out;
  });
  const fromList = (rows) => writeSlots((ss) => {
    const out = [...ss];
    rows.forEach((r, k) => {
      const base = out[k] || blankPeer();
      const tier = r.tier ? tiers.find((t) => t.name.trim().toLowerCase() === String(r.tier).trim().toLowerCase()) : null;
      out[k] = {
        ...base,
        name: r.name ?? base.name, ticker: r.ticker ?? base.ticker, sector: r.sector ?? base.sector,
        include: r.include ?? base.include, price: r.price ?? base.price, shares: r.shares ?? base.shares,
        tierId: tier ? tier.id : base.tierId,
      };
    });
    return out;
  });

  const addTier = () => setComps((c) => ({ ...c, tiers: [...(c.tiers || []), { id: `t${Date.now().toString(36)}`, name: `Tier ${(c.tiers?.length || 0) + 1}` }] }));
  const renameTier = (id, name) => setComps((c) => ({ ...c, tiers: c.tiers.map((t) => (t.id === id ? { ...t, name } : t)) }));
  const delTier = (id) => setComps((c) => ({ ...c, tiers: c.tiers.filter((t) => t.id !== id), peers: (c.peers || []).map((p) => (p?.tierId === id ? { ...p, tierId: null } : p)) }));

  const tPage = computePage(comps.target.page, { n, toggle, ytd, market: { price: comps.target.price, shares: comps.target.shares } });
  const pos = (v) => (isNum(v) && v !== 0 ? v : null);
  const finder = {
    seed: comps.target.ticker || company.name || '',
    inputs: {
      revenue: pos(tPage.v.rev[n - 1]), ebitda: pos(tPage.v.ebitda[n - 1]),
      priorRevenue: n >= 2 ? pos(tPage.v.rev[n - 2]) : null,
      price: pos(comps.target.price), shares: pos(comps.target.shares),
    },
  };
  const locale = CURRENCIES[company.currency]?.locale;
  const filled = slots.filter((p) => !isBlankPeer(p)).length;
  const included = slots.filter((p) => p.include === 1 && !isBlankPeer(p)).length;

  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Fill peers</div>
        <div className="fld-h" style={{ marginBottom: 8 }}>
          Fetched companies go into the empty peer slots (a slot is added when all are used). Figures are converted into {company.currency} {company.unit};
          anything Yahoo does not report stays blank (0 in the formulas, as in the template).
        </div>
        <YahooSearch company={company} action="Add peer" placeholder="Add a peer — name or ticker (RELIANCE.NS, AAPL…)" onPick={(m) => fillEmpty([m])} />
        <PeerBatchAdd company={company} existingNames={slots.flatMap((p) => [p.name, p.ticker]).filter(Boolean)} onAddMany={fillEmpty} finder={finder} />
        <div className="row-btns">
          <button className="btn sm" onClick={() => setPasting(true)}>Paste the company list from Excel</button>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Tiers <span className="fld-opt">optional — statistics are shown per tier as well</span></div>
        <div className="tier-list">
          {tiers.map((t) => (
            <div className="tier-row" key={t.id}>
              <input className="fld-in txt" value={t.name} onChange={(e) => renameTier(t.id, e.target.value)} />
              <span className="tier-n">{slots.filter((p) => p.tierId === t.id).length} peers</span>
              <button className="peer-del" title="Remove tier (its peers become unassigned)" onClick={() => delTier(t.id)}>×</button>
            </div>
          ))}
          <button className="btn sm" onClick={addTier}>+ Add tier</button>
        </div>
      </div>

      <div className="tool-card">
        <div className="tool-h">Peers · {slots.length} slot{slots.length === 1 ? '' : 's'}{filled < slots.length ? ` (${slots.length - filled} empty)` : ''} · {included} included in the statistics</div>
        {slots.length === 0 && <div className="fld-h">Choose the number of peers above.</div>}
        {slots.length > 0 && (
          <div className="tablewrap">
            <table className="fin compact slot-table">
              <thead><tr><th /><th>Role</th><th>Company name</th><th>Ticker</th><th>Sector</th><th>Include</th><th>Tier</th><th>Share price</th><th>Diluted shares</th><th>EV / EBITDA ({labels.ltm})</th><th /></tr></thead>
              <tbody>
                {slots.map((p, k) => {
                  const pg = computePage(p.page, { n, toggle, ytd, market: { price: p.price, shares: p.shares } });
                  const e = pg.v.ebitda[pg.cols.L];
                  return (
                    <React.Fragment key={p.id}>
                      <tr>
                        <td><button className="peer-toggle" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? '▾' : '▸'}</button></td>
                        <td>Peer {k + 1}</td>
                        <td><input className="fld-in txt" value={p.name || ''} placeholder={`Peer ${k + 1}`} onChange={(ev) => setPeer(k, (x) => ({ ...x, name: ev.target.value }))} /></td>
                        <td><input className="fld-in txt sm" value={p.ticker || ''} onChange={(ev) => setPeer(k, (x) => ({ ...x, ticker: ev.target.value }))} /></td>
                        <td><input className="fld-in txt" value={p.sector || ''} onChange={(ev) => setPeer(k, (x) => ({ ...x, sector: ev.target.value }))} /></td>
                        <td>
                          <select className="fld-in" value={p.include === 0 ? '0' : '1'} onChange={(ev) => setPeer(k, (x) => ({ ...x, include: Number(ev.target.value) }))}>
                            <option value="1">1</option><option value="0">0</option>
                          </select>
                        </td>
                        <td>
                          <select className="fld-in tier" value={p.tierId ?? ''} onChange={(ev) => setPeer(k, (x) => ({ ...x, tierId: ev.target.value || null }))}>
                            <option value="">none</option>
                            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </td>
                        <td><NumBox small value={p.price ?? null} onChange={(v) => setPeer(k, (x) => ({ ...x, price: v }))} /></td>
                        <td><NumBox small value={p.shares ?? null} onChange={(v) => setPeer(k, (x) => ({ ...x, shares: v }))} /></td>
                        <td className="calc">{e > 0 ? fmtTpl(pg.market.ev / e, 'x', locale) : 'NM'}</td>
                        <td>
                          <RowFetch query={p.ticker} company={company} onFilled={(m) => setPeer(k, (x) => mergeFetch(x, m, company, { n }))} />
                          <button className="peer-del" title="Clear this slot" onClick={() => setPeer(k, () => blankPeer({ id: p.id }))}>×</button>
                        </td>
                      </tr>
                      {open === p.id && (
                        <tr className="slot-page"><td colSpan={11}>
                          <TemplatePageEditor
                            page={p.page} onChange={(page) => setPeer(k, (x) => ({ ...x, page }))}
                            n={n} ytd={ytd} labels={labels} toggle={toggle}
                            market={{ price: p.price, shares: p.shares }} company={company}
                            notes={p._fetched ? <FetchNote f={p._fetched} /> : null}
                          />
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="fld-h">Open a peer (▸) for its full company page. Include = 1 puts the peer in the statistics; the target is never included.</div>
      </div>

      {pasting && <PasteDialog mode="list" onApply={fromList} onClose={() => setPasting(false)} />}
    </div>
  );
}

export const peersStep = () => ({
  id: 'peers',
  title: 'Peers',
  blurb: 'The comparable listed companies — as many as you choose, each with its own company page, include flag and tier.',
  fields: () => [f.int('comps.peerCount', 'Number of peers', { min: 1, max: 60, hint: 'Template: 10. Raising it adds empty slots; lowering it keeps the data of the slots it hides.' })],
  Extra: PeersExtra,
  extraBelow: true,
});

/* ============================ Regression ============================ */

const TRANSFORMS = [{ v: 'lin', label: 'x' }, { v: 'ln', label: 'ln x' }];
const DEGREES = [1, 2, 3];

function RegressionSetup({ data, setData, company }) {
  const a = useMemo(() => toEngineInput(company, data), [company, data]);
  const comps = useMemo(() => computeComps(a), [a]);
  const spec = data.regression;
  const vars = allVars(a, comps);
  const yVar = spec.yVar;
  const activeX = spec.xVars || [];
  const xOf = (key) => activeX.find((x) => x.key === key);
  const setSpec = (patch) => setData((d) => ({ ...d, regression: { ...d.regression, ...patch } }));
  const [newVar, setNewVar] = useState('');
  const R = useMemo(() => {
    if (!yVar || !activeX.length) return null;
    try { return runRegression(a); } catch { return null; }
  }, [a, yVar, activeX.length]);
  const obs = useMemo(() => observations(a, comps), [a, comps]);
  const tv = useMemo(() => targetValues(a, comps).values, [a, comps]);
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
  const setPeerVar = (id, key, v) => setData((d) => {
    const ps = peerSlots(d.comps);
    const k = ps.findIndex((p) => p.id === id);
    if (k < 0) return d;
    const stored = [...(d.comps.peers || [])];
    stored[k] = { ...ps[k], [key]: v };
    return { ...d, comps: { ...d.comps, peers: stored } };
  });
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
          Observations are the peers with Include = 1. Built-in variables come from the Comps Summary rows (read-only); your own variables are typed here.
          A target cell can be overridden; clear it to go back to the target’s own value.
        </div>
        <div className="tablewrap">
          <table className="fin compact reg-data">
            <thead>
              <tr><th>Company</th>{vars.map((v) => <th key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>{v.label}{v.key === yVar ? ' (y)' : xOf(v.key) ? ' (x)' : ''}</th>)}</tr>
            </thead>
            <tbody>
              {obs.map((o) => (
                <tr key={o.id}>
                  <td>{o.name || 'unnamed'}</td>
                  {vars.map((v) => (
                    <td key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>
                      {v.custom
                        ? <NumBox small value={fin(o.values[v.key]) ? o.values[v.key] : null} onChange={(val) => setPeerVar(o.id, v.key, val)} />
                        : fmtV(v.fmt)(o.values[v.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="reg-target">
                <td><b>{company.name} (target)</b></td>
                {vars.map((v) => {
                  const ov = spec.targetOverrides?.[v.key];
                  const own = v.custom ? null : v.get(comps.target);
                  return (
                    <td key={v.key} className={v.key === yVar || xOf(v.key) ? 'reg-used' : ''}>
                      <NumBox
                        small value={fin(ov) ? ov : null}
                        placeholder={fin(own) ? String(+Number(own).toFixed(2)) : fin(tv[v.key]) ? String(+Number(tv[v.key]).toFixed(2)) : 'NA'}
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
  blurb: 'Explain a peer multiple with fundamentals (growth, margins, returns, leverage, size…) and predict the target’s multiple.',
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

/* ============================ PRECEDENT ============================ */

const precN = (data) => clampYears(data.precedent?.settings?.years);
const precYtd = (data) => data.precedent?.settings?.ytd !== false;
const precToggle = (data) => (data.precedent?.settings?.lease === 0 ? 0 : 1);

function PrecSettingsExtra({ data, setData }) {
  const s = data.precedent.settings || {};
  return (
    <div className="step-tools">
      <ValuationChoices
        settings={s} methods={PREC_METHODS}
        onChange={(next) => setData((d) => ({ ...d, precedent: { ...d.precedent, settings: next } }))}
      />
    </div>
  );
}

export const precSettingsStep = () => ({
  id: 'precSettings',
  title: 'Settings',
  blurb: 'Valuation date, the lease toggle (apply the same treatment as your comps), fiscal years per page, YTD columns and the valuation choices.',
  fields: () => [
    f.date('precedent.settings.valDate', 'Valuation date'),
    leaseSpec('precedent.settings.lease'),
    yearsSpec('precedent.settings.years'),
    ytdSpec('precedent.settings.ytd'),
  ],
  Extra: PrecSettingsExtra,
  extraBelow: true,
});

function PrecCompanyExtra({ data, setData, company }) {
  const c = data.precedent.company;
  const n = precN(data);
  const setCo = (fn) => setData((d) => ({ ...d, precedent: { ...d.precedent, company: fn(d.precedent.company) } }));
  const labels = periodLabels(c.page?.labels, n, null);
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">optional — listed companies</span></div>
        <YahooSearch company={company} action="Fill the page"
          onPick={(m) => setCo((cur) => mergeFetch(cur, m, company, { n, labels: true }))} />
        {c._fetched && <FetchNote f={c._fetched} />}
      </div>
      <div className="tool-card">
        <div className="tool-h">Company Being Valued: {company.name}</div>
        <TemplatePageEditor
          page={c.page} onChange={(page) => setCo((cur) => ({ ...cur, page }))}
          n={n} ytd={precYtd(data)} labels={labels}
          onLabels={(lab) => setCo((cur) => ({ ...cur, page: { ...cur.page, labels: lab } }))}
          toggle={precToggle(data)} market={{ price: c.price, shares: c.shares }} company={company}
        />
      </div>
    </div>
  );
}

export const precCompanyStep = () => ({
  id: 'precCompany',
  title: 'Company being valued',
  blurb: 'Its latest financials — its LTM figures are what the deal multiples are applied to. Leave the price blank for an unlisted company (the control-premium method then shows NM).',
  fields: () => [
    f.text('precedent.company.ticker', 'NSE / BSE ticker (if listed)'),
    f.price('precedent.company.price', 'Current share price (if listed)', { required: false, gt: undefined, min: 0 }),
    f.shares('precedent.company.shares', 'Diluted shares outstanding', { required: false, gt: undefined, min: 0 }),
  ],
  Extra: PrecCompanyExtra,
  extraBelow: true,
});

/** The deal list (the template's Inputs rows 17…). */
function DealListExtra({ data, setData, company }) {
  const deals = dealSlots(data.precedent);
  const locale = CURRENCIES[company.currency]?.locale;
  const setDeal = (k, patch) => setData((d) => {
    const cur = dealSlots(d.precedent);
    const stored = [...(d.precedent.deals || [])];
    cur.forEach((x, i) => { if (!stored[i]) stored[i] = x; });
    stored[k] = { ...cur[k], ...patch };
    return { ...d, precedent: { ...d.precedent, deals: stored } };
  });
  const txt = (k, key, w) => <input className={`fld-in txt${w ? ` ${w}` : ''}`} value={deals[k][key] || ''} onChange={(e) => setDeal(k, { [key]: e.target.value })} />;
  const num = (k, key) => <NumBox small value={deals[k][key] ?? null} onChange={(v) => setDeal(k, { [key]: v })} />;
  if (!deals.length) return <div className="fld-h">Choose the number of deals above.</div>;
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Deal list</div>
        <div className="tablewrap">
          <table className="fin compact slot-table deal-list">
            <thead>
              <tr>
                <th>Deal</th><th>Announcement date</th><th>Target</th><th>Acquirer</th><th>Acquirer type</th><th>Stake acquired (%)</th>
                <th>Consideration paid ({company.unit})</th><th>Implied 100% equity value</th><th>Consideration form</th><th>Status</th>
                <th>Listed target?</th><th>Offer price</th><th>Unaffected price</th><th>Control premium</th><th>Include</th><th>Source / notes</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, k) => {
                const prem = controlPremium(d);
                return (
                  <tr key={d.id}>
                    <td>Deal {k + 1}</td>
                    <td><input type="date" className="fld-in txt" value={d.date || ''} onChange={(e) => setDeal(k, { date: e.target.value })} /></td>
                    <td>{txt(k, 'target')}</td>
                    <td>{txt(k, 'acquirer')}</td>
                    <td>{txt(k, 'acquirerType', 'sm')}</td>
                    <td>{num(k, 'stakePct')}</td>
                    <td>{num(k, 'consideration')}</td>
                    <td className="calc">{fmtTpl(impliedEquity100(d), 'n1', locale)}</td>
                    <td>{txt(k, 'form', 'sm')}</td>
                    <td>{txt(k, 'status', 'sm')}</td>
                    <td>
                      <select className="fld-in" value={d.listed || ''} onChange={(e) => setDeal(k, { listed: e.target.value })}>
                        <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                      </select>
                    </td>
                    <td>{num(k, 'offerPrice')}</td>
                    <td>{num(k, 'unaffectedPrice')}</td>
                    <td className="calc">{prem === '' ? '' : fmtTpl(prem, 'pct', locale)}</td>
                    <td>
                      <select className="fld-in" value={d.include === 0 ? '0' : '1'} onChange={(e) => setDeal(k, { include: Number(e.target.value) })}>
                        <option value="1">1</option><option value="0">0</option>
                      </select>
                    </td>
                    <td>{txt(k, 'source')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fld-h">
          Implied 100% equity value = consideration ÷ stake (grossed up to 100%). Control premium = offer ÷ unaffected price − 1, for listed targets only —
          use an unaffected price from before any deal rumours and be consistent across deals. Minority-stake deals usually carry no control premium; consider Include = 0.
        </div>
      </div>
    </div>
  );
}

export const dealListStep = () => ({
  id: 'deals',
  title: 'Deal list',
  blurb: 'The precedent transactions: dates, parties, stake and consideration, and (for listed targets) the offer and unaffected prices.',
  fields: () => [f.int('precedent.dealCount', 'Number of deals', { min: 1, max: 60, hint: 'Template: 10. Raising it adds empty rows; lowering it keeps the hidden rows’ data.' })],
  Extra: DealListExtra,
  extraBelow: true,
});

/** One company page per deal, as at announcement. */
function DealPagesExtra({ data, setData, company }) {
  const deals = dealSlots(data.precedent);
  const n = precN(data);
  const [open, setOpen] = useState(deals[0]?.id ?? null);
  const setDeal = (k, fn) => setData((d) => {
    const cur = dealSlots(d.precedent);
    const stored = [...(d.precedent.deals || [])];
    cur.forEach((x, i) => { if (!stored[i]) stored[i] = x; });
    stored[k] = fn(cur[k]);
    return { ...d, precedent: { ...d.precedent, deals: stored } };
  });
  if (!deals.length) return <div className="fld-h">Set the number of deals on the Deal list step first.</div>;
  return (
    <div className="step-tools">
      {deals.map((d, k) => {
        const title = `Deal ${k + 1}: ${d.target || '[target]'}${d.acquirer ? ` acquired by ${d.acquirer}` : ''}${d.date ? ` (${fmtDate(d.date)})` : ''}`;
        const labels = periodLabels(d.page?.labels, n, null);
        return (
          <div key={d.id} className={`peer-item${open === d.id ? ' open' : ''}`}>
            <div className="peer-line">
              <button className="peer-toggle" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? '▾' : '▸'}</button>
              <span className="peer-name-static">{title}</span>
            </div>
            {open === d.id && (
              <div className="peer-page">
                <div className="deal-fill">
                  <span>Listed target’s ticker</span>
                  <input className="fld-in txt sm" value={d.ticker || ''} placeholder="e.g. ABC.NS" onChange={(e) => setDeal(k, (x) => ({ ...x, ticker: e.target.value }))} />
                  <RowFetch
                    query={d.ticker} company={company}
                    title={d.date ? `Fill the fiscal years ending before ${d.date} from Yahoo Finance` : 'Enter the announcement date on the Deal list first'}
                    onFilled={(m) => d.date && setDeal(k, (x) => mergeFetch(x, m, company, { n, before: d.date, labels: true, market: false }))}
                  />
                  {!d.date && <span className="fld-e">Needs the announcement date (Deal list) — only years ending before it are used.</span>}
                </div>
                {d._fetched && <FetchNote f={d._fetched} />}
                <TemplatePageEditor
                  page={d.page} onChange={(page) => setDeal(k, (x) => ({ ...x, page }))}
                  n={n} ytd={precYtd(data)} labels={labels}
                  onLabels={(lab) => setDeal(k, (x) => ({ ...x, page: { ...x.page, labels: lab } }))}
                  toggle={precToggle(data)}
                  market={{ dealEquity: impliedEquity100(d), stake: d.stakePct, consideration: d.consideration }}
                  company={company}
                  notes={<div className="fld-h">Target financials AS OF THE ANNOUNCEMENT DATE, not today. Edit the period labels in the header — they differ deal to deal.</div>}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const dealPagesStep = () => ({
  id: 'dealPages',
  title: 'Deal financials',
  blurb: 'Each deal target’s financials as at announcement — income statement, balance sheet and cash flow.',
  fields: () => [],
  Extra: DealPagesExtra,
});

