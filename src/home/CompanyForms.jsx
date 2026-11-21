import React, { useEffect, useRef, useState } from 'react';
import { createCompany, updateCompany, replaceCompany, duplicateCompany, deleteCompany } from '../store/store.js';
import { CURRENCIES, UNITS } from '../lib/format.js';
import { SUPPORTED_CURRENCIES, fetchLiveRate } from '../lib/fx.js';
import { convertCompanyRecord, rescaleUnit } from '../lib/currency.js';
import { NumBox } from '../wizard/Field.jsx';
import { latestCompletedFy, impliedYear1 } from '../lib/period.js';
import { searchSymbols, fetchListing } from '../lib/yahoo.js';

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

/**
 * First page on first launch, and the "New company" dialog (the improved
 * Option B the user approved): search a listed company — the currency and
 * fiscal year come from Yahoo, tagged "filled" — or type any name; the unit is
 * a one-click switch, the fiscal year four cards, and a preview shows which
 * years are history and which is Year 1. Nothing is pre-selected.
 */
export function NewCompanyForm({ onDone, onCancel }) {
  const [name, setName] = useState('');
  const [listing, setListing] = useState(null);       // { symbol, exchange }
  const [currency, setCurrency] = useState('');
  const [unit, setUnit] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [yearTouched, setYearTouched] = useState(false);
  const [editYear, setEditYear] = useState(false);
  const [fy, setFy] = useState('');
  const [filled, setFilled] = useState({});
  const [tried, setTried] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Year 1 follows the fiscal year until the user changes it
  useEffect(() => {
    if (fy && !yearTouched) setStartYear(impliedYear1(Number(fy)));
  }, [fy, yearTouched]);

  // company search (Yahoo), debounced
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || listing) { setHits(null); return undefined; }
    let live = true;
    const id = setTimeout(async () => {
      try { const r = await searchSymbols(t); if (live) setHits(r.slice(0, 6)); } catch { if (live) setHits([]); }
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [q, listing]);

  const pickSeq = useRef(0);   // each pick (and Change) gets a number: a late Yahoo reply for an older one is ignored
  const pick = async (h) => {
    const seq = ++pickSeq.current;
    setName(h.name); setQ(h.name); setHits(null); setListing({ symbol: h.symbol, exchange: h.exchange }); setNote('');
    setBusy(true);
    try {
      const raw = await fetchListing(h.symbol, { search: h });
      if (seq !== pickSeq.current) return;
      const got = {};
      const ccy = raw.financialCurrency || raw.price?.currency;
      if (ccy && SUPPORTED_CURRENCIES.includes(ccy)) { setCurrency(ccy); got.currency = true; }
      const dates = Object.values(raw.annual || {}).flat().map((p) => p?.date).filter(Boolean).sort();
      const m = Number(String(dates[dates.length - 1] || '').slice(5, 7));
      if (FY_OPTIONS.some((o) => o.value === m)) { setFy(String(m)); setYearTouched(false); got.fy = MON[m - 1]; }
      setFilled(got);
      if (!got.currency || !got.fy) setNote('Yahoo did not give everything — choose the rest below.');
    } catch {
      if (seq === pickSeq.current) setNote('Could not reach Yahoo just now — choose the currency and fiscal year yourself.');
    } finally { if (seq === pickSeq.current) setBusy(false); }
  };
  const clearPick = () => { pickSeq.current += 1; setBusy(false); setListing(null); setFilled({}); setNote(''); };

  const y1 = fy ? impliedYear1(Number(fy)) : null;
  const errs = {
    name: !name.trim() ? 'Type or pick the company' : null,
    currency: !currency ? 'Choose the valuation currency' : null,
    unit: !unit ? 'Choose a unit' : null,
    startYear: !(Number.isInteger(startYear) && startYear >= 1990 && startYear <= 2100) ? 'A year like 2026'
      : fy && y1 !== null && startYear > y1 ? `At most ${y1}: FY${String(y1).slice(-2)} has not ended, so it can't be a historical year` : null,
    fy: !fy ? 'Choose the fiscal year' : null,
  };
  const ok = Object.values(errs).every((e) => !e);
  const submit = () => {
    setTried(true);
    if (!ok) return;
    const id = createCompany({ name: name.trim(), currency, unit, startYear, fyEndMonth: Number(fy), listing: listing ? { ...listing, name: name.trim() } : null });
    onDone?.(id);
  };
  const E = ({ k }) => (tried && errs[k] ? <div className="fld-e">{errs[k]}</div> : null);
  const initials = (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const m = Number(fy);
  const span = (yEnd) => (m === 12 ? `Jan-${yEnd} – Dec-${yEnd}` : `${MON[m % 12]}-${yEnd - 1} – ${MON[m - 1]}-${yEnd}`);
  const yrs = Number.isInteger(startYear) ? [startYear - 3, startYear - 2, startYear - 1, startYear, startYear + 1, startYear + 2] : [];

  return (
    <div className="nc">
      <h1>Which company are you valuing?</h1>
      <p className="nc-sub">Search a listed company to fill the rest for you — or type any name. You can change all of this later.</p>

      <div className={`fld${tried && errs.name ? ' bad' : ''}`}>
        <div className="fld-l"><label>Company</label></div>
        {listing ? (
          <div className="nc-picked">
            <span className="nc-av">{initials}</span>
            <span className="nc-pt"><b>{name}</b><small>{listing.symbol}{listing.exchange ? ` · ${listing.exchange}` : ''} · listed</small></span>
            {busy ? <span className="nc-tag">filling…</span> : <span className="nc-tag ok">✓ from Yahoo</span>}
            <button type="button" className="btn ghost sm" onClick={clearPick}>Change</button>
          </div>
        ) : (
          <div className="nc-search">
            <input className="fld-in txt" value={q} autoFocus placeholder="Search or type — e.g. Sample Industries Ltd"
              onChange={(e) => { setQ(e.target.value); setName(e.target.value); }} />
            {hits && (
              <div className="nc-res">
                {hits.map((h) => (
                  <button type="button" key={h.symbol} onClick={() => pick(h)}>
                    <span className="nc-av sm">{h.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                    <span className="nc-pt"><b>{h.name}</b><small>{h.symbol} · {h.exchange}</small></span>
                  </button>
                ))}
                {q.trim() && (
                  <button type="button" onClick={() => setHits(null)}>
                    <span className="nc-av sm plus">+</span>
                    <span className="nc-pt"><b>Use “{q.trim()}” as typed</b><small>for an unlisted company — fill the rest yourself</small></span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {busy && <div className="pbar" style={{ marginTop: 8 }}><div /></div>}
        {note && <div className="fld-h">{note}</div>}
        <E k="name" />
      </div>

      <div className="nc-g2">
        <div className={`fld${tried && errs.currency ? ' bad' : ''}`}>
          <div className="fld-l"><label>Valuation currency {filled.currency && <span className="nc-tag ok">filled</span>}</label></div>
          <select className="fld-in" value={currency} onChange={(e) => { setCurrency(e.target.value); setFilled((f) => ({ ...f, currency: false })); }}>
            <option value="">choose…</option>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCIES[c].symbol} {c} — {CURRENCIES[c].name}</option>)}
          </select>
          <div className="fld-h">Every figure and every Yahoo pull is in this currency.</div>
          <E k="currency" />
        </div>
        <div className={`fld${tried && errs.unit ? ' bad' : ''}`}>
          <div className="fld-l"><label>Money unit</label></div>
          <div className="nc-seg" role="radiogroup">
            {UNIT_OPTIONS.map((u) => <button type="button" key={u.value} role="radio" aria-checked={unit === u.value} className={unit === u.value ? 'on' : ''} onClick={() => setUnit(u.value)}>{u.label.replace(/ \(.*\)/, '')}</button>)}
          </div>
          <div className="fld-h">Share counts use the same unit.</div>
          <E k="unit" />
        </div>
      </div>

      <div className={`fld${tried && errs.fy ? ' bad' : ''}`}>
        <div className="fld-l"><label>Fiscal year {filled.fy && <span className="nc-tag ok">filled — Yahoo says {filled.fy}</span>}</label></div>
        <div className="nc-fy" role="radiogroup">
          {FY_OPTIONS.map((o) => (
            <button type="button" key={o.value} role="radio" aria-checked={Number(fy) === o.value} className={Number(fy) === o.value ? 'on' : ''} onClick={() => { setFy(String(o.value)); setFilled((f) => ({ ...f, fy: false })); }}>
              <b>{{ 12: 'Jan – Dec', 3: 'Apr – Mar', 6: 'Jul – Jun', 9: 'Oct – Sep' }[o.value]}</b>
              <small>{{ 12: 'calendar year', 3: 'most Indian companies' }[o.value] || ' '}</small>
            </button>
          ))}
        </div>
        <E k="fy" />
      </div>

      <div className="nc-years">
        <div className="nc-years-h"><span>Your years</span>{fy && <button type="button" className="btn ghost sm" onClick={() => setEditYear(!editYear)}>{editYear ? 'Done' : 'Change Year 1'}</button>}</div>
        {fy && Number.isInteger(startYear) ? (
          <>
            <div className="nc-yrs">
              {yrs.map((y, i) => <span key={y} className={i < 3 ? 'h' : i === 3 ? 'one' : 'f'}>{fyTag(y)}{i >= 3 ? 'E' : ''}{i === 3 ? ' · Year 1' : ''}</span>)}
            </div>
            <div className="fld-h">{fyTag(startYear - 1)} ({span(startYear - 1)}) is the latest finished year — the base. Year 1 = {fyTag(startYear)}E, {span(startYear)}.{!yearTouched ? ' Worked out from today’s date.' : ''}</div>
            {editYear && (
              <div className="nc-y1">
                <label>First forecast year (Year 1)</label>
                <NumBox plain value={startYear} onChange={(v) => { setStartYear(v); setYearTouched(true); }} placeholder="e.g. 2027" />
                <YearCheck startYear={startYear} fyEndMonth={Number(fy)} onUse={(v) => { setStartYear(v); setYearTouched(false); }} />
              </div>
            )}
          </>
        ) : <div className="fld-h">Pick the fiscal year to see which years are history and which is Year 1.</div>}
        <E k="startYear" />
      </div>

      <div className="nc-foot">
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn primary nc-go" onClick={submit}>Create company and open the overview →</button>
      </div>
      <div className="nc-note">Saved on this computer only · nothing is uploaded</div>
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
