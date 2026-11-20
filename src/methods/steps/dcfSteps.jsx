import React from 'react';
import { f } from '../fields.js';
import { NumBox } from '../../wizard/Field.jsx';
import TemplatePageEditor from '../../components/TemplatePageEditor.jsx';
import DriversGrid from '../../components/DriversGrid.jsx';
import { YahooSearch, mergeFetch } from '../../components/PeerYahoo.jsx';
import { FetchNote } from './templateSteps.jsx';
import { toEngineInput } from '../../store/methodModel.js';
import {
  CF_KINDS, TV_KINDS, COE_KINDS, exitMultipleName, templateName, computeDcfT, dcfLabels, clampN, betaPeers, dcfDriverDefs, midYearDefault,
} from '../../lib/engine/dcfTemplate.js';
import { MIN_YEARS, MAX_YEARS } from '../../lib/engine/companyPage.js';
import { fmtNum, fmtTpl, CURRENCIES, UNITS } from '../../lib/format.js';
import { YearCheck } from '../../home/CompanyForms.jsx';
import { updateCompany } from '../../store/store.js';

/**
 * Wizard steps for the DCF, following the user's twelve DCF templates:
 *   Settings · Company & historicals · Assumptions · Discount rate · Terminal value
 * The Settings step picks the combination (FCFF / FCFE / DDM × Gordon Growth /
 * Exit Multiple × CAPM / Build-Up); the other steps ask only what that
 * combination's template asks. Blank cells behave as in the templates (0).
 */

