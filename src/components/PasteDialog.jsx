import React, { useMemo, useState } from 'react';
import { parsePageGrid, applyPageGrid, parseCompanyList, LIST_HEADER } from '../lib/templatePaste.js';

/**
 * Paste out of a spreadsheet.
 *
 *   mode 'page' — line items down, periods across, into one company page
 *                 (`columns` = the page's input columns in order).
 *   mode 'list' — the company list (one row per company with a header row).
 *
 * Nothing is applied until you confirm: the preview shows every row matched,
 * where each pasted column lands, the calculated rows skipped and the rows
 * not recognised.
 */
export default function PasteDialog({ mode = 'page', title, page, n, columns = [], onApply, onClose }) {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState('auto');   // 'auto' = line up by the pasted header row

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return mode === 'page' ? parsePageGrid(text, { columns, offset }) : parseCompanyList(text);
  }, [text, offset, mode, columns]);

  const fmt = (v) => (v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const apply = () => {
    if (!parsed?.ok) return;
    onApply(mode === 'page' ? applyPageGrid(page, parsed, n) : parsed.companies);
    onClose();
  };

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal" style={{ width: 'min(960px, 96vw)' }}>
        <div className="bulk-head">
          <h2>{title || (mode === 'page' ? 'Paste financials' : 'Paste the company list')}</h2>
          <div className="sub">
            {mode === 'page'
              ? 'Copy a block out of Excel: line items down the first column, one column per period (e.g. the columns of a filled template sheet, or an annual-report table). Rows are matched by label; totals are recalculated here, so they are skipped.'
              : 'One row per company with a header row: Company Name, Ticker, Sector, Include, Share Price, Diluted Shares, Tier (any order; unknown columns are skipped).'}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ fontSize: 16, padding: '4px 10px' }}>✕</button>
        </div>

        <textarea
          className="paste-box" autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'page'
            ? 'Revenue from Operations\t4,200\t4,750\t5,300\nOther Income\t45\t52\t60\nTrade Receivables\t580\t650\t720'
            : `${LIST_HEADER}\nABC Industries Ltd\tABC.NS\tSpecialty Chemicals\t1\t850\t12.5\t`}
        />

        {mode === 'list' && !text && (
          <div className="sec-note" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => setText(`${LIST_HEADER}\n`)}>Insert header row</button>
          </div>
        )}

        {mode === 'page' && parsed?.ok && (
          <div className="paste-ctrls">
            <label>
              First pasted column is
              <select value={parsed.offset} onChange={(e) => setOffset(parseInt(e.target.value, 10))}>
                {columns.map((c, i) => <option key={String(c.id)} value={i}>{c.label}</option>)}
              </select>
            </label>
          </div>
        )}

        {parsed && !parsed.ok && <div className="warn" style={{ marginTop: 12 }}>{parsed.reason}</div>}

        {mode === 'page' && parsed?.ok && (
          <>
            <div className="bulk-sec">
              <h4>{parsed.matched.length} line item{parsed.matched.length === 1 ? '' : 's'} will be written</h4>
              <div className="tablewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="fin">
                  <thead>
                    <tr>
                      <th>Page line</th><th>Pasted row(s)</th>
                      {parsed.slots.map((slot, i) => <th key={i} className={slot ? '' : 'muted'}>{slot ? slot.label : 'dropped'}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.matched.map((m) => (
                      <tr key={m.key}>
                        <td>{m.line}</td>
                        <td className="txt">{m.sources.join(' + ')}</td>
                        {parsed.slots.map((slot, j) => (
                          <td key={j} className={slot ? '' : 'muted'}>{m.group === 'bs' && slot?.id === 'p' ? 'n/a' : fmt(m.values[j])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.dropped > 0 && (
                <div className="warn" style={{ marginTop: 8 }}>
                  {parsed.dropped} pasted column{parsed.dropped === 1 ? '' : 's'} run past the page’s last input column and will be ignored — change “First pasted column is” if that is not intended.
                </div>
              )}
              <div className="sec-note" style={{ marginTop: 6 }}>
                Rows naming the same line are added together. A blank pasted cell leaves the page’s cell unchanged. The balance sheet has no prior-YTD column.
              </div>
            </div>
            {parsed.skipped.length > 0 && (
              <div className="bulk-sec">
                <h4>Calculated on the page — skipped</h4>
                <div className="sec-note">{parsed.skipped.map((u) => u.label).join(' · ')}</div>
              </div>
            )}
            {parsed.unmatched.length > 0 && (
              <div className="bulk-sec">
                <h4>Not recognised — skipped</h4>
                <div className="sec-note">{parsed.unmatched.map((u) => u.label).join(' · ')}</div>
              </div>
            )}
          </>
        )}

        {mode === 'list' && parsed?.ok && (
          <div className="bulk-sec">
            <h4>{parsed.companies.length} compan{parsed.companies.length === 1 ? 'y' : 'ies'}</h4>
            <div className="tablewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="fin">
                <thead><tr><th>Company</th><th>Ticker</th><th>Sector</th><th>Include</th><th>Share price</th><th>Diluted shares</th><th>Tier</th></tr></thead>
                <tbody>
                  {parsed.companies.map((c, i) => (
                    <tr key={i}>
                      <td>{c.name}</td><td className="txt">{c.ticker || '—'}</td><td className="txt">{c.sector || '—'}</td>
                      <td>{c.include ?? '—'}</td><td>{c.price !== undefined ? fmt(c.price) : '—'}</td>
                      <td>{c.shares !== undefined ? fmt(c.shares) : '—'}</td><td className="txt">{c.tier || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.unmatched?.length > 0 && <div className="sec-note" style={{ marginTop: 6 }}>Unrecognised columns skipped: {parsed.unmatched.join(' · ')}</div>}
          </div>
        )}

        <div className="bulk-foot">
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={apply} disabled={!parsed?.ok}>
            {mode === 'page' ? 'Apply to this page' : `Use ${parsed?.companies?.length || 0} compan${parsed?.companies?.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
