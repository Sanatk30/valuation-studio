import React from 'react';
import { f, fieldErrors } from '../fields.js';
import { NumBox } from '../../wizard/Field.jsx';
import { toEngineInput } from '../../store/methodModel.js';
import { computeWacc, unleverBeta } from '../../lib/engine/wacc.js';
import { fmtNum, fmtPct } from '../../lib/format.js';

const pid = () => `bp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ------------------------------------------------------------ WACC step */

export function waccSpecs(data) {
  const w = data.wacc || {};
  return [
    f.pct('wacc.riskFree', 'Risk-free rate', { hint: 'e.g. the 10-year government bond yield in your valuation currency' }),
    f.pct('wacc.erp', 'Equity risk premium'),
    f.choice('wacc.betaMode', 'How will you enter beta?', [
      { value: 'hamada', label: 'Unlevered βU (relever with Hamada)' },
      { value: 'direct', label: 'Levered βL directly' },
    ]),
    ...(w.betaMode === 'hamada' ? [f.num('wacc.unleveredBeta', 'Unlevered (asset) beta βU', { gt: 0, hint: 'Relevered at your target D/E: βL = βU × (1 + (1 − t) × D/E)' })] : []),
    ...(w.betaMode === 'direct' ? [f.num('wacc.beta', 'Levered beta βL', { gt: 0 })] : []),
    f.pct('wacc.sizePremium', 'Size / company-specific premium', { hint: '0 if none' }),
    f.pct('wacc.costDebt', 'Pre-tax cost of debt', { min: 0 }),
    f.pct('wacc.debtWeight', 'Target debt weight D/(D+E)', { min: 0, lt: 100 }),
  ];
}

/** The DCF-owned beta-peer list: reference only, never drives the rate unless you press Use. */
function BetaPeers({ data, setData, company }) {
  const peers = data.wacc.betaPeers || [];
  const setPeers = (fn) => setData((d) => ({ ...d, wacc: { ...d.wacc, betaPeers: fn(d.wacc.betaPeers || []) } }));
  const rows = peers.map((p) => ({
    ...p,
    bu: Number.isFinite(p.leveredBeta) && Number.isFinite(p.de) && Number.isFinite(p.taxRate) ? unleverBeta(p.leveredBeta, p.de, p.taxRate) : NaN,
  }));
  const bus = rows.map((r) => r.bu).filter(Number.isFinite).sort((a, b) => a - b);
  const mean = bus.length ? bus.reduce((s, v) => s + v, 0) / bus.length : NaN;
  const median = bus.length ? (bus.length % 2 ? bus[(bus.length - 1) / 2] : (bus[bus.length / 2 - 1] + bus[bus.length / 2]) / 2) : NaN;
  const b3 = (v) => (Number.isFinite(v) ? fmtNum(v, 3, 'en-US') : 'NA');
  const useBu = (v) => setData((d) => ({ ...d, wacc: { ...d.wacc, betaMode: 'hamada', unleveredBeta: Math.round(v * 1000) / 1000 } }));

  return (
    <div className="tool-card">
      <div className="tool-h">Beta from comparable companies <span className="fld-opt">optional</span></div>
      <div className="fld-h" style={{ marginBottom: 8 }}>
        Type each peer’s observed levered beta, its debt-to-equity ratio and tax rate; each is unlevered with its own tax rate.
        This list belongs to this DCF only.
      </div>
      {peers.length > 0 && (
        <table className="fin compact bp-table">
          <thead><tr><th>Peer</th><th>Levered β</th><th>D/E (x)</th><th>Tax %</th><th>Unlevered β</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><input className="fld-in txt" value={p.name} placeholder="Name" onChange={(e) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} /></td>
                {['leveredBeta', 'de', 'taxRate'].map((k) => (
                  <td key={k}><NumBox small value={p[k]} onChange={(v) => setPeers((ps) => ps.map((x) => (x.id === p.id ? { ...x, [k]: v } : x)))} /></td>
                ))}
                <td className="calc">{b3(p.bu)}</td>
                <td><button className="peer-del" onClick={() => setPeers((ps) => ps.filter((x) => x.id !== p.id))} title="Remove">×</button></td>
              </tr>
            ))}
            <tr className="bold"><td>Mean</td><td /><td /><td /><td className="calc">{b3(mean)}</td><td /></tr>
            <tr className="bold"><td>Median</td><td /><td /><td /><td className="calc">{b3(median)}</td><td /></tr>
          </tbody>
        </table>
      )}
      <div className="row-btns">
        <button className="btn sm" onClick={() => setPeers((ps) => [...ps, { id: pid(), name: '', leveredBeta: null, de: null, taxRate: null }])}>+ Add peer</button>
        {Number.isFinite(median) && <button className="btn sm" onClick={() => useBu(median)}>Use median βU ({b3(median)})</button>}
        {Number.isFinite(mean) && <button className="btn sm" onClick={() => useBu(mean)}>Use mean βU ({b3(mean)})</button>}
      </div>
    </div>
  );
}

function waccOf(company, data) {
  if (Object.keys(fieldErrors(waccSpecs(data), data)).length) return null;
  if (!Number.isFinite(data.company?.taxRate)) return null;
  return computeWacc(toEngineInput(company, data));
}

function WaccReadout({ data, company }) {
  const k = waccOf(company, data);
  if (!k) return null;
  return (
    <div className="readout">
      Levered β <b>{fmtNum(k.leveredBeta, 3, 'en-US')}</b> · Cost of equity <b>{fmtPct(k.costEquity, 2)}</b> ·
      After-tax Kd <b>{fmtPct(k.afterTaxKd, 2)}</b> · WACC <b className="acc">{fmtPct(k.wacc, 2)}</b>
    </div>
  );
}

export const waccStep = () => ({
  id: 'wacc',
  title: 'Cost of capital',
  blurb: 'CAPM cost of equity, after-tax cost of debt and the target capital structure give the WACC.',
  fields: (data) => waccSpecs(data),
  Extra: BetaPeers,
  extraBelow: true,
  Readout: WaccReadout,
});

/* -------------------------------------------------------- terminal value */

export function terminalSpecs() {
  return [
    f.choice('dcf.primaryTV', 'Headline terminal-value method', [
      { value: 'gordon', label: 'Perpetuity growth (Gordon)' },
      { value: 'exit', label: 'Exit EV/EBITDA multiple' },
    ], { hint: 'Both are always calculated and shown; this picks the headline figure' }),
    f.pct('dcf.terminalGrowth', 'Terminal growth rate', { hint: 'Must be below the WACC' }),
    f.x('dcf.exitMultiple', 'Exit EV/EBITDA multiple', { hint: 'Applied to final-year EBITDA' }),
    f.bool('dcf.midYear', 'Mid-year discounting?', { yes: 'Yes — cash flows mid-year', no: 'No — year-end' }),
  ];
}

export const terminalStep = () => ({
  id: 'terminal',
  title: 'Terminal value',
  blurb: 'How the business is valued beyond the forecast horizon.',
  fields: () => terminalSpecs(),
  validate: (data, { company }) => {
    const k = waccOf(company, data);
    const g = data.dcf?.terminalGrowth;
    if (k && Number.isFinite(g) && !(g < k.wacc)) return [`Terminal growth (${fmtPct(g, 2)}) must be below the WACC (${fmtPct(k.wacc, 2)}).`];
    return [];
  },
});

/* ------------------------------------------------------------ FCFE step */

export function fcfeSpecs() {
  return [
    f.pct('ts.interestRateDebt', 'Interest rate on debt', { min: 0, hint: 'Charged on opening debt each year' }),
    f.pct('ts.interestRateCash', 'Interest earned on cash', { min: 0, hint: 'On opening cash' }),
    f.pct('ts.debtRepayPct', 'Mandatory debt repayment', { min: 0, max: 100, hint: '% of opening debt repaid each year' }),
    f.pct('ts.dividendPayout', 'Dividend payout', { min: 0, max: 100, hint: '% of net income' }),
    f.x('dcf.exitPE', 'Exit P/E multiple', { hint: 'For the FCFE exit-multiple terminal value' }),
  ];
}

export const fcfeStep = () => ({
  id: 'fcfe',
  title: 'FCFE financing',
  optional: true,
  blurb: 'Adds a levered (FCFE) valuation at the cost of equity. Skip it to value on FCFF only.',
  fields: () => fcfeSpecs(),
  validate: (data, { company }) => {
    const k = waccOf(company, data);
    const g = data.dcf?.terminalGrowth;
    if (k && Number.isFinite(g) && !(g < k.costEquity)) return [`Terminal growth must be below the cost of equity (${fmtPct(k.costEquity, 2)}).`];
    return [];
  },
});