const fin = Number.isFinite;
const pid = () => `bp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const S = (data) => data.dcf?.settings || {};
const nHist = (data) => clampN(S(data).histYears, 3);
const nFcst = (data) => clampN(S(data).fcstYears, 5);
const labelsOf = (data, company) => dcfLabels(S(data).labels, nHist(data), nFcst(data), company?.startYear);
const pct2 = (v) => (fin(v) ? `${(v * 100).toFixed(2)}%` : 'NM');

/** The whole engine on the current data (null when it cannot run yet). */
function resultOf(company, data) {
  try { return computeDcfT(toEngineInput(company, data)); } catch { return null; }
}

/** Historical years with no revenue (blank or 0): they hold no figures. */
export const emptyHistYears = (r) => (r ? r.F.rev.slice(0, r.n).map((v) => !(fin(v) && v !== 0)) : []);

/**
 * The latest actual year is the base the forecast grows from (DCF) or the entry
 * year (LBO). With no revenue there, every forecast year starts from 0 and the
 * value comes out as 0 — stop on the step and say how to fix it.
 */
export function latestYearErrors(r, company, what) {
  if (!r) return [];
  const empty = emptyHistYears(r);
  if (!empty.length || !empty[empty.length - 1]) return [];
  const lab = r.labels.hist;
  const last = lab[lab.length - 1];
  const k = empty.lastIndexOf(false);
  if (k < 0) return [`No historical year has revenue yet — fill the historicals (or use Yahoo) before continuing.`];
  const blank = lab.slice(k + 1);
  const year1 = Number.isInteger(company?.startYear) ? company.startYear - (lab.length - 1 - k) : null;
  return [`${blank.join(', ')} ${blank.length === 1 ? 'has' : 'have'} no figures, but ${last} is the latest actual year — ${what} would start from 0 and the result would be 0. `
    + `The latest year with figures is ${lab[k]}: ${year1 ? `set Year 1 to ${year1} in Company settings (so ${lab[k]} becomes the latest actual year)` : `move Year 1 earlier in Company settings`}, or fill ${blank.join(' and ')}.`];
}

/* ============================== Settings ============================== */

/** Period-label editor for the DCF / LBO templates (historical + forecast labels). */
export function PeriodLabelsCard({ labels, onChange, latestName = 'Historical (latest actual)', fcstName = (i) => `Forecast year ${i + 1}` }) {
  const set = (part, i, v) => {
    const next = { hist: [...labels.hist], fcst: [...labels.fcst] };
    next[part][i] = v;
    onChange(next);
  };
  return (
    <div className="tool-card">
      <div className="tool-h">Period labels <span className="fld-opt">labels only — change freely</span></div>
      <div className="lab-grid">
        {labels.hist.map((l, i) => (
          <label key={`h${i}`}>{i === labels.hist.length - 1 ? latestName : `Historical year ${i + 1}`}<input className="fld-in txt" value={l} onChange={(e) => set('hist', i, e.target.value)} /></label>
        ))}
        {labels.fcst.map((l, i) => (
          <label key={`f${i}`}>{fcstName(i, labels.fcst.length)}<input className="fld-in txt" value={l} onChange={(e) => set('fcst', i, e.target.value)} /></label>
        ))}
      </div>
    </div>
  );
}

function DcfLabelsEditor({ data, setData, company }) {
  const s = S(data);
  return (
    <div className="step-tools">
      <YearCheck startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} onUse={(y) => company?.id && updateCompany(company.id, { startYear: y })} />
      <PeriodLabelsCard labels={dcfLabels(s.labels, nHist(data), nFcst(data), company?.startYear, { keepBlank: true })} onChange={(labels) => setData((d) => ({ ...d, dcf: { ...d.dcf, settings: { ...d.dcf.settings, labels } } }))} />
      {s.cf && s.tv && s.coe && (
        <div className="readout">
          Template <b>{templateName(s)}.xlsx</b> — {CF_KINDS.find((k) => k.value === s.cf)?.long}, terminal value by {s.tv === 'exit' ? `exit ${exitMultipleName(s.cf)}` : 'Gordon growth'}, cost of equity by {s.coe === 'capm' ? 'CAPM' : 'the build-up method'}.
        </div>
      )}
    </div>
  );
}

export const dcfSettingsStep = () => ({
  id: 'dcfSettings',
  title: 'Settings',
  blurb: 'Which DCF you run — the cash flow, the terminal value and the cost of equity pick one of the twelve templates — and how many historical and forecast years it carries.',
  fields: (data) => [
    f.choice('dcf.settings.cf', 'Cash flow discounted', CF_KINDS.map((k) => ({ value: k.value, label: `${k.label} — ${k.long}`, hint: k.note }))),
    f.choice('dcf.settings.tv', 'Terminal value', TV_KINDS.map((k) => ({
      value: k.value,
      label: k.value === 'exit' ? `Exit multiple (${S(data).cf ? exitMultipleName(S(data).cf) : 'EV / EBITDA for FCFF, P / E otherwise'})` : k.label,
      hint: k.note,
    }))),
    f.choice('dcf.settings.coe', 'Cost of equity', COE_KINDS.map((k) => ({ value: k.value, label: k.label, hint: k.note }))),
    f.int('dcf.settings.histYears', 'Historical years', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 3.` }),
    f.int('dcf.settings.fcstYears', 'Forecast years', { min: MIN_YEARS, max: MAX_YEARS, hint: `${MIN_YEARS} to ${MAX_YEARS}. Template: 5.` }),
    f.date('dcf.settings.valDate', 'Valuation date', { hint: 'Date the value is struck (e.g. today). Cash flows are discounted from this date; leave blank to value at the fiscal year end below.' }),
    f.date('dcf.settings.fyEnd', 'Latest fiscal year end', { hint: 'Balance sheet date of the latest actual year, e.g. 31-Mar-2026. Forecast Year 1 ends 12 months later; with the valuation date it sets the stub (the part of Year 1 still to come).' }),
    f.choice('dcf.settings.lease', 'Include lease liabilities in net debt?', [
      { value: 1, label: 'Yes (1) — leases are debt' }, { value: 0, label: 'No (0) — leases are an operating cost' },
    ], { hint: S(data).cf === 'ddm' ? 'Not used by the DDM value; kept for consistency with the FCFF / CCA workbooks.'
      : S(data).cf === 'fcfe' ? 'FCFE always deducts lease cash payments. Toggle kept for consistency with the FCFF / CCA workbooks.'
        : '1 = lease liabilities in net debt & WACC, FCFF deducts new lease additions. 0 = FCFF deducts lease payments, liabilities excluded. Template: 1.' }),
    f.choice('dcf.settings.midYear', 'Mid-year discounting convention?', [
      { value: 1, label: 'Yes (1) — cash flows arrive evenly through the year' }, { value: 0, label: 'No (0) — end of year' },
    ], { required: false, hint: `Blank = the template's default: ${S(data).cf ? (midYearDefault(S(data).cf) ? 'on (1)' : 'off (0)') : 'on (1) for FCFF / FCFE, off (0) for the DDM'}. DDM default 0: dividends are paid as lump sums.` }),
    f.choice('dcf.settings.normalise', 'Normalise the terminal year?', [
      { value: 1, label: 'Yes (1)' }, { value: 0, label: 'No (0) — grow the final-year cash flow' },
    ], { required: false, hint: S(data).cf === 'ddm' ? "Blank = the template's default (1): terminal payout = 1 − g ÷ ROE (sustainable growth)."
      : S(data).cf === 'fcfe' ? "Blank = the template's default (1): Year N+1 FCFE grows at g, invests g × NWC and borrows g × debt."
        : "Blank = the template's default (1): Year N+1 FCFF grows every line at g and invests g × NWC." }),
  ],
  Extra: DcfLabelsEditor,
  extraBelow: true,
});

