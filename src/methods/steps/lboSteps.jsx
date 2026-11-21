import React, { useState } from 'react';
import { f } from '../fields.js';
import { NumBox } from '../../wizard/Field.jsx';
import TemplatePageEditor from '../../components/TemplatePageEditor.jsx';
import DriversGrid from '../../components/DriversGrid.jsx';
import { DriversView } from '../../components/DriverCharts.jsx';
import { YahooSearch, mergeFetch } from '../../components/PeerYahoo.jsx';
import { FetchNote } from './templateSteps.jsx';
import { PeriodLabelsCard, emptyHistYears, latestYearErrors } from './dcfSteps.jsx';
import { toEngineInput } from '../../store/methodModel.js';
import { REPAY_KINDS, repayKind, LBO_DRIVERS, TRANCHES, computeLboT } from '../../lib/engine/lboTemplate.js';
import { clampN, dcfLabels } from '../../lib/engine/dcfTemplate.js';
import { MIN_YEARS, MAX_YEARS } from '../../lib/engine/companyPage.js';
import { fmtTpl, CURRENCIES, UNITS } from '../../lib/format.js';
import { YearCheck } from '../../home/CompanyForms.jsx';
import { updateCompany } from '../../store/store.js';
import Timeline from '../../components/Timeline.jsx';
import StatementPanels from '../../components/StatementPanels.jsx';
import PasteDialog from '../../components/PasteDialog.jsx';
import Heatmap from '../../components/Heatmap.jsx';
import { fmtNum } from '../../lib/format.js';
import { CountUp } from '../../lib/motion.jsx';

/**
 * Wizard steps for the LBO, following the user's three LBO templates:
 *   Settings · Company & historicals · Assumptions · Transaction & debt · Exit & sensitivity
 * The Settings step picks how Senior A and Senior B are repaid (mandatory only,
 * mandatory + cash sweep, cash sweep only); the other steps ask only what that
 * template asks. Blank cells behave as in the templates (0).
 */

const fin = Number.isFinite;
const S = (data) => data.lbo?.settings || {};
const nHist = (data) => clampN(S(data).histYears, 3);
const nHold = (data) => clampN(S(data).holdYears, 5);
const labelsOf = (data, company) => dcfLabels(S(data).labels, nHist(data), nHold(data), company?.startYear);
const pct1 = (v) => (fin(v) ? `${(v * 100).toFixed(1)}%` : 'NM');

/** The engine on the current data, once per (company, data) — the layout, live card, step summaries and checks share it. */
const RESULTS = new WeakMap();
function resultOf(company, data) {
  const hit = data && typeof data === 'object' ? RESULTS.get(data) : null;
  if (hit && hit.company === company) return hit.r;
  let r;
  try { r = computeLboT(toEngineInput(company, data)); } catch { r = null; }
  if (data && typeof data === 'object') RESULTS.set(data, { company, r });
  return r;
}

/** The teal "Sponsor returns, live" card of the approved LBO samples. */
export function LboLiveCard({ company, data }) {
  const r = resultOf(company, data);
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const unit = UNITS[company.unit] || '';
  const m = (x) => (fin(x) ? `${sym}${fmtNum(x, 0, locale)} ${unit}` : '—');
  return (
    <div className="live2">
      <div className="live2-l">Sponsor returns, live</div>
      <div className="live2-v"><CountUp>{r && fin(r.irr) ? `${(r.irr * 100).toFixed(1)}% IRR` : '—'}</CountUp></div>
      <div className="live2-g up">{r && fin(r.moic) ? `${r.moic.toFixed(2)}x money multiple over ${r.m} years` : 'finish the steps to see the returns'}</div>
      <div className="live2-kv"><span>Equity in</span><b>{m(r?.su?.sponsor)}</b></div>
      <div className="live2-kv"><span>Equity out</span><b>{m(r?.exit?.equity)}</b></div>
      <div className="live2-kv"><span>Debt at entry</span><b>{r && fin(r.totalDebt?.x) ? `${r.totalDebt.x.toFixed(1)}x EBITDA` : '—'}</b></div>
    </div>
  );
}

/* ============================== Settings ============================== */

