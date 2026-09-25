import React, { useMemo, useState } from 'react';
import { f, anyFilled } from '../fields.js';
import { getPath } from '../../store/store.js';
import { METHOD_META } from '../labels.js';
import YearGrid from '../../wizard/YearGrid.jsx';
import ListingSearch from '../../components/ListingSearch.jsx';
import {
  HISTORY_LINES, HISTORY_GROUPS, HISTORY_MAX_YEARS, blankManualHistory, hasHistory, historyReference, fyLabel,
} from '../../lib/historyModel.js';
import { fmtPct, fmtNum, CURRENCIES } from '../../lib/format.js';

/* ======================================================================
   Company & balance sheet
   ====================================================================== */

const COMPANY_KEYS = ['sharesOut', 'currentPrice', 'grossDebt', 'cash', 'taxRate', 'nol0'];

/** Which company fields a method asks for. */
function companySpecs({ tax, nol, priceRequired = false, priceHint }) {
  return [
    f.shares('company.sharesOut', 'Shares outstanding', { hint: 'Diluted, in the same unit scale as money figures' }),
    f.price('company.currentPrice', 'Current share price', { required: priceRequired, hint: priceHint || 'Leave blank for a private company — upside lines are then hidden' }),
    f.money('company.grossDebt', 'Gross debt'),
    f.money('company.cash', 'Cash & equivalents'),
    ...(tax ? [f.pct('company.taxRate', 'Tax rate', { min: 0, max: 100 })] : []),
    ...(nol ? [f.money('company.nol0', 'Opening tax-loss carryforward (NOL)', { hint: 'Unused tax losses available today — 0 if none' })] : []),
  ];
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Methods whose Financing step asks for the opening PP&E and reported equity. */
const TS_BALANCE_METHODS = ['ts', 'ratios'];

/**
 * Fold a ListingSearch result into THIS method's data — reported facts only,
 * and only into fields this method actually asks for (`companyPaths` = the
 * Company step's field paths). A value Yahoo does not report never clears
 * what the user already typed.
 */
export function applyListing(data, mapped, { companyPaths = null, methodId = null } = {}) {
  let next = { ...data };
  const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src && finite(src[k])).map((k) => [k, src[k]]));
  const asked = companyPaths ? COMPANY_KEYS.filter((k) => companyPaths.includes(`company.${k}`)) : COMPANY_KEYS;
  const ownCompanyKeys = asked.filter((k) => k in (data.company || {}));
  next.company = { ...data.company, ...pick(mapped.company, ownCompanyKeys) };
  if (data.drivers) next.drivers = { ...data.drivers, ...pick(mapped.drivers, ['revenue0', 'ebitda0', 'nwc0']) };
  if (data.ts && mapped.ts && TS_BALANCE_METHODS.includes(methodId)) next.ts = { ...data.ts, ...pick(mapped.ts, ['startingPPE', 'equity0']) };
  if (data.comps && mapped.compsTarget) {
    const t = { ...data.comps.target };
    for (const [k, v] of Object.entries(mapped.compsTarget)) {
      if (typeof v === 'string' ? v : finite(v)) t[k] = v;
    }
    next.comps = { ...data.comps, target: t };
  }
  if (data.precedent && mapped.precedentTarget) {
    next.precedent = {
      ...data.precedent,
      target: { ...data.precedent.target, ...pick(mapped.precedentTarget, ['revenue', 'ebitda']), ltmLabel: mapped.precedentTarget.ltmLabel || '' },
    };
  }
  if ('history' in data && mapped.history) next.history = mapped.history;
  next.listing = mapped.listing || null;
  return next;
}

/** Other methods of this company that already hold values for a section. */
function copySources(record, methodId, section, specsFor) {
  return Object.entries(record.methods)
    .filter(([id, m]) => id !== methodId && m?.data?.[section] && anyFilled(specsFor(id), m.data))
    .map(([id]) => id);
}