/* ======================= Company & historicals ======================= */

function CompanyExtra({ data, setData, company }) {
  const c = data.dcf.company;
  const n = nHist(data);
  const lab = labelsOf(data, company);
  const setCo = (fn) => setData((d) => ({ ...d, dcf: { ...d.dcf, company: fn(d.dcf.company) } }));
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Fill from Yahoo Finance <span className="fld-opt">optional</span></div>
        <YahooSearch company={company} action="Fill the historicals" onPick={(m) => setCo((cur) => mergeFetch(cur, m, company, { n, alignTo: lab.hist }))} />
        {c._fetched && <FetchNote f={c._fetched} company={company} />}
      </div>
      <div className="tool-card">
        <div className="tool-h">{company.name} — historical financials</div>
        <TemplatePageEditor
          historicals page={c.page} onChange={(page) => setCo((cur) => ({ ...cur, page }))}
          n={n} labels={{ fy: lab.hist, p: '', c: '', ltm: '' }} toggle={S(data).lease === 0 ? 0 : 1} company={company}
          notes={<div className="fld-h">Consolidated. {n} fiscal year{n === 1 ? '' : 's'}, oldest first — the latest is the base the forecast grows from.</div>}
        />
      </div>
    </div>
  );
}

export const dcfCompanyStep = () => ({
  id: 'dcfCompany',
  title: 'Company & historicals',
  blurb: 'Share data and the historical income statement, balance sheet and cash flow (the template’s Historicals sheet).',
  fields: () => [
    f.text('dcf.company.ticker', 'NSE / BSE ticker'),
    f.price('dcf.company.price', 'Current share price', { required: false, hint: 'For the upside and, in an FCFF, the market-value weights shown for reference.' }),
    f.shares('dcf.company.shares', 'Diluted shares outstanding', { hint: 'Value per share = equity value ÷ diluted shares.' }),
  ],
  Extra: CompanyExtra,
  extraBelow: true,
  validate: (data, ctx) => latestYearErrors(resultOf(ctx.company, data), ctx.company, 'the forecast'),
});

/* ============================ Assumptions ============================ */

