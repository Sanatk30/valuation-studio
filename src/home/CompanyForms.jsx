import React, { useEffect, useState } from 'react';
import { createCompany, updateCompany, replaceCompany, duplicateCompany, deleteCompany } from '../store/store.js';
import { CURRENCIES, UNITS } from '../lib/format.js';
import { SUPPORTED_CURRENCIES, fetchLiveRate } from '../lib/fx.js';
import { convertCompanyRecord, rescaleUnit } from '../lib/currency.js';
import { NumBox } from '../wizard/Field.jsx';
import { latestCompletedFy, impliedYear1 } from '../lib/period.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fyTag = (y) => `FY${String(y).slice(-2)}`;

/**
 * Year 1 against the calendar: the latest fiscal year that has ended (from
 * today's date and the year-end month) is the latest actual year, so Year 1
 * is the year after it. Shows that, a one-click "Use" when Year 1 differs,
 * and a warning when Year 1 is later — the history would then hold fiscal
 * years that have not ended, with no figures (the forecast would start from 0).
 *   onUse(year) — what the button does (set the form field, or save the company)
 */
export function YearCheck({ startYear, fyEndMonth, onUse, compact = false }) {
  const last = latestCompletedFy(fyEndMonth);
  const y1 = impliedYear1(fyEndMonth);
  if (last === null) return null;
  const m = Number(fyEndMonth);
  const ahead = Number.isInteger(startYear) && startYear > y1;
  const behind = Number.isInteger(startYear) && startYear < y1;
  const future = ahead ? Array.from({ length: startYear - y1 }, (_, i) => fyTag(y1 + i)) : [];
  return (
    <div className={ahead ? 'readout warn' : 'fld-h'} style={compact ? undefined : { marginTop: 6 }}>
      Latest completed fiscal year: <b>{fyTag(last)}</b> (year to {MON[m - 1]} {last}), so Year 1 = <b>{fyTag(y1)}</b> ({y1}).
      {ahead && <> Year 1 is set to {startYear}, but {future.join(', ')} {future.length === 1 ? 'has' : 'have'} not ended and can't be historical {future.length === 1 ? 'year' : 'years'} — the methods use Year 1 = {y1} until you save it.</>}
      {behind && <> Year 1 is set to {startYear} — fine for a valuation as of an earlier date.</>}
      {(ahead || behind || !Number.isInteger(startYear)) && onUse && <>{' '}<button type="button" className="btn sm" onClick={() => onUse(y1)}>Use {y1}</button></>}
    </div>
  );
}

export const FY_OPTIONS = [
  { value: 12, label: 'Calendar year (Jan – Dec)' },
  { value: 3, label: 'April – March' },
  { value: 6, label: 'July – June' },
  { value: 9, label: 'October – September' },
];
/**
 * After a Yahoo fill of the company being valued: when the listing's fiscal
 * year ends in another month than the company's setting (Kaynes reports to
 * March, the company is set to Jan – Dec), offer to switch the company's year
 * end — and Year 1 with it, to the year after the latest completed one — so the
 * FY labels name the company's own fiscal years. The figures then need a
 * fresh fill, since each column is filled by the year its label names.
 *   fyEnd — the listing's latest fiscal year-end date (YYYY-MM-DD)
 */
export function YearEndSwitch({ company, fyEnd }) {
  const m = Number(String(fyEnd || '').slice(5, 7));
  if (!company?.id || !(m >= 1 && m <= 12) || m === company.fyEndMonth) return null;
  const opt = FY_OPTIONS.find((o) => o.value === m);
  const cur = FY_OPTIONS.find((o) => o.value === company.fyEndMonth);
  if (!opt) {
    return <div className="readout warn">This listing's fiscal year ends in {MON[m - 1]}, which is not one of the app's year ends — its FY columns are its own fiscal years ending in {MON[m - 1]}.</div>;
  }
  const y1 = impliedYear1(m);
  return (
    <div className="readout warn">
      This listing's fiscal year ends in <b>{MON[m - 1]}</b>, but the company is set to <b>{cur ? cur.label : `a ${MON[company.fyEndMonth - 1]} year end`}</b>, so its FY labels don't match the company's own years.{' '}
      <button type="button" className="btn sm" onClick={() => updateCompany(company.id, { fyEndMonth: m, startYear: y1 })}>
        Set fiscal year to {opt.label}
      </button>
      {' '}(Year 1 becomes {y1}: latest actual FY{String(y1 - 1).slice(-2)}, the year to {MON[m - 1]} {y1 - 1}). Then fill again from Yahoo so each column takes the right year.
    </div>
  );
}

const UNIT_OPTIONS = Object.entries(UNITS).map(([k, v]) => ({ value: k, label: k === 'K' ? "Thousands ('000)" : { Cr: 'Crore (Cr)', Lakh: 'Lakh', Mn: 'Million (Mn)', Bn: 'Billion (Bn)' }[k] || v }));

/* ------------------------------------------------------------ new company */

/** First card on first launch, and the "New company" dialog. Nothing pre-selected. */
export function NewCompanyForm({ onDone, onCancel }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [unit, setUnit] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [fy, setFy] = useState('');
  const [tried, setTried] = useState(false);

  const errs = {
    name: !name.trim() ? 'Required' : null,
    currency: !currency ? 'Choose the valuation currency' : null,
    unit: !unit ? 'Choose a unit' : null,
    startYear: !(Number.isInteger(startYear) && startYear >= 1990 && startYear <= 2100) ? 'A year like 2026'
      : fy && impliedYear1(Number(fy)) !== null && startYear > impliedYear1(Number(fy)) ? `At most ${impliedYear1(Number(fy))}: FY${String(impliedYear1(Number(fy))).slice(-2)} has not ended, so it can't be a historical year` : null,
    fy: !fy ? 'Choose the fiscal year' : null,
  };
  const ok = Object.values(errs).every((e) => !e);
  const submit = () => {
    setTried(true);
    if (!ok) return;
    const id = createCompany({ name, currency, unit, startYear, fyEndMonth: Number(fy) });
    onDone?.(id);
  };
  const E = ({ k }) => (tried && errs[k] ? <div className="fld-e">{errs[k]}</div> : null);

  return (
    <div className="new-co">
      <h2>Which company are you valuing?</h2>
      <p className="fld-h">These settings apply to every method for this company. You can change them later (money is converted at a rate you confirm).</p>
      <div className="fld-grid c2">
        <div className={`fld${tried && errs.name ? ' bad' : ''}`}>
          <div className="fld-l"><label>Company name</label></div>
          <input className="fld-in txt" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sample Industries Ltd" autoFocus />
          <E k="name" />
        </div>
        <div className={`fld${tried && errs.currency ? ' bad' : ''}`}>
          <div className="fld-l"><label>Valuation currency</label></div>
          <select className="fld-in" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="">choose…</option>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCIES[c].symbol} {c} — {CURRENCIES[c].name}</option>)}
          </select>
          <div className="fld-h">Every figure, and every Yahoo pull, is in this currency.</div>
          <E k="currency" />
        </div>
        <div className={`fld${tried && errs.unit ? ' bad' : ''}`}>
          <div className="fld-l"><label>Money unit</label></div>
          <select className="fld-in" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">choose…</option>
            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <div className="fld-h">Share counts use the same unit.</div>
          <E k="unit" />
        </div>
        <div className={`fld${tried && errs.startYear ? ' bad' : ''}`}>
          <div className="fld-l"><label>First forecast year (Year 1)</label></div>
          <NumBox plain value={startYear} onChange={(v) => setStartYear(v)} placeholder="e.g. 2027" />
          <div className="fld-h">The LTM / base year is the year before it.</div>
          {fy ? <YearCheck startYear={startYear} fyEndMonth={Number(fy)} onUse={setStartYear} /> : <div className="fld-h">Choose the fiscal year to see which year that is.</div>}
          <E k="startYear" />
        </div>
        <div className={`fld${tried && errs.fy ? ' bad' : ''}`}>
          <div className="fld-l"><label>Fiscal year</label></div>
          <select className="fld-in" value={fy} onChange={(e) => setFy(e.target.value)}>
            <option value="">choose…</option>
            {FY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <E k="fy" />
        </div>
      </div>
      <div className="step-foot">
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        <div className="spacer" />
        <button className="btn primary" onClick={submit}>Create company →</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- company settings */

export function CompanySettings({ record, onClose }) {
  const [name, setName] = useState(record.name);
  const [startYear, setStartYear] = useState(record.startYear);
  const [fy, setFy] = useState(record.fyEndMonth);
  const [toCur, setToCur] = useState(record.currency);
  const [rate, setRate] = useState(null);
  const [rateSrc, setRateSrc] = useState('');
  const [rateErr, setRateErr] = useState('');
  const [toUnit, setToUnit] = useState(record.unit);

  // live rate for a currency change — editable; must be confirmed by the user
  useEffect(() => {
    if (toCur === record.currency) { setRate(null); setRateSrc(''); setRateErr(''); return; }
    let alive = true;
    setRate(null); setRateSrc('fetching'); setRateErr('');
    fetchLiveRate(record.currency, toCur)
      .then((r) => { if (alive) { setRate(r.rate); setRateSrc(`live · ${new Date(r.at).toLocaleString()}`); } })
      .catch((e) => { if (alive) { setRateSrc(''); setRateErr(`Live rate unavailable (${e.message}) — type the rate.`); } });
    return () => { alive = false; };
  }, [toCur, record.currency]);

  const basicsChanged = name.trim() !== record.name || startYear !== record.startYear || fy !== record.fyEndMonth;
  const basicsOk = name.trim() && Number.isInteger(startYear) && startYear >= 1990 && startYear <= 2100
    && !(impliedYear1(fy) !== null && startYear > impliedYear1(fy));   // a historical year must have ended

  const saveBasics = () => { if (basicsOk) updateCompany(record.id, { name: name.trim(), startYear, fyEndMonth: Number(fy) }); };
  const convert = () => {
    if (!(rate > 0)) return;
    if (!confirm(`Convert every money input in every method from ${record.currency} to ${toCur} at 1 ${record.currency} = ${rate} ${toCur}?`)) return;
    replaceCompany(convertCompanyRecord(record, toCur, rate));
  };
  const rescale = () => {
    if (toUnit === record.unit) return;
    if (!confirm(`Re-express every money input and share count from ${record.unit} to ${toUnit}? Per-share prices do not change.`)) return;
    replaceCompany(rescaleUnit(record, toUnit));
  };

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal settings-modal">
        <div className="bulk-head"><h2>Company settings</h2><div className="spacer" /><button className="btn ghost sm" onClick={onClose}>Close</button></div>

        <section className="set-sec">
          <h3>Basics</h3>
          <div className="fld-grid c3">
            <div className="fld"><div className="fld-l"><label>Name</label></div><input className="fld-in txt" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="fld"><div className="fld-l"><label>First forecast year</label></div><NumBox plain value={startYear} onChange={setStartYear} /></div>
            <div className="fld"><div className="fld-l"><label>Fiscal year</label></div>
              <select className="fld-in" value={fy} onChange={(e) => setFy(Number(e.target.value))}>{FY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </div>
          </div>
          <YearCheck startYear={startYear} fyEndMonth={fy} onUse={setStartYear} />
          <button className="btn sm" disabled={!basicsChanged || !basicsOk} onClick={saveBasics}>Save</button>
        </section>

        <section className="set-sec">
          <h3>Valuation currency</h3>
          <div className="fld-grid c3">
            <div className="fld"><div className="fld-l"><label>Convert to</label></div>
              <select className="fld-in" value={toCur} onChange={(e) => setToCur(e.target.value)}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCIES[c].symbol} {c}</option>)}
              </select>
            </div>
            {toCur !== record.currency && (
              <div className="fld"><div className="fld-l"><label>1 {record.currency} =</label>{rateSrc && <span className="fld-opt">{rateSrc}</span>}</div>
                <NumBox value={rate} suffix={toCur} onChange={(v) => { setRate(v); setRateSrc('typed'); }} />
                {rateErr && <div className="fld-e">{rateErr}</div>}
              </div>
            )}
          </div>
          <button className="btn sm" disabled={toCur === record.currency || !(rate > 0)} onClick={convert}>Convert every method</button>
        </section>

        <section className="set-sec">
          <h3>Money unit</h3>
          <div className="fld-grid c3">
            <div className="fld"><div className="fld-l"><label>Re-express in</label></div>
              <select className="fld-in" value={toUnit} onChange={(e) => setToUnit(e.target.value)}>{UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
            </div>
          </div>
          <button className="btn sm" disabled={toUnit === record.unit} onClick={rescale}>Re-express every method</button>
        </section>

        <section className="set-sec danger">
          <h3>Duplicate or delete</h3>
          <div className="row-btns">
            <button className="btn sm" onClick={() => { const nm = prompt('Name for the copy', `${record.name} (copy)`); if (nm && nm.trim()) { duplicateCompany(record.id, nm); onClose(); } }}>Duplicate company</button>
            <button className="btn sm danger" onClick={() => { if (confirm(`Delete ${record.name} and all its methods? This cannot be undone.`)) { deleteCompany(record.id); onClose(); } }}>Delete company</button>
          </div>
        </section>
      </div>
    </div>
  );
}