/** Settings as the approved LBO sample: the holding period as a timeline, repayment with hover detail. */
function LboSettingsLayout({ data, setData, company, F, Extra, ctx }) {
  const lab = labelsOf(data, company);
  return (
    <>
      <div className="box2">
        <h3>Timeline</h3>
        <div className="box2-s">entry at the end of {lab.hist[lab.hist.length - 1]}, {lab.fcst.length} years of ownership, exit at the end of {lab.fcst[lab.fcst.length - 1]}</div>
        <Timeline hist={lab.hist} fcst={lab.fcst} startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} fcstSub="holding"
          fcstTip={(i, n2) => (i === n2 - 1 ? 'The final holding year — the business is sold at its end.' : `Holding year ${i + 1}: cash pays interest and repays debt.`)}
          tail={{ label: 'Exit', sub: 'sale', tip: 'The sponsor sells at an exit EV / EBITDA multiple at the end of the holding period.' }} />
        <div className="tl-ctls">{F('lbo.settings.histYears', { inline: true })}{F('lbo.settings.holdYears', { inline: true, label: 'Holding period' })}</div>
      </div>
      <div className="g2b">
        <div className="box2"><h3>Debt repayment</h3><div className="box2-s">picks one of the three LBO templates · hover for how each works</div>{F('lbo.settings.repay', { row: true, label: 'Repayment', sub: 'How the senior debt is paid down' })}</div>
        <div className="box2"><h3>Conventions</h3>{F('lbo.settings.lease', { row: true, label: 'Leases count as debt', sub: 'In net debt at entry and exit' })}</div>
      </div>
      <div className="box2"><Extra data={data} setData={setData} company={company} ctx={ctx} /></div>
    </>
  );
}


function SettingsExtra({ data, setData, company }) {
  return (
    <div className="step-tools">
      <YearCheck startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} onUse={(y) => company?.id && updateCompany(company.id, { startYear: y })} />
      <PeriodLabelsCard
        labels={dcfLabels(S(data).labels, nHist(data), nHold(data), company?.startYear, { keepBlank: true })} latestName="Latest actual year (entry)"
        fcstName={(i, m) => `Forecast year ${i + 1}${i === m - 1 ? ' (exit)' : ''}`}
        onChange={(labels) => setData((d) => ({ ...d, lbo: { ...d.lbo, settings: { ...d.lbo.settings, labels } } }))}
      />
    </div>
  );
}

export const lboSettingsStep = () => ({
  id: 'lboSettings',
  title: 'Settings',
  blurb: 'How the acquisition debt is repaid — which picks one of the three LBO templates — and how many historical years and holding-period years the model carries.',
  fields: () => [
    f.choice('lbo.settings.repay', 'Debt repayment', REPAY_KINDS.map((k) => ({ value: k.value, label: k.label, hint: k.note }))),
    f.int('lbo.settings.histYears', 'Historical years', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 3.` }),
    f.int('lbo.settings.holdYears', 'Holding period (years)', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 5 — exit at the end of the last year.` }),
    f.choice('lbo.settings.lease', 'Treat lease liabilities as debt?', [
      { value: 1, label: 'Yes (1)' }, { value: 0, label: 'No (0)' },
    ], { hint: 'Template: 1 — deducted at entry and exit.' }),
  ],
  Extra: SettingsExtra,
  extraBelow: true,
  Layout: LboSettingsLayout,
  summary: (data) => { const s2 = S(data); return s2.repay ? `${repayKind(s2.repay).label.replace(' repayment', '').replace('Mandatory', 'Mandatory')} · ${nHold(data)} yrs` : null; },
});

/* ======================= Company & historicals ======================= */

function CompanyExtra({ data, setData, company }) {
  const c = data.lbo.company;
  const n = nHist(data);
  const lab = labelsOf(data, company);
  const setCo = (fn) => setData((d) => ({ ...d, lbo: { ...d.lbo, company: fn(d.lbo.company) } }));
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">optional</span></div>
        <YahooSearch company={company} action="Fill the historicals" onPick={(m) => setCo((cur) => mergeFetch(cur, m, company, { n, market: false, alignTo: lab.hist }))} />
        {c._fetched && <FetchNote f={c._fetched} company={company} />}
      </div>
      <div className="tool-card">
        <div className="tool-h">{company.name} — historical financials</div>
        <TemplatePageEditor
          historicals page={c.page} onChange={(page) => setCo((cur) => ({ ...cur, page }))}
          n={n} labels={{ fy: lab.hist, p: '', c: '', ltm: '' }} toggle={S(data).lease === 0 ? 0 : 1} company={company}
          notes={<div className="fld-h">Consolidated. The latest year is the entry year: entry EBITDA, the balance sheet refinanced and the cash available come from it.</div>}
        />
      </div>
    </div>
  );
}

