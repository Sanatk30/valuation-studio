import React, { useMemo, useState } from 'react';
import { f } from '../fields.js';
import TemplatePageEditor from '../../components/TemplatePageEditor.jsx';
import PasteDialog from '../../components/PasteDialog.jsx';
import { PeerBatchAdd, YahooSearch, RowFetch, mergeFetch } from '../../components/PeerYahoo.jsx';
import { NumBox, Tip } from '../../wizard/Field.jsx';
import { computePage, MIN_YEARS, MAX_YEARS } from '../../lib/engine/companyPage.js';
import {
  COMPS_MULTIPLES, blankPeer, isBlankPeer, peerSlots, periodLabels, clampYears, multipleLabel, computeComps, usedMultiples, tsmShares,
} from '../../lib/engine/comps.js';
import { PREC_METHODS, dealSlots, isBlankDeal, impliedEquity100, controlPremium, computePrecedent } from '../../lib/engine/precedent.js';
import { STAT_KEYS, STAT_LABELS, statsSettings } from '../../lib/engine/templateStats.js';
import { runRegression, allVars, observations, targetValues, unpricedPeers } from '../../lib/engine/regressionModel.js';
import { toEngineInput } from '../../store/methodModel.js';
import { fmtX, fmtPct, fmtNum, fmtTpl, fmtDate, CURRENCIES, UNITS } from '../../lib/format.js';
import { YearCheck, YearEndSwitch } from '../../home/CompanyForms.jsx';
import { updateCompany } from '../../store/store.js';
import PeerMap from '../../components/PeerMap.jsx';
import { latestYearErrors } from './dcfSteps.jsx';

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
const invSpec = (path) => f.choice(path, 'Deduct non-current investments from EV?', [
  { value: 1, label: 'Yes (1)' }, { value: 0, label: 'No (0)' },
], { hint: 'Template: 1 — associates, JVs and strategic stakes are non-operating: their value is not earned through EBITDA, so leaving them in EV overstates EV / EBITDA. Choose 0 if the investments are operating.' });
const yearsSpec = (path) => f.int(path, 'Historical fiscal years on each page', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 3.` });
const ytdSpec = (path) => f.bool(path, 'Year-to-date columns', {
  yes: 'On — prior & current YTD', no: 'Off — LTM = latest FY',
  hint: 'With YTD columns, LTM = latest FY + current YTD − prior YTD, and the current-YTD column holds the interim balance sheet.',
});

/** Peers / deals a valuation needs at least (the spec's minimum set). */
const MIN_SET = 3;
const MAX_DEALS = 60;   // the Number of deals field's upper limit

/** The implied valuation needs at least one multiple (method) ticked on the Settings step. */
const needOneMethod = (methods, settings) => (usedMultiples(methods, settings?.multiples).length ? [] : ['Tick at least one multiple for the implied valuation (Valuation choices).']);

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

/**
 * Labels for a label editor: as `periodLabels`, but a label the user has just
 * cleared stays blank so it can be retyped — `periodLabels` reads a blank as its
 * default, so deleting a label character by character snapped back to it. A
 * never-typed label still shows its default; pages, outputs and workbooks keep
 * reading a blank as its default.
 */
export function editorLabels(stored, n, startYear) {
  const lab = periodLabels(stored, n, startYear);
  const fy = Array.isArray(stored?.fy) ? stored.fy.slice(-n) : [];
  const pad = n - fy.length;
  const keep = (v, d) => (v === '' ? '' : d);
  return {
    fy: lab.fy.map((x, i) => (i >= pad ? keep(fy[i - pad], x) : x)),
    p: keep(stored?.p, lab.p), c: keep(stored?.c, lab.c), ltm: keep(stored?.ltm, lab.ltm),
    f1: keep(stored?.f1, lab.f1), f2: keep(stored?.f2, lab.f2),
  };
}

/** Period-label editor (comps: one set for every page). */
function LabelsEditor({ labels, ytd, forward = false, onChange }) {
  const set = (id, v) => {
    const cur = { fy: [...labels.fy], p: labels.p, c: labels.c, ltm: labels.ltm, ...(forward ? { f1: labels.f1, f2: labels.f2 } : {}) };
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
        {forward && <label>Forecast year 1 (consensus)<input className="fld-in txt" value={labels.f1} onChange={(e) => set('f1', e.target.value)} /></label>}
        {forward && <label>Forecast year 2 (consensus)<input className="fld-in txt" value={labels.f2} onChange={(e) => set('f2', e.target.value)} /></label>}
      </div>
    </div>
  );
}

/**
 * Settings for Comps and Precedent exactly as the approved samples (page 1,
 * option B): the periods as a strip (click a label to rename it), then the
 * multiples as a grid — what is measured (rows) against which basis
 * (columns) — with low / mid / high, and the treatments beside it.
 */
function MultiplesSettingsLayout({ F, settings, onSettings, labels, onLabels, ytd, n, grid, title = 'What values the company', datePath, yearsPath, ytdPath, leasePath, invPath, sameAs }) {
  const st = statsSettings(settings?.stats || {});
  const sel = settings?.multiples || {};
  const setStats = (patch) => onSettings({ ...settings, stats: { ...st, ...patch } });
  const setMult = (key, on) => onSettings({ ...settings, multiples: { ...sel, [key]: on } });
  const used = grid.rows.flatMap((r) => r.cells).filter((c) => c && sel[c.key] !== false).length;
  const cells = [
    ...labels.fy.map((l, i) => ({ id: i, l, k: 'h' })),
    ...(ytd ? [{ id: 'p', l: labels.p, k: 'y' }, { id: 'c', l: labels.c, k: 'y' }] : []),
    { id: 'ltm', l: labels.ltm, k: 'l' },
  ];
  const setLab = (id, v) => {
    if (!onLabels) return;
    const cur = { ...labels, fy: [...labels.fy] };
    if (typeof id === 'number') cur.fy[id] = v; else cur[id] = v;
    onLabels(cur);
  };
  return (
    <>
      <div className="box2">
        <h3>Periods</h3>
        <div className="box2-s">{n} fiscal year{n === 1 ? '' : 's'}{ytd ? ', two YTD columns, and the LTM they make' : ' — no YTD columns, so the LTM is the latest fiscal year'}{onLabels ? ' · click a label to rename it' : ''}</div>
        <div className="pstrip" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
          {cells.map((c) => (
            <label key={String(c.id)} className={`ps ${c.k}`}>
              {onLabels ? <input value={c.l || ''} onChange={(e) => setLab(c.id, e.target.value)} aria-label={`Label for ${c.k === 'h' ? 'a fiscal year' : c.k === 'y' ? 'a YTD column' : 'the LTM'}`} /> : <span>{c.l}</span>}
            </label>
          ))}
        </div>
        <div className="ps-f">{ytd ? `${labels.ltm} = ${labels.fy[n - 1]} + ${labels.c} − ${labels.p}` : `${labels.ltm} = ${labels.fy[n - 1]}`}</div>
        <div className="tl-ctls">
          {F(datePath, { inline: true })}
          {F(yearsPath, { inline: true, label: 'Years per page' })}
          {F(ytdPath, { row: true, label: 'YTD columns', sub: 'needed for an LTM' })}
        </div>
      </div>
      <div className="gLb">
        <div className="box2">
          <h3>{title}</h3>
          <table className="mgrid">
            <thead><tr><th />{grid.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  {r.cells.map((c, i) => (c ? (
                    <td key={i}><button type="button" className={`mg${sel[c.key] !== false ? ' on' : ''}`} aria-pressed={sel[c.key] !== false} onClick={() => setMult(c.key, sel[c.key] === false)} title={c.tip || c.label}>
                      {sel[c.key] !== false ? `✓ ${c.short}` : c.short}
                    </button></td>
                  ) : <td key={i} className="mg-na">—</td>))}
                </tr>
              ))}
            </tbody>
          </table>
          {!used && <div className="fld-e">Tick at least one — the implied valuation needs a multiple.</div>}
          <div className="g3f">
            {[['low', 'Low'], ['mid', 'Mid'], ['high', 'High']].map(([k, lab]) => (
              <div className="fld" key={k}>
                <div className="fld-l"><label>{lab}</label></div>
                <select className="fld-in" value={st[k]} onChange={(e) => setStats({ [k]: e.target.value })}>
                  {STAT_KEYS.map((x) => <option key={x} value={x}>{STAT_LABELS[x]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
        <div className="box2">
          <h3>Treatments</h3>
          {F(leasePath, { row: true, label: 'Leases as debt', sub: sameAs || 'lease liabilities in EV' })}
          {F(invPath, { row: true, label: 'Deduct investments', sub: sameAs || 'non-operating' })}
          <div className="fr">
            <div className="fr-l"><b>Percentile method<Tip title="Percentile method" body="Inclusive matches Excel's QUARTILE.INC; exclusive (QUARTILE.EXC) needs enough values — with too few it shows NM." /></b></div>
            <span className="seg2"><button type="button" className={st.method === 'inc' ? 'on' : ''} onClick={() => setStats({ method: 'inc' })}>Incl.</button><button type="button" className={st.method === 'exc' ? 'on' : ''} onClick={() => setStats({ method: 'exc' })}>Excl.</button></span>
          </div>
          <div className="fr-col">
            <b>Statistics rows shown</b>
            <div className="chips2">{STAT_KEYS.map((x) => (
              <button type="button" key={x} className={st.show.includes(x) ? 'on' : ''} onClick={() => setStats({ show: st.show.includes(x) ? st.show.filter((y) => y !== x) : [...st.show, x] })}>{STAT_LABELS[x]}</button>
            ))}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ============================== COMPS ============================== */

/**
 * The target's share count. Options, convertibles and consensus forecasts are
 * not asked for (the user's choice): the workbook's treasury-stock and forward
 * columns read them as blank — diluted = this count, forward multiples NM.
 */
const shareDataFields = (base) => [
  f.shares(`${base}.shares`, 'Shares outstanding', { required: false, gt: undefined, min: 0, hint: 'Latest share count.' }),
];

const compsN = (data) => clampYears(data.comps?.settings?.years);
const compsYtd = (data) => data.comps?.settings?.ytd !== false;
const compsLabels = (data, company) => periodLabels(data.comps?.settings?.labels, compsN(data), company?.startYear);

function CompsSettingsExtra({ data, setData, company }) {
  const s = data.comps.settings || {};
  const setSettings = (next) => setData((d) => ({ ...d, comps: { ...d.comps, settings: next } }));
  const methods = COMPS_MULTIPLES.map((m) => ({ key: m.key, label: multipleLabel(m, compsLabels(data, company)) }));
  return (
    <div className="step-tools">
      <YearCheck startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} onUse={(y) => company?.id && updateCompany(company.id, { startYear: y })} />
      <LabelsEditor labels={editorLabels(s.labels, compsN(data), company?.startYear)} ytd={compsYtd(data)} forward onChange={(labels) => setSettings({ ...s, labels })} />
      <ValuationChoices settings={s} onChange={setSettings} methods={methods} />
    </div>
  );
}

function CompsSettingsLayout({ data, setData, company, F }) {
  const s = data.comps.settings || {};
  const setSettings = (next) => setData((d) => ({ ...d, comps: { ...d.comps, settings: next } }));
  const n = compsN(data);
  const lab = editorLabels(s.labels, n, company?.startYear);
  const shown = compsLabels(data, company);
  const by = (name, period) => COMPS_MULTIPLES.find((m) => m.name === name && m.period === period);
  const cell = (name, period, short) => { const m = by(name, period); return m ? { key: m.key, short, label: multipleLabel(m, shown) } : null; };
  const names = ['EV / Revenue', 'EV / EBITDA', 'EV / EBIT', 'P / E', 'P / B (latest)'];
  const grid = {
    cols: [`Latest FY (${shown.fy[n - 1]})`, `LTM (${shown.ltm})`, 'Latest book', 'Forecast yr 1', 'Forecast yr 2'],
    rows: names.map((nm) => ({ name: nm.replace(' (latest)', ''), cells: [cell(nm, 'fy', shown.fy[n - 1]), cell(nm, 'ltm', 'LTM'), cell(nm, 'book', 'Book'),
      (() => { const c = cell(nm, 'f1', 'Fwd 1'); return c && { ...c, tip: 'Needs consensus forecasts, which are not asked for — shows NM' }; })(),
      (() => { const c = cell(nm, 'f2', 'Fwd 2'); return c && { ...c, tip: 'Needs consensus forecasts, which are not asked for — shows NM' }; })()] })),
  };
  return (
    <>
      <MultiplesSettingsLayout F={F} settings={s} onSettings={setSettings} labels={lab} onLabels={(labels) => setSettings({ ...s, labels })} ytd={compsYtd(data)} n={n} grid={grid}
        title="Multiples" datePath="comps.settings.priceDate" yearsPath="comps.settings.years" ytdPath="comps.settings.ytd" leasePath="comps.settings.lease" invPath="comps.settings.inv" sameAs="same as your DCF" />
      <YearCheck startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} onUse={(y) => company?.id && updateCompany(company.id, { startYear: y })} />
    </>
  );
}

export const compsSettingsStep = () => ({
  id: 'compsSettings',
  title: 'Settings',
  blurb: 'How the workbook is laid out: price date, the lease and investment toggles, how many fiscal years each page carries, YTD columns, period labels and the valuation choices.',
  fields: () => [
    f.date('comps.settings.priceDate', 'Share price date', { hint: 'The date the share prices are taken on.' }),
    leaseSpec('comps.settings.lease'),
    invSpec('comps.settings.inv'),
    yearsSpec('comps.settings.years'),
    ytdSpec('comps.settings.ytd'),
  ],
  Extra: CompsSettingsExtra,
  extraBelow: true,
  Layout: CompsSettingsLayout,
  summary: (data) => { const k = usedMultiples(COMPS_MULTIPLES, data.comps?.settings?.multiples).length; const st = statsSettings(data.comps?.settings?.stats || {}); return `${k} multiples · ${STAT_LABELS[st.low] || ''} / ${STAT_LABELS[st.mid] || ''} / ${STAT_LABELS[st.high] || ''}`.replace(/percentile/gi, '').replace(/\s+/g, ' '); },
  validate: (data) => needOneMethod(COMPS_MULTIPLES, data.comps?.settings),
});


/**
 * The valued company as a profile card and its LTM built in plain sight (the
 * chosen Comps / Precedent design): FY + current YTD − prior YTD = LTM, for the
 * EBITDA the multiples are applied to; revenue, EBIT and PAT alongside.
 */
export function ProfileLtm({ name, sub, page, n, ytd, labels, toggle, inv, price, shares, company }) {
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  let pg = null;
  try { pg = computePage(page, { n, toggle, ytd, market: { price, shares }, inv }); } catch { pg = null; }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? fmtTpl(v, 'n0', locale) : '—');
  const { P, C, L } = pg ? pg.cols : {};
  const e = pg?.v?.ebitda || [];
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const tiles = [
    ['Share price', typeof price === 'number' ? `${sym}${fmtTpl(price, 'n2', locale)}` : '—'],
    ['Shares', typeof shares === 'number' ? fmtTpl(shares, 'n2', locale) : '—'],
    ['Market cap', pg && typeof pg.market.equity === 'number' && pg.market.equity ? `${sym}${num(pg.market.equity)}` : '—'],
    ['Enterprise value', pg && typeof pg.market.ev === 'number' && pg.market.equity ? `${sym}${num(pg.market.ev)}` : '—'],
  ];
  return (
    <>
      <div className="pf-card">
        <span className="pf-av">{initials}</span>
        <div className="pf-n"><b>{name}</b><small>{sub}</small></div>
        <div className="pf-tiles">{tiles.map(([a, b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>
      </div>
      {pg && (
        <div className="tool-card">
          <div className="tool-h">How the LTM is built · EBITDA <span className="fld-opt">the multiples are applied to these LTM figures</span></div>
          <div className="ltm">
            <div className="ltm-b"><small>{labels.fy[n - 1]}</small><b>{num(e[n - 1])}</b></div>
            {ytd ? (
              <>
                <span className="ltm-op">+</span>
                <div className="ltm-b y"><small>{labels.c || 'Current YTD'}</small><b>{num(e[C])}</b></div>
                <span className="ltm-op">−</span>
                <div className="ltm-b y"><small>{labels.p || 'Prior YTD'}</small><b>{num(e[P])}</b></div>
              </>
            ) : <span className="ltm-note">no YTD columns — the LTM is the latest fiscal year</span>}
            <span className="ltm-op">=</span>
            <div className="ltm-b r"><small>{labels.ltm || 'LTM'}</small><b>{num(e[L])}</b></div>
            <span className="ltm-also">Same for revenue ({num(pg.v.rev?.[L])}), EBIT ({num(pg.v.ebit?.[L])}) and PAT ({num(pg.v.patOwners?.[L])})</span>
          </div>
        </div>
      )}
    </>
  );
}

/** The target company page. */
function CompsTargetFetch({ data, setData, company }) {
  const t = data.comps.target;
  const n = compsN(data);
  const setTarget = (fn) => setData((d) => ({ ...d, comps: { ...d.comps, target: fn(d.comps.target) } }));
  return (
    <div className="tool-card fetchbar">
      <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">or paste from Excel into the page below</span></div>
      <YahooSearch company={company} action="Fill the page"
        onPick={(m) => setTarget((cur) => mergeFetch(cur, m, company, { n, alignTo: compsLabels(data, company).fy, basic: true }))} />
      {t._fetched && <FetchNote f={t._fetched} company={company} />}
    </div>
  );
}

function CompsTargetExtra({ data, setData, company }) {
  const t = data.comps.target;
  const n = compsN(data);
  const setTarget = (fn) => setData((d) => ({ ...d, comps: { ...d.comps, target: fn(d.comps.target) } }));
  const toggle = data.comps.settings?.lease === 0 ? 0 : 1;
  const inv = data.comps.settings?.inv === 0 ? 0 : 1;
  const lab = compsLabels(data, company);
  return (
    <div className="step-tools">
      <ProfileLtm name={company.name} sub={[t.ticker, t.sector].filter(Boolean).join(' · ') || 'the company being valued'} page={t.page} n={n} ytd={compsYtd(data)} labels={lab}
        toggle={toggle} inv={inv} price={t.price} shares={tsmShares(t)} company={company} />
      <div className="tool-card">
        <div className="tool-h">{company.name} — company page</div>
        <TemplatePageEditor
          page={t.page} onChange={(page) => setTarget((cur) => ({ ...cur, page }))}
          n={n} ytd={compsYtd(data)} labels={lab} toggle={toggle} inv={inv}
          market={{ price: t.price, shares: tsmShares(t) }} company={company}
        />
      </div>
    </div>
  );
}

export function FetchNote({ f: fx, company = null }) {
  return (
    <div className="fld-h" style={{ marginTop: 6 }}>
      Filled from <b>{fx.symbol}</b> ({fx.financialCurrency}{fx.fyDates?.length ? `, ${fx.fyDates[0]} → ${fx.fyDates[fx.fyDates.length - 1]}` : ''}).
      {fx.conv && <> Converted from <b>{fx.conv.from}</b> to <b>{fx.conv.to}</b> at <b>{+fx.conv.rate.toFixed(4)} {fx.conv.to} per {fx.conv.from}</b>{fx.conv.source === 'live' ? ` (live rate${fx.conv.at ? `, ${new Date(fx.conv.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''})` : ' (typed rate)'} for every year.</>}
      Cost of Materials = cost of revenue, Employee Benefits = salaries (when reported), Other Expenses and Other Income balance to Yahoo’s EBITDA and pre-tax income,
      and the “Other” balance-sheet and cash-flow lines take the difference to Yahoo’s totals. YTD columns are left for you.
      {fx.shareBasis === 'basic' && ' Shares = basic shares outstanding at the latest balance sheet; add options / convertibles for the treasury stock method.'}
      {(fx.warnings || []).map((w) => <div key={w} className="fld-e">{w}</div>)}
      {company && <YearEndSwitch company={company} fyEnd={fx.lastFyEnd} />}
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
    ...shareDataFields('comps.target'),
  ],
  Extra: CompsTargetExtra,
  extraBelow: true,
  Top: CompsTargetFetch,
  // the LTM is built on the latest FY column: with no figures there the target's multiples base is 0
  validate: (data, ctx) => latestYearErrors(pageRevShape(data.comps.target?.page, compsN(data), compsLabels(data, ctx.company).fy), ctx.company, "the target's LTM"),
});