function CopyFrom({ record, methodId, section, specsFor, onCopy, what }) {
  const sources = copySources(record, methodId, section, specsFor);
  const [pick, setPick] = useState('');
  if (!sources.length) return null;
  return (
    <div className="copy-from">
      <span>Copy {what} from</span>
      <select value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">choose a method…</option>
        {sources.map((id) => <option key={id} value={id}>{METHOD_META[id].label}</option>)}
      </select>
      <button className="btn sm" disabled={!pick} onClick={() => { onCopy(record.methods[pick].data); setPick(''); }}>Copy</button>
      <span className="fld-h">Copies once — the two methods stay independent afterwards.</span>
    </div>
  );
}

const COMPANY_SPECS_ALL = companySpecs({ tax: true, nol: true });

function CompanyExtras({ data, setData, company, ctx, specs }) {
  const onCopy = (src) => setData((d) => {
    const c = { ...d.company };
    for (const k of Object.keys(c)) if (src.company && k in src.company) c[k] = src.company[k];
    const next = { ...d, company: c };
    if ('listing' in d && src.listing) next.listing = src.listing;
    if ('history' in d && src.history) next.history = src.history;
    return next;
  });
  return (
    <div className="step-tools">
      <div className="tool-card">
        <div className="tool-h">Listed company?</div>
        <div className="fld-h" style={{ marginBottom: 8 }}>
          Search a name or ticker to fill the reported figures (converted into {company.currency} {company.unit} at a rate you confirm).
          Nothing changes until you press Apply.
        </div>
        <ListingSearch
          company={company}
          onApply={(mapped) => setData((d) => applyListing(d, mapped, { companyPaths: (specs || []).map((s) => s.path), methodId: ctx.methodId }))}
        />
        {data.listing && (
          <div className="fld-h" style={{ marginTop: 8 }}>
            Filled from <b>{data.listing.name || data.listing.symbol}</b> ({data.listing.symbol}
            {data.listing.ltmLabel ? ` · ${data.listing.ltmLabel}` : ''}). Check every value below — you can overwrite any of them.
          </div>
        )}
      </div>
      <CopyFrom
        record={ctx.record} methodId={ctx.methodId} section="company" what="company inputs"
        specsFor={() => COMPANY_SPECS_ALL} onCopy={onCopy}
      />
    </div>
  );
}

export const companyStep = (opts = {}) => ({
  id: 'company',
  title: 'Company & balance sheet',
  blurb: 'Share count, today’s debt and cash, and — where the method forecasts — tax and tax losses.',
  Extra: CompanyExtras,
  fields: () => companySpecs(opts),
});

/* ======================================================================
   Historical financials (optional)
   ====================================================================== */