/** Company & historicals as the approved DCF design (page 2, option B), reused for the LBO. */
function LboCompanyLayout({ data, setData, company }) {
  const c = data.lbo.company;
  const n = nHist(data);
  const lab = labelsOf(data, company);
  const [pasting, setPasting] = useState(false);
  const setCo = (fn) => setData((d) => ({ ...d, lbo: { ...d.lbo, company: fn(d.lbo.company) } }));
  return (
    <>
      <div className="box2 fetchbar2">
        <div className="fb-row">
          <div className="fb-q"><div className="fb-l">Fill from Yahoo Finance</div>
            <YahooSearch company={company} action="Fetch" onPick={(m) => setCo((cur) => mergeFetch(cur, m, company, { n, market: false, alignTo: lab.hist }))} />
          </div>
          <button type="button" className="btn" onClick={() => setPasting(true)}>Paste from Excel</button>
        </div>
        {c._fetched ? <FetchNote f={c._fetched} company={company} /> : <div className="fb-s">The latest year is the entry year: entry EBITDA, the balance sheet refinanced and the cash available come from it.</div>}
      </div>
      <div className="hint">✎ Click any blue number to change it · paste a block of numbers straight from Excel · the trend and CAGR update as you type</div>
      <StatementPanels page={c.page} onChange={(page) => setCo((cur) => ({ ...cur, page }))} n={n} labels={lab.hist} toggle={S(data).lease === 0 ? 0 : 1} company={company} />
      {pasting && <PasteDialog mode="page" page={c.page} n={n} columns={lab.hist.map((l, i) => ({ id: i, label: l }))} onApply={(pg) => setCo((cur) => ({ ...cur, page: pg }))} onClose={() => setPasting(false)} />}
    </>
  );
}

export const lboCompanyStep = () => ({
  id: 'lboCompany',
  title: 'Company & historicals',
  blurb: 'The historical income statement, balance sheet and cash flow (the template’s Historicals sheet). Entry EBITDA is the latest actual year’s.',
  fields: () => [],
  Extra: CompanyExtra,
  extraBelow: true,
  Layout: LboCompanyLayout,
  summary: (data, ctx) => { const l = labelsOf(data, ctx.company).hist; return l.length ? `${l[0]}–${l[l.length - 1]}` : null; },
  validate: (data, ctx) => latestYearErrors(resultOf(ctx.company, data), ctx.company, 'entry EBITDA and the projections'),
});

/* ============================ Assumptions ============================ */