/** A company page's revenue by FY column in the shape latestYearErrors reads (null when the page has no revenue at all). */
function pageRevShape(page, n, labels) {
  const fy = page?.lines?.rev?.fy || [];
  const rev = Array.from({ length: n }, (_, i) => (Number.isFinite(fy[i]) ? fy[i] : 0));
  return rev.some((v) => v !== 0) ? { n, F: { rev }, labels: { hist: labels } } : null;
}

/** Peers whose latest FY column is empty (their multiples come out NM and drop out of the statistics). */
function peersMissingLatest(comps, slots, n, labels) {
  return slots.map((k) => comps.peers?.[k]).filter((p) => p && !isBlankPeer(p))
    .filter((p) => { const sh = pageRevShape(p.page, n, labels); return sh && sh.F.rev[n - 1] === 0; })
    .map((p) => p.name || p.ticker || 'a peer');
}

/** Peer slots: the chosen number of peers, each an input row + a company page. */
function PeersExtra({ data, setData, company }) {
  const comps = data.comps;
  const slots = peerSlots(comps);
  const tiers = comps.tiers || [];
  const n = compsN(data);
  const ytd = compsYtd(data);
  const labels = compsLabels(data, company);
  const toggle = comps.settings?.lease === 0 ? 0 : 1;
  const inv = comps.settings?.inv === 0 ? 0 : 1;
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
      out[k] = mergeFetch(out[k], m, company, { n, alignTo: labels.fy, basic: true });
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

  const tPage = computePage(comps.target.page, { n, toggle, ytd, inv, market: { price: comps.target.price, shares: tsmShares(comps.target) } });
  const pos = (v) => (isNum(v) && v !== 0 ? v : null);
  const finder = {
    seed: comps.target.ticker || company.name || '',
    inputs: {
      revenue: pos(tPage.v.rev[n - 1]), ebitda: pos(tPage.v.ebitda[n - 1]),
      priorRevenue: n >= 2 ? pos(tPage.v.rev[n - 2]) : null,
      price: pos(comps.target.price), shares: pos(tsmShares(comps.target)),
    },
  };
  const locale = CURRENCIES[company.currency]?.locale;
  const filled = slots.filter((p) => !isBlankPeer(p)).length;
  const included = slots.filter((p) => p.include !== 0 && !isBlankPeer(p)).length;   // as the engine and the step check read it

  return (
    <div className="step-tools">
      {(() => {
        const miss = peersMissingLatest(comps, slots, n, labels.fy);
        return miss.length ? <div className="readout warn">{miss.join(', ')} {miss.length === 1 ? 'has' : 'have'} no figures in {labels.fy[n - 1]}, the latest year — {miss.length === 1 ? 'its' : 'their'} multiples are NM and left out of the statistics. If {labels.fy[n - 1]} has not ended yet, set Year 1 earlier in Company settings and fill again.</div> : null;
      })()}
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
              <thead><tr><th /><th>Role</th><th>Company name</th><th>Ticker</th><th>Sector</th><th>Include</th><th>Tier</th><th>Share price</th><th>Basic shares</th><th>EV / EBITDA ({labels.ltm})</th><th /></tr></thead>
              <tbody>
                {slots.map((p, k) => {
                  const pg = computePage(p.page, { n, toggle, ytd, inv, market: { price: p.price, shares: tsmShares(p) } });
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
                          <RowFetch query={p.ticker} company={company} onFilled={(m) => setPeer(k, (x) => mergeFetch(x, m, company, { n, alignTo: labels.fy, basic: true }))} />
                          <button className="peer-del" title="Clear this slot" onClick={() => setPeer(k, () => blankPeer({ id: p.id }))}>×</button>
                        </td>
                      </tr>
                      {open === p.id && (
                        <tr className="slot-page"><td colSpan={11}>
                          <TemplatePageEditor
                            page={p.page} onChange={(page) => setPeer(k, (x) => ({ ...x, page }))}
                            n={n} ytd={ytd} labels={labels} toggle={toggle} inv={inv}
                            market={{ price: p.price, shares: tsmShares(p) }} company={company}
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
        <div className="fld-h">Open a peer (▸) for its share data (options, convertibles), consensus forecasts and full company page. Include = 1 puts the peer in the statistics; the target is never included.</div>
      </div>

      {pasting && <PasteDialog mode="list" onApply={fromList} onClose={() => setPasting(false)} />}
    </div>
  );
}

function PeerMapTop({ data, setData, company }) {
  const res = useMemo(() => { try { return computeComps(toEngineInput(company, data)); } catch { return null; } }, [company, data]);
  if (!res) return null;
  const toggle = (id) => setData((d) => {
    const cur = peerSlots(d.comps);
    const stored = [...(d.comps.peers || [])];
    cur.forEach((p, k) => { if (!stored[k]) stored[k] = p; });
    const k = cur.findIndex((p) => p.id === id);
    if (k < 0) return d;
    stored[k] = { ...cur[k], include: cur[k].include === 0 ? 1 : 0 };
    return { ...d, comps: { ...d.comps, peers: stored } };
  });
  return (
    <div className="tool-card">
      <div className="tool-h">Peer map <span className="fld-opt">where each peer sits · click a dot to include or exclude it</span></div>
      <PeerMap peers={res.peers} target={res.target} company={company} onToggle={toggle}
        options={[{ key: 'evEbitdaLtm', label: 'EV / EBITDA' }, { key: 'peLtm', label: 'P / E' }, { key: 'evRevLtm', label: 'EV / Revenue' }]} />
    </div>
  );
}

export const peersStep = () => ({
  id: 'peers',
  title: 'Peers',
  blurb: 'The comparable listed companies — as many as you choose, each with its own company page, include flag and tier.',
  fields: () => [f.int('comps.peerCount', 'Number of peers', { min: MIN_SET, max: 60, hint: `Template: 10; at least ${MIN_SET}. Raising it adds empty slots; lowering it keeps the data of the slots it hides.` })],
  validate: (data) => {
    const k = peerSlots(data.comps).filter((p) => !isBlankPeer(p) && p.include !== 0).length;
    return k >= MIN_SET ? [] : [`Include at least ${MIN_SET} peers (Include = 1) — the statistics need ${MIN_SET}; ${k} so far.`];
  },
  Extra: PeersExtra,
  extraBelow: true,
  Top: PeerMapTop,
  summary: (data) => { const ps = peerSlots(data.comps).filter((p) => !isBlankPeer(p)); return ps.length ? `${ps.length} peers · ${ps.filter((p) => p.include !== 0).length} included` : null; },
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
  const unpriced = useMemo(() => unpricedPeers(a, comps), [a, comps]);
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

      {unpriced.length > 0 && (
        <div className="note-bar">Left out of the regression — no share price or share count, so the market cap reads 0: {unpriced.join(', ')}. Enter the price on the Peers step to include {unpriced.length === 1 ? 'it' : 'them'}.</div>
      )}
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
const precInv = (data) => (data.precedent?.settings?.inv === 0 ? 0 : 1);

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

function PrecSettingsLayout({ data, setData, company, F }) {
  const s = data.precedent.settings || {};
  const setSettings = (next) => setData((d) => ({ ...d, precedent: { ...d.precedent, settings: next } }));
  const n = precN(data);
  const lab = editorLabels(data.precedent.company?.page?.labels, n, null);
  const by = (k) => PREC_METHODS.find((m) => m.key === k);
  const cell = (k, short) => { const m = by(k); return m ? { key: m.key, short, label: m.label } : null; };
  const grid = {
    cols: ['LTM at announcement', 'Latest book', 'Offer vs unaffected price'],
    rows: [
      { name: 'EV / Revenue', cells: [cell('evRev', 'LTM'), null, null] },
      { name: 'EV / EBITDA', cells: [cell('evEbitda', 'LTM'), null, null] },
      { name: 'EV / EBIT', cells: [cell('evEbit', 'LTM'), null, null] },
      { name: 'P / E', cells: [cell('pe', 'LTM'), null, null] },
      { name: 'P / B', cells: [null, cell('pb', 'Book'), null] },
      { name: 'Control premium', cells: [null, null, { ...cell('premium', 'on today’s price'), tip: 'Median premium paid over the unaffected price, applied to the current share price' }] },
    ],
  };
  return (
    <MultiplesSettingsLayout F={F} settings={s} onSettings={setSettings} labels={lab} ytd={precYtd(data)} n={n} grid={grid}
      datePath="precedent.settings.valDate" yearsPath="precedent.settings.years" ytdPath="precedent.settings.ytd" leasePath="precedent.settings.lease" invPath="precedent.settings.inv" sameAs="same as your comps" />
  );
}

export const precSettingsStep = () => ({
  id: 'precSettings',
  title: 'Settings',
  blurb: 'Valuation date, the lease and investment toggles (apply the same treatment as your comps), fiscal years per page, YTD columns and the valuation choices.',
  fields: () => [
    f.date('precedent.settings.valDate', 'Valuation date'),
    leaseSpec('precedent.settings.lease'),
    invSpec('precedent.settings.inv'),
    yearsSpec('precedent.settings.years'),
    ytdSpec('precedent.settings.ytd'),
  ],
  Extra: PrecSettingsExtra,
  extraBelow: true,
  Layout: PrecSettingsLayout,
  summary: (data) => { const k = usedMultiples(PREC_METHODS, data.precedent?.settings?.multiples).length; return `${k} method${k === 1 ? '' : 's'}`; },
  validate: (data) => needOneMethod(PREC_METHODS, data.precedent?.settings),
});

function PrecCompanyFetch({ data, setData, company }) {
  const c = data.precedent.company;
  const n = precN(data);
  const setCo = (fn) => setData((d) => ({ ...d, precedent: { ...d.precedent, company: fn(d.precedent.company) } }));
  return (
    <div className="tool-card fetchbar">
      <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">listed companies — or paste from Excel into the page below</span></div>
      <YahooSearch company={company} action="Fill the page"
        onPick={(m) => setCo((cur) => mergeFetch(cur, m, company, { n, labels: true }))} />
      {c._fetched && <FetchNote f={c._fetched} company={company} />}
    </div>
  );
}

function PrecCompanyExtra({ data, setData, company }) {
  const c = data.precedent.company;
  const n = precN(data);
  const setCo = (fn) => setData((d) => ({ ...d, precedent: { ...d.precedent, company: fn(d.precedent.company) } }));
  const labels = editorLabels(c.page?.labels, n, null);
  return (
    <div className="step-tools">
      <ProfileLtm name={company.name} sub={c.ticker ? `${c.ticker} · listed` : 'unlisted — the control-premium method shows NM'} page={c.page} n={n} ytd={precYtd(data)} labels={labels}
        toggle={precToggle(data)} inv={precInv(data)} price={c.price} shares={c.shares} company={company} />
      <div className="tool-card">
        <div className="tool-h">Company being valued: {company.name}</div>
        <TemplatePageEditor
          page={c.page} onChange={(page) => setCo((cur) => ({ ...cur, page }))}
          n={n} ytd={precYtd(data)} labels={labels}
          onLabels={(lab) => setCo((cur) => ({ ...cur, page: { ...cur.page, labels: lab } }))}
          toggle={precToggle(data)} inv={precInv(data)} market={{ price: c.price, shares: c.shares }} company={company}
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
  Top: PrecCompanyFetch,
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
                    <td className="calc" title={impliedEquity100(d) === '' ? 'Needs a stake and consideration above 0 — the deal shows NM and stays out of the statistics' : undefined}>{impliedEquity100(d) === '' ? 'NM' : fmtTpl(impliedEquity100(d), 'n1', locale)}</td>
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
                      <select className="fld-in" value={d.include === 0 || isBlankDeal(d) ? '0' : '1'} onChange={(e) => setDeal(k, { include: Number(e.target.value) })} title={isBlankDeal(d) ? 'An empty slot is left out of the statistics until you fill it in' : undefined}>
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
          Implied 100% equity value = consideration ÷ stake (grossed up to 100%); a deal without both shows NM and stays out of the statistics. Control premium = offer ÷ unaffected price − 1, for listed targets only —
          use an unaffected price from before any deal rumours and be consistent across deals. Minority-stake deals usually carry no control premium; consider Include = 0.
        </div>
      </div>
    </div>
  );
}

/** Deal list exactly as the approved sample (Precedent page 3, option B): a timeline, then a card per deal. */
function DealCardsLayout({ data, setData, company, F }) {
  const deals = dealSlots(data.precedent);
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const [edit, setEdit] = useState(null);
  const res = useMemo(() => { try { return computePrecedent(toEngineInput(company, data)); } catch { return null; } }, [company, data]);
  const setDeal = (k, patch) => setData((d) => {
    const cur = dealSlots(d.precedent);
    const stored = [...(d.precedent.deals || [])];
    cur.forEach((x, i) => { if (!stored[i]) stored[i] = x; });
    stored[k] = { ...cur[k], ...patch };
    return { ...d, precedent: { ...d.precedent, deals: stored } };
  });
  const addDeal = () => {
    if (deals.length >= MAX_DEALS) return;
    setData((d) => ({ ...d, precedent: { ...d.precedent, dealCount: Math.min(MAX_DEALS, dealSlots(d.precedent).length + 1) } }));
    setEdit(deals.length);
  };
  const x = (v) => (typeof v === 'number' && fin(v) ? `${v.toFixed(1)}x` : 'NM');
  const dated = deals.map((d, k) => ({ d, k, t: d.date ? Date.parse(d.date) : NaN })).filter((o) => fin(o.t));
  const now = Date.now();
  const t0 = dated.length ? Math.min(...dated.map((o) => o.t)) : now - 3 * 365 * 864e5;
  const span = Math.max(now - t0, 365 * 864e5) * 1.04;
  const pos = (t) => 2 + ((t - t0) / span) * 94;
  const years = [];
  for (let y = new Date(t0).getFullYear(); y <= new Date(now).getFullYear(); y++) years.push(y);
  const txt = (k, key, ph) => <input className="fld-in txt" value={deals[k][key] || ''} placeholder={ph || ''} onChange={(e) => setDeal(k, { [key]: e.target.value })} />;
  const num = (k, key) => <NumBox value={deals[k][key] ?? null} onChange={(v) => setDeal(k, { [key]: v })} />;
  return (
    <>
      <div className="box2">
        <div className="dl-top"><h3>Deals over time</h3><span className="box2-s">newer deals reflect today’s market better · hollow = left out</span><span style={{ flex: 1 }} />{F('precedent.dealCount', { inline: true, label: 'Number of deals' })}</div>
        <div className="dtl">
          <div className="dtl-ax" />
          {years.map((y) => <span key={y} className="dtl-y" style={{ left: `${pos(Date.parse(`${y}-01-01`))}%` }}>{y}</span>)}
          {dated.map(({ d, k, t }) => {
            const on = !(d.include === 0);
            return <button type="button" key={d.id} className={`dtl-p${on ? '' : ' off'}`} style={{ left: `${pos(t)}%` }} onClick={() => setEdit(k)} title={`${d.target || 'Deal ' + (k + 1)} · ${fmtDate(d.date)}`}><i /><span>{d.target || `Deal ${k + 1}`}</span></button>;
          })}
          <span className="dtl-p today" style={{ left: `${pos(now)}%` }}><i /><span>Today</span></span>
        </div>
      </div>
      <div className="dcards">
        {deals.map((d, k) => {
          const row = res?.deals?.[k];
          const on = !(d.include === 0) && !isBlankDeal(d);
          const eq = impliedEquity100(d);
          const prem = controlPremium(d);
          return (
            <div key={d.id} className={`dcard${on ? '' : ' off'}${edit === k ? ' open' : ''}`}>
              <div className="dc-top">
                <span className="dc-date">{d.date ? fmtDate(d.date) : 'no date'}</span>
                {d.acquirerType && <span className="badge2">{d.acquirerType}</span>}
                {d.status && <span className={`pill2 ${/complet/i.test(d.status) ? 'ok' : 'pr'}`}>{d.status}</span>}
                <span style={{ flex: 1 }} />
                <button type="button" role="switch" aria-checked={on} aria-label="Include in the statistics" className={`sw${on ? ' on' : ''}`} disabled={isBlankDeal(d)} onClick={() => setDeal(k, { include: on ? 0 : 1 })} />
              </div>
              <div className="dc-t">{d.target || `Deal ${k + 1}`}</div>
              <div className="dc-s">{d.acquirer ? `acquired by ${d.acquirer}` : 'acquirer not set'}{fin(d.stakePct) ? ` · ${d.stakePct}%` : ''}{fin(d.consideration) ? ` for ${sym}${fmtNum(d.consideration, 0, locale)} ${UNITS[company.unit] || ''}` : ''}{d.form ? ` (${d.form.toLowerCase()})` : ''}</div>
              <div className="dc-m">
                <div><small>100% equity</small><b>{typeof eq === 'number' ? `${sym}${fmtNum(eq, 0, locale)}` : '—'}</b></div>
                <div><small>EV/EBITDA</small><b>{x(row?.mult?.evEbitda)}</b></div>
                <div><small>P/E</small><b>{x(row?.mult?.pe)}</b></div>
                <div><small>Premium</small><b>{typeof prem === 'number' && fin(prem) ? `${(prem * 100).toFixed(1)}%` : '—'}</b></div>
              </div>
              {!on && !isBlankDeal(d) && <div className="warn2 sm">Left out of the statistics</div>}
              <button type="button" className="dc-e" onClick={() => setEdit(edit === k ? null : k)}>{edit === k ? 'Close ▴' : 'Edit deal ›'}</button>
              {edit === k && (
                <div className="dc-form">
                  <label>Announcement date<input type="date" className="fld-in txt" value={d.date || ''} onChange={(e) => setDeal(k, { date: e.target.value })} /></label>
                  <label>Target{txt(k, 'target')}</label>
                  <label>Acquirer{txt(k, 'acquirer')}</label>
                  <label>Acquirer type{txt(k, 'acquirerType', 'Strategic / Financial')}</label>
                  <label>Stake acquired (%){num(k, 'stakePct')}</label>
                  <label>Consideration paid ({UNITS[company.unit] || ''}){num(k, 'consideration')}</label>
                  <label>Consideration form{txt(k, 'form', 'Cash / stock')}</label>
                  <label>Status{txt(k, 'status', 'Completed / Pending')}</label>
                  <label>Listed target?<select className="fld-in" value={d.listed || ''} onChange={(e) => setDeal(k, { listed: e.target.value })}><option value="">—</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
                  {d.listed === 'Yes' && <label>Offer price ({sym}){num(k, 'offerPrice')}</label>}
                  {d.listed === 'Yes' && <label>Unaffected price ({sym}){num(k, 'unaffectedPrice')}</label>}
                  <label className="wide">Source / notes{txt(k, 'source')}</label>
                </div>
              )}
            </div>
          );
        })}
        {deals.length < MAX_DEALS && <button type="button" className="dcard add" onClick={addDeal}><span>+</span><b>Add a deal</b></button>}
      </div>
    </>
  );
}

export const dealListStep = () => ({
  id: 'deals',
  title: 'Deal list',
  blurb: 'The precedent transactions: dates, parties, stake and consideration, and (for listed targets) the offer and unaffected prices.',
  fields: () => [f.int('precedent.dealCount', 'Number of deals', { min: MIN_SET, max: MAX_DEALS, hint: `Template: 10; at least ${MIN_SET}. Raising it adds empty rows; lowering it keeps the hidden rows’ data.` })],
  validate: (data) => {
    const k = dealSlots(data.precedent).filter((d) => !isBlankDeal(d) && d.include !== 0).length;
    return k >= MIN_SET ? [] : [`Include at least ${MIN_SET} deals (Include = 1) — the statistics need ${MIN_SET}; ${k} so far.`];
  },
  Extra: DealListExtra,
  extraBelow: true,
  Layout: DealCardsLayout,
  summary: (data) => { const ds = dealSlots(data.precedent).filter((d) => !isBlankDeal(d)); return ds.length ? `${ds.length} deals · ${ds.filter((d) => d.include !== 0).length} included` : null; },
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
        const labels = editorLabels(d.page?.labels, n, null);
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
                  toggle={precToggle(data)} inv={precInv(data)}
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

/** Deal financials exactly as the approved sample (Precedent page 4, option C): page through the deals, checks on the right. */
function DealPagerLayout({ data, setData, company }) {
  const deals = dealSlots(data.precedent);
  const n = precN(data);
  const [k, setK] = useState(0);
  const res = useMemo(() => { try { return computePrecedent(toEngineInput(company, data)); } catch { return null; } }, [company, data]);
  const setDeal = (i, fn) => setData((d) => {
    const cur = dealSlots(d.precedent);
    const stored = [...(d.precedent.deals || [])];
    cur.forEach((x, j) => { if (!stored[j]) stored[j] = x; });
    stored[i] = fn(cur[i]);
    return { ...d, precedent: { ...d.precedent, deals: stored } };
  });
  if (!deals.length) return <div className="box2">Set the number of deals on the Deal list step first.</div>;
  const i = Math.min(k, deals.length - 1);
  const d = deals[i];
  const labels = editorLabels(d.page?.labels, n, null);
  const row = res?.deals?.[i];
  const filled = (x) => x.page && !pageIsEmptyLocal(x.page);
  let check = null;
  try { const pg = computePage(d.page, { n, toggle: precToggle(data), ytd: precYtd(data), inv: precInv(data), market: { dealEquity: impliedEquity100(d), stake: d.stakePct, consideration: d.consideration } }); check = pg.v.check.some((x) => typeof x === 'number' && Math.abs(x) > 0.5); } catch { check = null; }
  const ok = (b) => (b ? <b className="up">✓</b> : <b className="fa">—</b>);
  const x = (v) => (typeof v === 'number' && fin(v) ? `${v.toFixed(1)}x` : 'NM');
  return (
    <>
      <div className="dchips">
        {deals.map((dd, j) => (
          <button type="button" key={dd.id} className={`dchip${j === i ? ' on' : ''}`} onClick={() => setK(j)}>
            {j === i ? '● ' : filled(dd) ? '✓ ' : '○ '}{dd.target || `Deal ${j + 1}`}
          </button>
        ))}
      </div>
      <div className="gLb">
        <div className="box2">
          <div className="dp-h">
            <div>
              <div className="lbl">Deal {i + 1} of {deals.length}{d.date ? ` · announced ${fmtDate(d.date)}` : ''}</div>
              <h3 className="dp-t">{d.target || `Deal ${i + 1}`} {d.acquirer && <span className="fa">acquired by {d.acquirer}</span>}</h3>
            </div>
            <span style={{ flex: 1 }} />
            <input className="fld-in txt sm" style={{ width: 130 }} value={d.ticker || ''} placeholder="Ticker, e.g. ABC.NS" onChange={(e) => setDeal(i, (y) => ({ ...y, ticker: e.target.value }))} />
            <RowFetch query={d.ticker} company={company}
              title={d.date ? `Fill the fiscal years ending before ${d.date} from Yahoo Finance` : 'Enter the announcement date on the Deal list first'}
              onFilled={(m) => d.date && setDeal(i, (y) => mergeFetch(y, m, company, { n, before: d.date, labels: true, market: false }))} />
          </div>
          {!d.date && <div className="fld-e">Needs the announcement date (Deal list) — only years ending before it are used.</div>}
          {d._fetched && <FetchNote f={d._fetched} />}
          <TemplatePageEditor
            page={d.page} onChange={(page) => setDeal(i, (y) => ({ ...y, page }))}
            n={n} ytd={precYtd(data)} labels={labels}
            onLabels={(lab) => setDeal(i, (y) => ({ ...y, page: { ...y.page, labels: lab } }))}
            toggle={precToggle(data)} inv={precInv(data)}
            market={{ dealEquity: impliedEquity100(d), stake: d.stakePct, consideration: d.consideration }}
            company={company}
            notes={<div className="fld-h">The target’s figures as at the announcement date, not today. Click a column header to rename it — labels differ deal to deal.</div>}
          />
          <div className="dp-nav">
            <button type="button" className="btn ghost" disabled={i === 0} onClick={() => setK(i - 1)}>← Previous deal</button>
            <span style={{ flex: 1 }} />
            {i < deals.length - 1 && <button type="button" className="btn primary" onClick={() => setK(i + 1)}>Next deal: {deals[i + 1].target || `Deal ${i + 2}`} →</button>}
          </div>
        </div>
        <div className="col16 stick">
          <div className="box2">
            <h3>Checks</h3>
            <div className="kv3"><span>Announcement date set</span>{ok(!!d.date)}</div>
            <div className="kv3"><span>Figures entered</span>{ok(filled(d))}</div>
            <div className="kv3"><span>Balance sheet balances</span>{check === null ? <b className="fa">—</b> : check ? <b className="dn">✕</b> : <b className="up">✓</b>}</div>
            <div className="kv3"><span>EV / EBITDA</span><b>{x(row?.mult?.evEbitda)}</b></div>
            <div className="kv3"><span>P / E</span><b>{x(row?.mult?.pe)}</b></div>
          </div>
          {res?.summary && (
            <div className="live2">
              <div className="live2-l">Precedent value, live</div>
              <div className="live2-v">{fin(res.summary?.medianMid) ? `${CURRENCIES[company.currency]?.symbol || ""}${fmtNum(res.summary.medianMid, 2, CURRENCIES[company.currency]?.locale)}` : "—"}</div>
              <div className="live2-kv"><span>Deals included</span><b>{res.deals.filter((y) => y.include === 1).length} of {res.deals.length}</b></div>
              <div className="live2-kv"><span>Median EV / EBITDA</span><b>{x(res.stats1?.evEbitda?.median)}</b></div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
const pageIsEmptyLocal = (pg) => !Object.values(pg?.lines || {}).some((l) => (l?.fy || []).some((v) => typeof v === 'number') || typeof l?.p === 'number' || typeof l?.c === 'number');

export const dealPagesStep = () => ({
  id: 'dealPages',
  title: 'Deal financials',
  blurb: 'Each deal target’s financials as at announcement — income statement, balance sheet and cash flow.',
  fields: () => [],
  Extra: DealPagesExtra,
  Layout: DealPagerLayout,
  summary: (data) => { const ds = dealSlots(data.precedent); const k = ds.filter((d) => !pageIsEmptyLocal(d.page)).length; return ds.length ? `${k} of ${ds.length} filled` : null; },
});