function HistoryEditor({ data, setData, company }) {
  const h = data.history;
  const yahoo = h?.source === 'yahoo';
  const [years, setYears] = useState(5);
  const lastFy = `${company.startYear - 1}-${String(company.fyEndMonth).padStart(2, '0')}-${String(new Date(Date.UTC(company.startYear - 1, company.fyEndMonth, 0)).getUTCDate()).padStart(2, '0')}`;
  const [lastEnd, setLastEnd] = useState(lastFy);
  const locale = CURRENCIES[company.currency]?.locale;

  if (!h) {
    return (
      <div className="tool-card">
        <div className="tool-h">No reported history yet</div>
        <p className="fld-h">
          Search a listed company in the Company step to bring in its reported statements, or enter them by hand below.
          Skip this step and the output simply shows no historical columns — nothing is back-cast.
        </p>
        <div className="hist-new">
          <label>Years <input type="number" min={1} max={HISTORY_MAX_YEARS} value={years} onChange={(e) => setYears(Math.max(1, Math.min(HISTORY_MAX_YEARS, parseInt(e.target.value, 10) || 1)))} /></label>
          <label>Latest fiscal year end <input type="date" value={lastEnd} onChange={(e) => setLastEnd(e.target.value)} /></label>
          <button className="btn" onClick={() => setData((d) => ({ ...d, history: blankManualHistory(years, lastEnd) }))}>Enter history by hand</button>
        </div>
      </div>
    );
  }

  const heads = h.annual.dates.map(fyLabel);
  const setLine = (key, c, v) => setData((d) => {
    const lines = { ...d.history.annual.lines, [key]: d.history.annual.lines[key].map((x, i) => (i === c ? v : x)) };
    return { ...d, history: { ...d.history, annual: { ...d.history.annual, lines } } };
  });
  const onPasteBlock = (r0, c0, block) => setData((d) => {
    const lines = { ...d.history.annual.lines };
    const rowKeys = HISTORY_LINES.map((l) => l.key);
    block.forEach((cells, i) => {
      // a leading text label decides the row; otherwise rows follow the grid order
      const key = rowKeys[r0 + i];
      if (!key) return;
      cells.forEach((v, j) => {
        const c = c0 + j;
        if (c < d.history.annual.dates.length && v !== null && Number.isFinite(v)) {
          lines[key] = lines[key].map((x, k) => (k === c ? v : x));
        }
      });
    });
    return { ...d, history: { ...d.history, annual: { ...d.history.annual, lines } } };
  });

  if (yahoo) {
    return (
      <div className="tool-card">
        <div className="tool-h">Reported history · {h.label}</div>
        <div className="tablewrap">
          <table className="fin">
            <thead><tr><th /> {heads.map((x) => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>
              {HISTORY_LINES.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  {h.annual.lines[l.key].map((v, i) => <td key={i}>{v === null ? 'NA' : fmtNum(v, 0, locale)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fld-h" style={{ marginTop: 8 }}>
          In {company.currency} {company.unit}, converted at the rate you confirmed. NA = not reported.
          <button className="btn sm ghost" style={{ marginLeft: 10 }} onClick={() => setData((d) => ({ ...d, history: null }))}>Remove history</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tool-card">
      <div className="tool-h">Historical financials — entered by hand ({company.currency} {company.unit})</div>
      {HISTORY_GROUPS.map((g) => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div className="grid-cap">{g.label}</div>
          <YearGrid
            heads={heads}
            rows={HISTORY_LINES.filter((l) => l.group === g.id).map((l) => ({ key: l.key, label: l.label, values: h.annual.lines[l.key] }))}
            onCell={setLine}
            onPasteBlock={(r, c, block) => onPasteBlock(HISTORY_LINES.findIndex((l) => l.group === g.id) + r, c, block)}
          />
        </div>
      ))}
      <div className="fld-h">
        Paste a block copied from Excel into any cell: it fills right and down in the grid’s row order. Leave a cell blank if it
        wasn’t reported — it shows as NA. Capex, dividends, interest, tax and D&A are positive amounts.
        <button className="btn sm ghost" style={{ marginLeft: 10 }} onClick={() => setData((d) => ({ ...d, history: null }))}>Discard</button>
      </div>
    </div>
  );
}

export const historyStep = () => ({
  id: 'history',
  title: 'Historical financials',
  optional: true,
  blurb: 'Reported past years, for the historical columns and past ratios. Optional — skip it and no history is shown.',
  Extra: HistoryEditor,
  fields: () => [],
  validate: (data) => (hasHistory(data.history) ? [] : ['Enter at least one reported number, or skip this step.']),
});

/* ======================================================================
   Operating forecast
   ====================================================================== */

const GRID_ROWS = [
  { key: 'revenue', modeKey: 'revenueMode', label: 'Revenue', modes: [['growth', 'growth %'], ['abs', 'absolute']] },
  { key: 'ebitda', modeKey: 'ebitdaMode', label: 'EBITDA', modes: [['margin', 'margin %'], ['abs', 'absolute']] },
  { key: 'da', modeKey: 'daMode', label: 'D&A', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
  { key: 'capex', modeKey: 'capexMode', label: 'Capex', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
  { key: 'nwc', modeKey: 'nwcMode', label: 'NWC balance', modes: [['pct', '% of revenue'], ['abs', 'absolute']] },
];

const emptyGrid = (n) => ({
  revenueMode: 'growth', revenue: Array(n).fill(null),
  ebitdaMode: 'margin', ebitda: Array(n).fill(null),
  daMode: 'pct', da: Array(n).fill(null),
  capexMode: 'pct', capex: Array(n).fill(null),
  nwcMode: 'pct', nwc: Array(n).fill(null),
});
const resize = (arr, n) => Array.from({ length: n }, (_, i) => (arr?.[i] ?? null));

export function forecastSpecs(data) {
  const d = data.drivers || {};
  const n = d.years;
  const specs = [
    f.int('drivers.years', 'Projection years', { min: 3, max: 15, hint: '3 to 15 years' }),
    f.money('drivers.revenue0', 'LTM revenue', { gt: 0, min: undefined }),
    f.signedMoney('drivers.ebitda0', 'LTM EBITDA', { hint: 'Reported, for the trailing twelve months' }),
    f.signedMoney('drivers.nwc0', 'Opening net working capital', { hint: 'Operating NWC today: (current assets − cash) − (current liabilities − short-term debt)' }),
    f.choice('drivers.mode', 'How will you enter the forecast?', [
      { value: 'fade', label: 'Start → end fade', hint: 'Growth and margin move in a straight line from Year 1 to the final year' },
      { value: 'grid', label: 'Year by year', hint: 'Type (or paste) every year' },
    ]),
  ];
  if (d.mode === 'fade') {
    specs.push(
      f.pct('drivers.growthStart', 'Revenue growth — Year 1', { gt: -100 }),
      f.pct('drivers.growthEnd', `Revenue growth — Year ${Number.isInteger(n) ? n : 'N'}`, { gt: -100 }),
      f.pct('drivers.marginStart', 'EBITDA margin — Year 1', { max: 100 }),
      f.pct('drivers.marginEnd', `EBITDA margin — Year ${Number.isInteger(n) ? n : 'N'}`, { max: 100 }),
      f.pct('drivers.daPct', 'D&A (% of revenue)', { min: 0 }),
      f.pct('drivers.capexPct', 'Capex (% of revenue)', { min: 0 }),
      f.pct('drivers.nwcPct', 'Net working capital (% of revenue)', { hint: 'The NWC balance each forecast year; only its change hits cash flow' }),
    );
  }
  return specs;
}

function gridErrors(d) {
  if (d.mode !== 'grid') return [];
  const n = d.years;
  if (!Number.isInteger(n) || n < 3 || n > 15) return [];
  const g = d.perYear;
  if (!g) return ['Fill the year-by-year grid.'];
  const errs = [];
  for (const r of GRID_ROWS) {
    const vals = resize(g[r.key], n);
    const missing = vals.filter((v) => v === null || !Number.isFinite(v)).length;
    if (missing) errs.push(`${r.label}: ${missing} year${missing > 1 ? 's' : ''} missing`);
    if (r.key === 'revenue' && g.revenueMode === 'growth' && vals.some((v) => Number.isFinite(v) && v <= -100)) errs.push('Revenue growth must be above −100 %');
    if (r.key === 'revenue' && g.revenueMode === 'abs' && vals.some((v) => Number.isFinite(v) && v <= 0)) errs.push('Absolute revenue must be above 0');
  }
  return errs;
}

function ForecastExtras({ data, setData, company, ctx }) {
  const d = data.drivers;
  const ref = useMemo(() => historyReference(data.history), [data.history]);
  const n = d.years;
  const okN = Number.isInteger(n) && n >= 3 && n <= 15;

  const onCopy = (src) => setData((cur) => ({
    ...cur,
    drivers: { ...cur.drivers, ...src.drivers },
    ...('history' in cur && src.history ? { history: src.history } : {}),
  }));

  const setGrid = (fn) => setData((cur) => ({ ...cur, drivers: { ...cur.drivers, perYear: fn(cur.drivers.perYear || emptyGrid(cur.drivers.years)) } }));

  return (
    <div className="step-tools">
      <CopyFrom
        record={ctx.record} methodId={ctx.methodId} section="drivers" what="the forecast"
        specsFor={() => forecastSpecs({ drivers: { mode: 'fade' } })} onCopy={onCopy}
      />
      {ref && <HistoryReference ref_={ref} company={company} />}
      {d.mode === 'grid' && okN && (
        <div className="tool-card">
          <div className="tool-h">Year-by-year forecast</div>
          <YearGrid
            heads={Array.from({ length: n }, (_, i) => `Y${i + 1} · ${company.startYear + i}`)}
            rows={GRID_ROWS.map((r) => ({ key: r.key, label: r.label, modes: r.modes, mode: (d.perYear || emptyGrid(n))[r.modeKey], values: resize((d.perYear || emptyGrid(n))[r.key], n) }))}
            onCell={(key, c, v) => setGrid((g) => ({ ...g, [key]: resize(g[key], n).map((x, i) => (i === c ? v : x)) }))}
            onMode={(key, mode) => setGrid((g) => ({ ...g, [GRID_ROWS.find((r) => r.key === key).modeKey]: mode }))}
            onPasteBlock={(r0, c0, block) => setGrid((g) => {
              const next = { ...g };
              block.forEach((cells, i) => {
                const row = GRID_ROWS[r0 + i];
                if (!row) return;
                next[row.key] = resize(next[row.key], n).map((x, c) => {
                  const v = cells[c - c0];
                  return c >= c0 && v !== undefined && v !== null && Number.isFinite(v) ? v : x;
                });
              });
              return next;
            })}
            note={`Percent rows are % (growth, margin, % of revenue); absolute rows are in ${company.currency} ${company.unit}. Paste a block from Excel into any cell to fill right and down.`}
          />
        </div>
      )}
    </div>
  );
}

function HistoryReference({ ref_: ref, company }) {
  const p = (v) => (Number.isFinite(v) ? fmtPct(v, 1) : 'NA');
  return (
    <div className="tool-card ref-card">
      <div className="tool-h">Reported history — for reference only</div>
      <div className="fld-h" style={{ marginBottom: 6 }}>
        Not copied into the forecast. {ref.cagrYears > 0 && <>Revenue CAGR over {ref.cagrYears} years: <b>{p(ref.cagr)}</b>.</>}
      </div>
      <div className="tablewrap">
        <table className="fin compact">
          <thead><tr><th /> {ref.rows.map((r) => <th key={r.date}>{r.label}</th>)}</tr></thead>
          <tbody>
            <tr><td>Revenue growth</td>{ref.rows.map((r) => <td key={r.date}>{p(r.growth)}</td>)}</tr>
            <tr><td>EBITDA margin</td>{ref.rows.map((r) => <td key={r.date}>{p(r.ebitdaMargin)}</td>)}</tr>
            <tr><td>D&A % revenue</td>{ref.rows.map((r) => <td key={r.date}>{p(r.daPct)}</td>)}</tr>
            <tr><td>Capex % revenue</td>{ref.rows.map((r) => <td key={r.date}>{p(r.capexPct)}</td>)}</tr>
            <tr><td>Trade NWC % revenue</td>{ref.rows.map((r) => <td key={r.date}>{p(r.tradeNwcPct)}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Keep per-year arrays the length of the horizon when years change. */
export function onForecastSet(data, path, value) {
  if (path === 'drivers.years') {
    const n = value;
    const d = data.drivers;
    const ok = Number.isInteger(n) && n >= 3 && n <= 15;
    return {
      ...data,
      drivers: {
        ...d, years: value,
        perYear: d.perYear && ok ? Object.fromEntries(Object.entries(d.perYear).map(([k, v]) => [k, Array.isArray(v) ? resize(v, n) : v])) : d.perYear,
      },
    };
  }
  if (path === 'drivers.mode') {
    const d = data.drivers;
    return { ...data, drivers: { ...d, mode: value, perYear: value === 'grid' ? d.perYear || (Number.isInteger(d.years) ? emptyGrid(d.years) : null) : null } };
  }
  return null;
}

export const forecastStep = () => ({
  id: 'forecast',
  title: 'Operating forecast',
  blurb: 'LTM figures today, then how revenue, EBITDA, D&A, capex and working capital evolve over the forecast.',
  fields: (data) => forecastSpecs(data),
  Extra: ForecastExtras,
  extraBelow: true,
  onSet: onForecastSet,
  validate: (data) => gridErrors(data.drivers || {}),
});

export { getPath };