function AssumptionsExtra({ data, setData, company }) {
  const r = resultOf(company, data);
  if (!r) return null;
  const locale = CURRENCIES[company.currency]?.locale;
  const unit = `${CURRENCIES[company.currency]?.symbol || ''} ${UNITS[company.unit] || ''}`.trim();
  const n = r.n;
  const rows = [
    ['Revenue', r.F.rev.slice(n), 'n1'], ['EBITDA', r.F.ebitda.slice(n), 'n1'], ['EBITDA margin', r.F.margin.slice(n), 'pct'],
    ['Capex', r.F.capex.slice(n), 'n1'], ['Increase in NWC', r.F.dNwc.slice(n), 'n1'],
  ];
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Operating drivers</div>
        <DriversView Grid={DriversGrid} defs={LBO_DRIVERS} drivers={data.lbo.drivers} onChange={(drivers) => setData((d) => ({ ...d, lbo: { ...d.lbo, drivers } }))}
          m={r.m} labels={r.labels} refs={r.ref} locale={locale} unitLabel={unit} emptyHist={emptyHistYears(r)} />
      </div>
      <div className="tool-card">
        <div className="tool-h">What the drivers give <span className="fld-opt">{unit}</span></div>
        <div className="tablewrap">
          <table className="fin compact">
            <thead><tr><th />{r.labels.fcst.map((l) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>{rows.map(([lab, vals, fmt]) => <tr key={lab}><td>{lab}</td>{vals.map((v, j) => <td key={j}>{fmtTpl(v, fmt, locale)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="fld-h">Other income is not forecast in the LBO (existing treasury income largely disappears once cash is used in the deal). Tax = max(0, PBT after LBO interest) × rate.</div>
      </div>
    </div>
  );
}

export const lboDriversStep = () => ({
  id: 'lboDrivers',
  title: 'Assumptions',
  blurb: 'One value per holding-period year for each operating driver — the historical ratios sit beside them for reference. A blank cell counts as 0, as in the template.',
  fields: () => [],
  Extra: AssumptionsExtra,
  extraBelow: true,
});

/* ========================= Transaction & debt ========================= */

function TranchesCard({ data, setData, company, r }) {
  const repay = S(data).repay;
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const unit = UNITS[company.unit] || '';
  const set = (k, field, v) => setData((d) => ({ ...d, lbo: { ...d.lbo, debt: { ...d.lbo.debt, [k]: { ...(d.lbo.debt?.[k] || {}), [field]: v } } } }));
  const val = (k, field) => data.lbo.debt?.[k]?.[field] ?? null;
  const cell = (k, field, ph) => <td className="tp-in"><NumBox small value={val(k, field)} onChange={(v) => set(k, field, v)} placeholder={ph} /></td>;
  return (
    <div className="tool-card">
      <div className="tool-h">Debt financing <span className="fld-opt">blank = 0</span></div>
      <div className="tablewrap tp-grid">
        <table className="fin compact lbo-tr">
          <thead>
            <tr><th>Tranche</th><th>x Entry EBITDA</th><th>Amount ({sym} {unit})</th><th>Cash interest %</th><th>PIK interest %</th><th>Mandatory amort. % of original p.a.</th><th>Tenor (years)</th><th>Financing fee %</th><th>Financing fee</th></tr>
          </thead>
          <tbody>
            {TRANCHES.map((t) => {
              const e = r?.tranches?.[t.key];
              return (
                <tr key={t.key}>
                  <td>{t.label}</td>
                  {cell(t.key, 'x', 'x')}
                  <td>{fmtTpl(e?.amount, 'n1', locale)}</td>
                  {cell(t.key, 'rate', '%')}
                  {t.key === 'mezz' ? cell(t.key, 'pik', '%') : <td className="tp-na tp-mute">n.a.</td>}
                  {t.key === 'mezz' ? <td className="tp-mute">Bullet at exit</td> : repay === 'sweep' ? <td className="tp-na tp-mute">n.a. (sweep only)</td> : cell(t.key, 'amort', '%')}
                  {cell(t.key, 'tenor', 'yrs')}
                  {cell(t.key, 'feePct', '%')}
                  <td>{fmtTpl(e?.fee, 'n1', locale)}</td>
                </tr>
              );
            })}
            <tr className="tp-sub"><td>Total debt</td><td>{fmtTpl(r?.totalDebt?.x, 'x', locale)}</td><td>{fmtTpl(r?.totalDebt?.amount, 'n1', locale)}</td><td /><td /><td /><td /><td /><td>{fmtTpl(r?.totalDebt?.fee, 'n1', locale)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="fld-h">
        e.g. Senior A 2.5x, 9.0%{repay === 'sweep' ? '' : ', 15.0% p.a.'}, 5 yrs, 1.5% | Senior B 1.5x, 10.0%{repay === 'sweep' ? '' : ', 1.0% p.a.'}, 7 yrs, 2.0% | Mezz 1.0x, 12.0% cash, 3.0% PIK, 8 yrs, 2.5%.
        Interest on each tranche’s opening balance; financing fees amortised straight-line over the tenor (non-cash, tax-deductible).
      </div>
    </div>
  );
}

function TransactionExtra({ data, setData, company }) {
  const r = resultOf(company, data);
  const locale = CURRENCIES[company.currency]?.locale;
  return (
    <div className="step-tools">
      <TranchesCard data={data} setData={setData} company={company} r={r} />
      {r && (
        <div className={`readout${r.su.sponsor < 0 || r.entry.cashWarn ? ' warn' : ''}`}>
          Entry EBITDA <b>{fmtTpl(r.entry.ebitda, 'n1', locale)}</b> · Entry EV <b>{fmtTpl(r.entry.ev, 'n1', locale)}</b> · Equity purchase price <b>{fmtTpl(r.entry.equityPrice, 'n1', locale)}</b> ·
          {' '}Sponsor equity <b className="acc">{fmtTpl(r.su.sponsor, 'n1', locale)}</b> ({pct1(r.su.stats.equityPct)} of sources)
          {r.su.sponsor < 0 && ' — sponsor equity is negative: the structure is over-levered.'}
          {r.entry.cashWarn && ` — the existing cash used exceeds the existing cash (${fmtTpl(r.entry.cash, 'n1', locale)}).`}
        </div>
      )}
    </div>
  );
}

/** Transaction & debt exactly as the approved sample (LBO page 4, option A): uses must equal sources. */
function LboTransactionLayout({ data, setData, company, F }) {
  const r = resultOf(company, data);
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const m = (x) => (fin(x) ? `${sym}${fmtNum(x, 0, locale)}` : '—');
  const su = r?.su;
  const uses = su ? [['Equity purchase price', su.uses[0], 'u1'], ['Debt refinanced', su.uses[1], 'u2'], ['Transaction fees', su.uses[2], 'u3'], ['Financing fees', su.uses[3], 'u3']] : [];
  const srcs = su ? [['Senior A', su.sources[0], 's1'], ['Senior B', su.sources[1], 's2'], ['Mezzanine', su.sources[2], 's3'], ['Existing cash', su.sources[3], 's4'], [`Sponsor equity ${fin(su.stats.equityPct) ? (su.stats.equityPct * 100).toFixed(0) + '%' : ''}`, su.sources[4], 's5']] : [];
  const stack = (rows) => (
    <div className="colstack">{rows.filter((x) => fin(x[1]) && x[1] > 0).map(([l, v, c]) => (
      <div key={l} className={`cs ${c}`} style={{ flex: v }}><span>{l}</span><b>{m(v)}</b></div>
    ))}</div>
  );
  const cover = r?.C?.intCover?.[0];
  return (
    <div className="gLb">
      <div className="col16">
        <div className="box2">
          <div className="su2">
            <div>
              <h3>Uses · {m(su?.totalUses)}</h3>
              {su ? stack(uses) : <div className="empty-s">Fill the earlier steps first.</div>}
              <div className="g2f">{F('lbo.deal.entryMultiple', { label: 'Entry EV / EBITDA' })}{F('lbo.deal.txnFeePct', { label: 'Transaction fees' })}</div>
            </div>
            <div>
              <h3>Sources · {m(su?.totalSources)}</h3>
              {su && stack(srcs)}
              <div className="g2f">{F('lbo.deal.cashUsed', { label: 'Existing cash used' })}</div>
            </div>
          </div>
        </div>
        <div className="box2">
          <h3>Debt package</h3>
          <TranchesCard data={data} setData={setData} company={company} r={r} />
          <div className="g3f">{F('lbo.cash.minCash')}{F('lbo.cash.sweepPct', { label: 'Cash sweep' })}{F('lbo.cash.rcf', { label: 'Revolver commitment' })}{F('lbo.cash.rcfRate', { label: 'Revolver rate' })}{F('lbo.cash.rcfFee', { label: 'Undrawn fee' })}</div>
        </div>
      </div>
      <div className="col16 stick">
        <LboLiveCard company={company} data={data} />
        <div className="box2">
          <h3>Checks</h3>
          <div className="kv3"><span>Sources = uses</span>{!su || !fin(su.check) ? <b className="fa">—</b> : Math.abs(su.check) < 0.05 ? <b className="up">✓ {m(su.totalUses)}</b> : <b className="dn">✕ off by {m(su.check)}</b>}</div>
          <div className="kv3"><span>Interest cover year 1</span><b>{fin(cover) ? `${cover.toFixed(1)}x` : '—'}</b></div>
          <div className="kv3"><span>Equity share</span><b className={su && su.sponsor < 0 ? 'dn' : ''}>{su ? pct1(su.stats.equityPct) : '—'}</b></div>
          {r?.entry?.cashWarn && <div className="warn2 sm">The existing cash used exceeds the cash on the balance sheet.</div>}
          {su && su.sponsor < 0 && <div className="warn2 sm">Sponsor equity is negative — the structure is over-levered.</div>}
        </div>
      </div>
    </div>
  );
}

export const lboTransactionStep = () => ({
  id: 'lboTransaction',
  title: 'Transaction & debt',
  blurb: 'The entry price, fees, the debt package and — for a cash sweep — how excess cash repays the senior debt.',
  fields: (data) => [
    f.x('lbo.deal.entryMultiple', 'Entry EV / EBITDA multiple', { hint: 'e.g. 10.0x — on the latest actual year’s EBITDA' }),
    f.money('lbo.deal.cashUsed', 'Existing cash used to fund the deal', { required: false, hint: 'e.g. 400.0 – must not exceed existing cash. Blank = 0.' }),
    f.pct('lbo.deal.txnFeePct', 'Transaction fees (% of entry EV)', { required: false, min: 0, hint: 'e.g. 2.0% – advisory, legal, due diligence, stamp duty. Blank = 0.' }),
    ...(S(data).repay === 'mandatory'
      ? [f.money('lbo.cash.minCash', 'Minimum cash balance', { required: false, hint: 'e.g. 150.0 – operating cash kept in the business; the revolver draws to protect it. Blank = 0.' })]
      : [
        f.pct('lbo.cash.sweepPct', 'Cash sweep (% of excess cash)', { min: 0, max: 100, hint: 'e.g. 100.0% – share of excess cash used to prepay senior debt' }),
        f.money('lbo.cash.minCash', 'Minimum cash balance', { hint: 'e.g. 150.0 – operating cash kept in the business' }),
      ]),
    f.money('lbo.cash.rcf', 'Revolving credit facility – commitment', { required: false, hint: 'e.g. 300.0 – undrawn at close; draws automatically to cover shortfalls. Blank or 0 = no revolver.' }),
    f.pct('lbo.cash.rcfRate', 'Revolver interest rate (on drawn balance)', { required: false, min: 0, hint: 'e.g. 9.0% – on the opening drawn balance. Blank = 0.' }),
    f.pct('lbo.cash.rcfFee', 'Revolver commitment fee (on undrawn amount)', { required: false, min: 0, hint: 'e.g. 0.5% – on the opening undrawn commitment. Blank = 0.' }),
  ],
  Extra: TransactionExtra,
  extraBelow: true,
  Layout: LboTransactionLayout,
  summary: (data) => { const d = data.lbo?.deal || {}; const db = data.lbo?.debt || {}; const x = ['senA', 'senB', 'mezz'].reduce((a, k) => a + (fin(db[k]?.x) ? db[k].x : 0), 0); return fin(d.entryMultiple) ? `${d.entryMultiple.toFixed(1)}x · ${x.toFixed(1)}x debt` : null; },
});

/* ========================= Exit & sensitivity ========================= */

function ExitReadout({ data, company }) {
  const r = resultOf(company, data);
  if (!r) return null;
  const bad = r.C.shortfall.some((x) => x === 'SHORTFALL');
  return (
    <div className={`readout${bad ? ' warn' : ''}`}>
      IRR <b className="acc">{pct1(r.irr)}</b> · MOIC <b>{fin(r.moic) ? `${r.moic.toFixed(2)}x` : 'NM'}</b> · exit equity <b>{fmtTpl(r.exit.equity, 'n1', CURRENCIES[company.currency]?.locale)}</b>
      {bad && ' — cash goes negative in at least one year even after the revolver: the structure would need a larger revolver or lower leverage.'}
    </div>
  );
}

/** Exit & sensitivity exactly as the approved sample (LBO page 5, option A). */
function LboExitLayout({ data, company, F }) {
  const r = resultOf(company, data);
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  const m = (x) => (fin(x) ? `${sym}${fmtNum(x, 0, locale)} ${UNITS[company.unit] || ''}` : '—');
  const bad = r?.C?.shortfall?.some((x) => x === 'SHORTFALL');
  const em = data.lbo?.deal?.entryMultiple, xm = data.lbo?.deal?.exitMultiple;
  return (
    <>
      <div className="g2b">
        <div className="opt2 on">
          <div className="opt2-k"><span className="radio2" />EXIT MULTIPLE · IN USE</div>
          <div className="opt2-r">
            <div>{F('lbo.deal.exitMultiple', { label: 'Exit EV / EBITDA' })}</div>
            <div><div className="lbl">Gives</div><div className="mid2">{r && fin(r.irr) ? `${(r.irr * 100).toFixed(1)}% IRR` : '—'} <span>{r && fin(r.moic) ? `· ${r.moic.toFixed(2)}x` : ''}</span></div></div>
          </div>
          <p>{r ? `Exit EV ${m(r.exit.ev)} on ${r.labels.fcst[r.m - 1]} EBITDA ${m(r.exit.ebitda)} · exit equity ${m(r.exit.equity)}` : 'Fill the earlier steps to see the exit.'}</p>
        </div>
        <div className="box2">
          <div className="lbl">For reference</div>
          <div className="kv3"><span>Entry multiple</span><b>{fin(em) ? `${em.toFixed(1)}x` : '—'}</b></div>
          <div className="kv3"><span>Exit vs entry</span><b className={fin(em) && fin(xm) && xm < em ? 'dn' : 'up'}>{fin(em) && fin(xm) ? `${xm >= em ? '+' : '−'}${Math.abs(xm - em).toFixed(1)}x` : '—'}</b></div>
          <div className="hint" style={{ marginTop: 8 }}>Exiting below the entry multiple (multiple contraction) is the cautious case.</div>
          {bad && <div className="warn2 sm">Cash goes negative in at least one year even after the revolver — a larger revolver or lower leverage is needed.</div>}
        </div>
      </div>
      <div className="gLb">
        <div className="box2">
          <h3>IRR sensitivity</h3>
          <div className="box2-s">entry multiple across, exit multiple down · base outlined</div>
          {r?.sens ? (
            <div style={{ marginTop: 10 }}>
              <Heatmap corner="Exit ↓ · Entry →" rowLabels={r.sens.exitRows} colLabels={r.sens.entryRows}
                grid={r.sens.exitRows.map((_, i) => r.sens.entryRows.map((__, j) => { const v = r.sens.multIrr[j]?.[i]; return fin(v) ? v * 100 : NaN; }))}
                fmt={(v) => `${v.toFixed(1)}%`} fmtRow={(v) => fmtTpl(v, 'x', locale)} fmtCol={(v) => fmtTpl(v, 'x', locale)} />
            </div>
          ) : <div className="empty-s">Fill the earlier steps to see the sensitivity.</div>}
        </div>
        <div className="box2">
          <h3>Sensitivity steps</h3>
          <div className="col12">{F('lbo.settings.exitStep', { label: 'Exit multiple step' })}{F('lbo.settings.entryStep', { label: 'Entry multiple step' })}{F('lbo.settings.growthStep', { label: 'Revenue growth shift step' })}</div>
        </div>
      </div>
    </>
  );
}

export const lboExitStep = () => ({
  id: 'lboExit',
  title: 'Exit & sensitivity',
  blurb: 'The exit multiple at the end of the holding period, and the step sizes of the returns sensitivity tables.',
  fields: () => [
    f.x('lbo.deal.exitMultiple', 'Exit EV / EBITDA multiple', { hint: 'e.g. 10.0x – often set equal to the entry multiple as a base case' }),
    f.x('lbo.settings.exitStep', 'Sensitivity: exit multiple step', { hint: 'Template example 1.0x' }),
    f.x('lbo.settings.entryStep', 'Sensitivity: entry multiple step', { hint: 'Template example 1.0x' }),
    f.pct('lbo.settings.growthStep', 'Sensitivity: revenue growth shift step', { gt: 0, hint: 'e.g. 2.0% – shifts each year’s growth by ± this amount' }),
  ],
  Readout: ExitReadout,
  Layout: LboExitLayout,
  summary: (data) => (fin(data.lbo?.deal?.exitMultiple) ? `exit ${data.lbo.deal.exitMultiple.toFixed(1)}x` : null),
});
