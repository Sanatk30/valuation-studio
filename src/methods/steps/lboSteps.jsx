import React from 'react';
import { f } from '../fields.js';
import { NumBox } from '../../wizard/Field.jsx';
import TemplatePageEditor from '../../components/TemplatePageEditor.jsx';
import DriversGrid from '../../components/DriversGrid.jsx';
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

function resultOf(company, data) {
  try { return computeLboT(toEngineInput(company, data)); } catch { return null; }
}

/* ============================== Settings ============================== */

function SettingsExtra({ data, setData, company }) {
  const s = S(data);
  return (
    <div className="step-tools">
      <YearCheck startYear={company?.startYear} fyEndMonth={company?.fyEndMonth} onUse={(y) => company?.id && updateCompany(company.id, { startYear: y })} />
      <PeriodLabelsCard
        labels={dcfLabels(S(data).labels, nHist(data), nHold(data), company?.startYear, { keepBlank: true })} latestName="Latest actual year (entry)"
        fcstName={(i, m) => `Forecast year ${i + 1}${i === m - 1 ? ' (exit)' : ''}`}
        onChange={(labels) => setData((d) => ({ ...d, lbo: { ...d.lbo, settings: { ...d.lbo.settings, labels } } }))}
      />
      {s.repay && (
        <div className="readout">
          Template <b>{repayKind(s.repay).file}.xlsx</b> — {repayKind(s.repay).note} Entry at the end of the latest actual year, exit at the end of forecast year {nHold(data)}.
        </div>
      )}
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

export const lboCompanyStep = () => ({
  id: 'lboCompany',
  title: 'Company & historicals',
  blurb: 'The historical income statement, balance sheet and cash flow (the template’s Historicals sheet). Entry EBITDA is the latest actual year’s.',
  fields: () => [],
  Extra: CompanyExtra,
  extraBelow: true,
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
        <DriversGrid defs={LBO_DRIVERS} drivers={data.lbo.drivers} onChange={(drivers) => setData((d) => ({ ...d, lbo: { ...d.lbo, drivers } }))}
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
});