function AssumptionsExtra({ data, setData, company }) {
  const r = resultOf(company, data);
  if (!r) return null;
  const locale = CURRENCIES[company.currency]?.locale;
  const unit = `${CURRENCIES[company.currency]?.symbol || ''} ${UNITS[company.unit] || ''}`.trim();
  const setDrivers = (drivers) => setData((d) => ({ ...d, dcf: { ...d.dcf, drivers } }));
  const n = r.n, m = r.m;
  const F = r.F;
  const cashLabel = r.cf === 'fcff' ? 'Free cash flow to firm' : r.cf === 'fcfe' ? 'Free cash flow to equity' : 'Dividends';
  const rows = [
    ['Revenue', F.rev.slice(n), 'n1'], ['EBITDA', F.ebitda.slice(n), 'n1'], ['EBITDA margin', F.margin.slice(n), 'pct'],
    ['PAT', F.pat.slice(n), 'n1'], [cashLabel, r.flows.cash, 'n1'],
  ];
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Forecast drivers</div>
        <DriversGrid drivers={data.dcf.drivers} onChange={setDrivers} m={m} labels={r.labels} refs={r.ref} locale={locale} unitLabel={unit} defs={dcfDriverDefs(r.cf)} emptyHist={emptyHistYears(r)} />
      </div>
      <div className="tool-card">
        <div className="tool-h">What the drivers give <span className="fld-opt">{unit}</span></div>
        <div className="tablewrap">
          <table className="fin compact">
            <thead><tr><th />{r.labels.fcst.map((l) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              {rows.map(([lab, vals, fmt]) => (
                <tr key={lab}><td>{lab}</td>{vals.map((v, j) => <td key={j}>{fmtTpl(v, fmt, locale)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fld-h">Capex and costs as positive % of revenue; working capital on closing balances (365 days); interest = opening debt × rate; tax = max(0, PBT) × rate; exceptional items, associates and NCI are not forecast.</div>
      </div>
    </div>
  );
}

export const dcfDriversStep = () => ({
  id: 'dcfDrivers',
  title: 'Assumptions',
  blurb: 'One value per forecast year for each driver — the historical ratios sit beside them for reference. A blank cell counts as 0, as in the template.',
  fields: () => [],
  Extra: AssumptionsExtra,
  extraBelow: true,
});

/* ============================ Discount rate ============================ */

function BetaPeersCard({ data, setData }) {
  const cp = data.dcf.capm || {};
  const peers = cp.peers || [];
  const setCapm = (fn) => setData((d) => ({ ...d, dcf: { ...d.dcf, capm: fn(d.dcf.capm || {}) } }));
  const setPeers = (fn) => setCapm((c) => ({ ...c, peers: fn(c.peers || []) }));
  const st = betaPeers(cp);
  const b3 = (v) => (fin(v) ? fmtNum(v, 3, 'en-US') : '—');
  const use = (v) => setCapm((c) => ({ ...c, betaMode: 'hamada', peerBeta: Math.round(v * 1000) / 1000 }));
  return (
    <div className="tool-card">
      <div className="tool-h">Beta from comparable companies <span className="fld-opt">optional — Hamada</span></div>
      <div className="fld-h" style={{ marginBottom: 8 }}>
        Each peer’s levered beta is unlevered at its own debt / equity and tax rate: βu = βL ÷ (1 + (1 − t) × D/E). Use the mean or median as the peer unlevered beta; it is re-levered at your target D/E.
      </div>
      {peers.length > 0 && (
        <table className="fin compact bp-table">
          <thead><tr><th>Peer</th><th>Levered beta</th><th>D / E (%)</th><th>Tax (%)</th><th>Unlevered beta</th><th /></tr></thead>
          <tbody>
            {st.rows.map((p) => (
              <tr key={p.id}>
                <td><input className="fld-in txt" value={p.name || ''} placeholder="Name" onChange={(e) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} /></td>
                {['beta', 'de', 'taxRate'].map((k) => (
                  <td key={k}><NumBox small value={p[k] ?? null} onChange={(v) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, [k]: v } : x)))} /></td>
                ))}
                <td className="calc">{b3(p.bu)}</td>
                <td><button className="peer-del" title="Remove" onClick={() => setPeers((ps) => ps.filter((x) => x.id !== p.id))}>×</button></td>
              </tr>
            ))}
            <tr className="bold"><td>Mean</td><td /><td /><td /><td className="calc">{b3(st.mean)}</td><td /></tr>
            <tr className="bold"><td>Median</td><td /><td /><td /><td className="calc">{b3(st.median)}</td><td /></tr>
          </tbody>
        </table>
      )}
      <div className="row-btns">
        <button className="btn sm" onClick={() => setPeers((ps) => [...ps, { id: pid(), name: '', beta: null, de: null, taxRate: null }])}>+ Add peer</button>
        {fin(st.median) && <button className="btn sm" onClick={() => use(st.median)}>Use median βu ({b3(st.median)})</button>}
        {fin(st.mean) && <button className="btn sm" onClick={() => use(st.mean)}>Use mean βu ({b3(st.mean)})</button>}
      </div>
    </div>
  );
}

function RateExtra({ data, setData }) {
  if (S(data).coe !== 'capm') return null;
  return <div className="step-tools"><BetaPeersCard data={data} setData={setData} /></div>;
}

function RateReadout({ data, company }) {
  const r = resultOf(company, data);
  if (!r) return null;
  const w = r.wacc;
  return (
    <div className="readout">
      {r.coeKind === 'capm' && <>Beta <b>{fmtNum(r.coe.beta, 3, 'en-US')}</b> · </>}
      Cost of equity <b className={w ? '' : 'acc'}>{pct2(r.coe.ke)}</b>
      {w && <> · After-tax Kd <b>{pct2(w.kdAfter)}</b> · Current D/(D+E) <b>{pct2(w.currentWd)}</b> (reference) · WACC <b className="acc">{pct2(w.wacc)}</b></>}
    </div>
  );
}

export const dcfRateStep = () => ({
  id: 'dcfRate',
  title: 'Discount rate',
  blurb: 'The cost of equity (CAPM or build-up) and, for an FCFF, the WACC.',
  fields: (data) => {
    const s = S(data);
    const cp = data.dcf?.capm || {};
    const out = [];
    if (s.coe === 'buildup') {
      out.push(
        f.pct('dcf.buildup.rf', 'Risk-free rate', { hint: 'e.g. 6.5% – 10-year Government of India bond yield on the valuation date' }),
        f.pct('dcf.buildup.erp', 'Equity risk premium', { hint: 'e.g. 7.0% – state your source' }),
        f.pct('dcf.buildup.size', 'Size premium', { required: false, hint: 'e.g. 2.0% for small / mid-size companies; 0% for large caps. Blank = 0.' }),
        f.pct('dcf.buildup.industry', 'Industry risk premium (+/−)', { required: false, hint: 'e.g. 1.0% – can be negative for low-risk industries. Blank = 0.' }),
        f.pct('dcf.buildup.specific', 'Company-specific risk premium', { required: false, hint: 'e.g. 1.5% – key-person risk, customer concentration, governance. Blank = 0.' }),
        f.pct('dcf.buildup.country', 'Country risk premium', { required: false, hint: 'e.g. 0.0% – usually 0% with an INR risk-free rate for an Indian company. Blank = 0.' }),
      );
    } else {
      out.push(
        f.pct('dcf.capm.rf', 'Risk-free rate', { hint: 'e.g. 6.5% – 10-year Government of India bond yield on the valuation date (RBI / CCIL)' }),
        f.pct('dcf.capm.erp', 'Equity risk premium', { hint: 'e.g. 7.0% – state your source (e.g. Damodaran India ERP)' }),
        f.choice('dcf.capm.betaMode', 'Beta', [
          { value: 'direct', label: 'Levered beta typed', hint: 'e.g. a regression against the Nifty 50 (2–5 years)' },
          { value: 'hamada', label: 'Re-levered from a peer unlevered beta', hint: 'βL = βu × (1 + (1 − t) × D/E)' },
        ]),
      );
      if (cp.betaMode === 'hamada') {
        out.push(
          f.num('dcf.capm.peerBeta', 'Peer average unlevered beta (βu)', { gt: 0, hint: 'e.g. 0.85 — or use the peer list below' }),
          f.pct('dcf.capm.targetDe', 'Company target debt / equity', { min: 0, hint: 'e.g. 15.0% – consistent with the target weight used in the WACC' }),
          f.pct('dcf.capm.taxRate', 'Marginal tax rate (for re-levering)', { min: 0, max: 100, hint: 'e.g. 25.2%' }),
        );
      } else if (cp.betaMode === 'direct') {
        out.push(f.num('dcf.capm.beta', 'Levered beta', { hint: 'e.g. 1.05' }));
      }
    }
    if (s.cf === 'fcff') {
      out.push(
        f.pct('dcf.wacc.kd', 'Pre-tax cost of debt', { min: 0, hint: 'e.g. 8.5% – current borrowing rate / rating-based yield' }),
        f.pct('dcf.wacc.taxRate', 'Marginal tax rate', { min: 0, max: 100, hint: 'e.g. 25.2% (Sec 115BAA incl. surcharge & cess) – confirm for the company' }),
        f.pct('dcf.wacc.targetWd', 'Target D / (D + E)', { min: 0, lt: 100, hint: 'e.g. 15.0% – long-run target; peer median or the current weight are common choices' }),
        f.money('dcf.wacc.nonOpOverride', 'Override: non-operating investments to add', { required: false, hint: 'Blank = the non-current investments on the latest balance sheet. Enter fair / market value if known; exclude any investment whose income is inside EBITDA.' }),
        f.money('dcf.wacc.netDebtOverride', 'Override: net debt at the valuation date', { required: false, min: undefined, hint: 'Blank = net debt on the latest balance sheet. Use when the valuation date is after it (e.g. the latest quarterly net debt).' }),
      );
    }
    return out;
  },
  Extra: RateExtra,
  extraBelow: true,
  Readout: RateReadout,
});

/* ============================ Terminal value ============================ */

function TerminalReadout({ data, company }) {
  const r = resultOf(company, data);
  if (!r) return null;
  const v = r.valuation;
  const locale = CURRENCIES[company.currency]?.locale;
  const sym = CURRENCIES[company.currency]?.symbol || '';
  if (r.tv === 'gordon' && !(v.rate > v.g)) {
    return <div className="readout warn">The discount rate ({pct2(v.rate)}) is not above the terminal growth ({pct2(v.g)}) — lower the growth below it to continue (the template shows NM here).</div>;
  }
  return (
    <div className="readout">
      Value per share <b className="acc">{fin(v.perShare) ? `${sym}${fmtTpl(v.perShare, 'n2', locale)}` : 'NM'}</b>
      {' '}· terminal value {fin(v.tvShare) ? `${(v.tvShare * 100).toFixed(1)}%` : 'NM'} of the total
      {' '}· {r.tv === 'gordon' ? `implied exit ${exitMultipleName(r.cf)} ${fin(v.implied) ? `${v.implied.toFixed(1)}x` : 'NM'}` : `implied perpetual growth ${pct2(v.implied)}`}
    </div>
  );
}

export const dcfTerminalStep = () => ({
  id: 'dcfTerminal',
  title: 'Terminal value',
  blurb: 'The value beyond the forecast horizon, and the step sizes of the sensitivity table.',
  fields: (data) => {
    const s = S(data);
    return [
      ...(s.tv === 'exit'
        ? [f.x('dcf.settings.exitMultiple', `Exit ${exitMultipleName(s.cf)} multiple`, { hint: `e.g. ${s.cf === 'fcff' ? '12.0x' : '20.0x'} – can take the median from your comps / precedent analysis` })]
        : [f.pct('dcf.settings.growth', 'Terminal (perpetual) growth rate', { hint: 'e.g. 5.0% – should not exceed long-run nominal GDP growth' })]),
      f.pct('dcf.settings.rateStep', 'Sensitivity: discount-rate step', { gt: 0, hint: 'Template example 0.5%' }),
      ...(s.tv === 'exit'
        ? [f.x('dcf.settings.multStep', 'Sensitivity: exit-multiple step', { hint: 'Template example 1.0x' })]
        : [f.pct('dcf.settings.gStep', 'Sensitivity: terminal-growth step', { gt: 0, hint: 'Template example 0.5%' })]),
    ];
  },
  Readout: TerminalReadout,
  // the user's choice: a Gordon growth at or above the discount rate is stopped here, not carried
  // to an NM output (the template's own NM handling stays in the engine and the workbook)
  validate: (data, ctx) => {
    if (S(data).tv !== 'gordon') return [];
    const r = resultOf(ctx.company, data);
    const v = r?.valuation;
    if (!v || !fin(v.rate) || !fin(v.g) || v.rate > v.g) return [];
    return [`Terminal growth (${pct2(v.g)}) must be below the ${S(data).cf === 'fcff' ? 'WACC' : 'cost of equity'} (${pct2(v.rate)}) — lower it to continue.`];
  },
});
