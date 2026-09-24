import React, { useMemo, useState } from 'react';
import { parseGrid, applyGrid, parseWide, BLOCKS, WIDE_TEMPLATE_HEADER } from '../lib/compsPaste.js';

/**
 * Paste financials straight out of a spreadsheet.
 *
 * Two modes:
 *   grid — line items down, periods across, into one company's page.
 *   wide — one row per company, adding a whole peer set at once.
 *
 * Nothing is applied until you confirm: the dialog shows every row it matched,
 * where each column will land, and every row it could not place.
 */
export default function PasteDialog({ mode = 'grid', co, tiers = [], onApply, onClose }) {
  const [text, setText] = useState('');
  const [block, setBlock] = useState('');     // '' = auto-detect
  const [offset, setOffset] = useState(0);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return mode === 'grid'
      ? parseGrid(text, { block: block || null, offset })
      : parseWide(text, { tiers });
  }, [text, block, offset, mode, tiers]);

  const periods = parsed?.ok && mode === 'grid' ? parsed.periods : [];
  const maxOffset = parsed?.ok && mode === 'grid' ? Math.max(0, periods.length - 1) : 0;

  const apply = () => {
    if (!parsed?.ok) return;
    if (mode === 'grid') onApply(applyGrid(co, parsed));
    else onApply(parsed.companies.map((c) => c.co));
    onClose();
  };

  return (
    <div className="bulk-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bulk-modal" style={{ width: 'min(920px, 96vw)' }}>
        <div className="bulk-head">
          <h2>{mode === 'grid' ? `Paste financials — ${co?.name || 'company'}` : 'Paste a peer set'}</h2>
          <div className="sub">
            {mode === 'grid'
              ? 'Copy a block out of Excel: line items down the first column, one column per period. Rows are matched by label, so extra rows and subtotals in between are fine.'
              : 'One row per company, with a header row naming the columns. Add a period suffix (Sales FY0, Total debt Current, Estimated EBITDA NFY) or leave it off for the default period.'}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose} style={{ fontSize: 16, padding: '4px 10px' }}>✕</button>
        </div>

        <textarea
          className="paste-box"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'grid'
            ? 'Sales\t4,200.5\t4,704.6\t5,269.1\nCOGS\t(2,730.3)\t(3,057.0)\t(3,424.9)\nSG&A\t420.1\t470.5\t526.9'
            : `${WIDE_TEMPLATE_HEADER.split('\t').slice(0, 6).join('\t')}\t…`}
        />

        {mode === 'wide' && (
          <div className="sec-note" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => setText(`${WIDE_TEMPLATE_HEADER}\n`)}>Insert template header</button>
            <span style={{ marginLeft: 10 }}>Recognised column names include Company, Ticker, Tier, Price, Basic shares outstanding, and any line item from the input page.</span>
          </div>
        )}

        {mode === 'grid' && parsed?.ok && (
          <div className="paste-ctrls">
            <label>
              Paste into
              <select value={block || parsed.target} onChange={(e) => { setBlock(e.target.value); setOffset(0); }}>
                {Object.entries(BLOCKS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label>
              First column is
              <select value={offset} onChange={(e) => setOffset(parseInt(e.target.value, 10))}>
                {periods.map((p, i) => <option key={p} value={i} disabled={i > maxOffset}>{p}</option>)}
              </select>
            </label>
            {!block && <span className="sec-note">auto-detected from the row labels</span>}
          </div>
        )}

        {parsed && !parsed.ok && <div className="warn" style={{ marginTop: 12 }}>{parsed.reason}</div>}

        {/* ---------------- grid preview ---------------- */}
        {mode === 'grid' && parsed?.ok && (
          <>
            <div className="bulk-sec">
              <h4>{parsed.matched.length} line item{parsed.matched.length === 1 ? '' : 's'} will be updated</h4>
              <div className="tablewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="fin">
                  <thead>
                    <tr>
                      <th>Pasted label</th><th>Field</th>
                      {parsed.slots.map((slot, i) => (
                        <th key={i} className={slot == null ? 'muted' : ''}>{slot == null ? 'dropped' : periods[slot]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.matched.map((m, i) => (
                      <tr key={i}>
                        <td>{m.label}</td>
                        <td className="txt">{m.field.label}</td>
                        {parsed.slots.map((slot, j) => (
                          <td key={j} className={slot == null ? 'muted' : ''}>
                            {m.values[j]?.ok ? m.values[j].value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.dropped > 0 && (
                <div className="warn" style={{ marginTop: 8 }}>
                  {parsed.dropped} column{parsed.dropped === 1 ? '' : 's'} past “{periods[periods.length - 1]}” will be ignored — change the starting period above if that's not what you want.
                </div>
              )}
              <div className="sec-note" style={{ marginTop: 6 }}>A blank cell leaves the existing value alone; “—” means nothing will be written.</div>
            </div>

            {parsed.otherBlocks?.length > 0 && (
              <div className="bulk-sec">
                <h4>Held back — these belong to another block</h4>
                <div className="sec-note">
                  {parsed.otherBlocks.map((m) => m.label).join(' · ')} — switch “Paste into” to {BLOCKS[parsed.otherBlocks[0].field.group].label} to bring them in.
                </div>
              </div>
            )}
            {parsed.unmatched.length > 0 && (
              <div className="bulk-sec">
                <h4>Not recognised — these rows will be skipped</h4>
                <div className="sec-note">{parsed.unmatched.map((u) => u.label).join(' · ')}</div>
              </div>
            )}
          </>
        )}

        {/* ---------------- wide preview ---------------- */}
        {mode === 'wide' && parsed?.ok && (
          <>
            <div className="bulk-sec">
              <h4>{parsed.companies.length} compan{parsed.companies.length === 1 ? 'y' : 'ies'} will be added</h4>
              <div className="tablewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="fin">
                  <thead><tr><th>Company</th><th>Ticker</th><th>Tier</th><th>Price</th><th>FY0 sales</th><th>Fields filled</th></tr></thead>
                  <tbody>
                    {parsed.companies.map((c, i) => (
                      <tr key={i}>
                        <td>{c.co.name}</td>
                        <td className="txt">{c.co.ticker || '—'}</td>
                        <td className="txt">{c.co._tierName || (c.co.tierId ? '—' : 'unassigned')}</td>
                        <td>{c.co.price ? c.co.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</td>
                        <td>{c.co.is.sales[2] ? c.co.is.sales[2].toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'}</td>
                        <td>{c.fields.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {parsed.unmatched.length > 0 && (
              <div className="bulk-sec">
                <h4>Unrecognised columns — skipped</h4>
                <div className="sec-note">{parsed.unmatched.join(' · ')}</div>
              </div>
            )}
            <div className="sec-note">
              Anything the paste doesn't cover stays blank on each company's input page, and its issue badge lists what's still needed.
            </div>
          </>
        )}

        <div className="bulk-foot">
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={apply} disabled={!parsed?.ok}>
            {mode === 'grid' ? 'Apply to this page' : `Add ${parsed?.companies?.length || 0} compan${parsed?.companies?.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
