import React, { useMemo, useState } from 'react';
import { IS_LINES, BS_LINES, CF_LINES, RATIO_LINES, computePage, fyValues, setCell } from '../lib/engine/companyPage.js';
import { CURRENCIES, UNITS, fmtTpl } from '../lib/format.js';
import { NumBox } from '../wizard/Field.jsx';
import PasteDialog from './PasteDialog.jsx';

/**
 * One company page of the templates, on screen: the income statement, balance
 * sheet and cash flow (blue input cells, black calculated rows), the market
 * data / deal-terms block and the key ratios — the same rows, columns and
 * formulas as the Excel sheet the method downloads.
 *
 *   n        fiscal years shown (1–10)
 *   ytd      prior / current YTD columns on the page
 *   labels   { fy: [], p, c, ltm } — column headers
 *   onLabels optional: makes the header row editable (precedent pages carry
 *            their own labels)
 *   market   { price, shares } (listed) or { dealEquity, stake, consideration }
 *   historicals  the DCF templates' Historicals sheet: fiscal years only — no
 *            YTD or LTM column, no Total Income row, no market block, no ratios
 */
export default function TemplatePageEditor({
  page, onChange, n, ytd: ytdIn = true, labels, onLabels, toggle = 1, inv = 0, market = {}, company, notes, actions, historicals = false,
}) {
  const ytd = historicals ? false : ytdIn;
  const [open, setOpen] = useState({ is: true, bs: false, cf: false, ratios: false });
  const [pasting, setPasting] = useState(false);
  const r = useMemo(() => computePage(page, { n, toggle, ytd, market, inv }), [page, n, toggle, ytd, market, inv]);
  const locale = CURRENCIES[company?.currency]?.locale || 'en-IN';
  const sym = CURRENCIES[company?.currency]?.symbol || '';
  const unit = UNITS[company?.unit] || '';
  const deal = 'dealEquity' in market;

  // input columns in order: FY 0…n−1, then (with YTD) prior and current YTD
  const inputCols = [
    ...Array.from({ length: n }, (_, i) => ({ id: i, label: labels.fy[i] })),
    ...(ytd ? [{ id: 'p', label: labels.p }, { id: 'c', label: labels.c }] : []),
  ];
  const span = inputCols.length + (historicals ? 1 : 2);
  const colIndex = (id) => (id === 'p' ? n : id === 'c' ? n + 1 : id);
  const L = n + 2;

  const set = (key, id, v) => onChange(setCell(page, key, id, v, n));
  const inputVal = (key, id) => {
    const line = page?.lines?.[key];
    if (id === 'p' || id === 'c') return line?.[id] ?? null;
    return fyValues(line, n)[id];
  };

  const setLabel = (id, v) => {
    if (!onLabels) return;
    const cur = { fy: [...labels.fy], p: labels.p, c: labels.c, ltm: labels.ltm };
    if (id === 'p' || id === 'c' || id === 'ltm') cur[id] = v; else cur.fy[id] = v;
    onLabels(cur);
  };

  const head = (
    <thead>
      <tr>
        <th>Particulars</th>
        {inputCols.map((c) => (
          <th key={String(c.id)} className={typeof c.id === 'number' ? '' : 'tp-ytd'}>
            {onLabels ? <input className="tp-lab" value={c.label || ''} onChange={(e) => setLabel(c.id, e.target.value)} /> : c.label}
          </th>
        ))}
        {!historicals && <th className="tp-ltm">{onLabels ? <input className="tp-lab" value={labels.ltm || ''} onChange={(e) => setLabel('ltm', e.target.value)} /> : labels.ltm}</th>}
      </tr>
    </thead>
  );

  const fmtFor = (line) => (line.kind === 'shares' || line.kind === 'pershare' ? 'n2' : 'n1');
  const statementRows = (lines, group) => lines.filter((line) => !(historicals && line.key === 'totalIncome')).map((line) => {
    if (line.head) return <tr key={`h${line.row}`} className="tp-head"><td colSpan={span}>{line.head}</td></tr>;
    const vals = r.v[line.key];
    const bad = line.key === 'check' && vals.some((x) => typeof x === 'number' && x !== 0);
    return (
      <tr key={line.key} className={`${line.sub ? 'tp-sub' : ''}${bad ? ' tp-bad' : ''}`}>
        <td>{line.label}{line.kind === 'shares' ? ` (${unit})` : line.kind === 'pershare' ? ` (${sym})` : ''}</td>
        {inputCols.map((c) => {
          const na = group === 'bs' && c.id === 'p';
          if (na) return <td key={String(c.id)} className="tp-na" />;
          if (line.input) {
            return (
              <td key={String(c.id)} className="tp-in">
                <NumBox small value={inputVal(line.key, c.id)} onChange={(v) => set(line.key, c.id, v)} />
              </td>
            );
          }
          return <td key={String(c.id)}>{fmtTpl(vals[colIndex(c.id)], fmtFor(line), locale)}</td>;
        })}
        {!historicals && <td className="tp-ltm">{fmtTpl(vals[L], fmtFor(line), locale)}</td>}
      </tr>
    );
  });

  const ratioRows = RATIO_LINES.map((line) => {
    if (line.head) return <tr key={`h${line.row}`} className="tp-head"><td colSpan={span}>{line.head}</td></tr>;
    const vals = r.v[line.key];
    const fmt = line.fmt === 'days' ? 'n0' : line.fmt;
    return (
      <tr key={line.key}>
        <td>{line.label}</td>
        {inputCols.map((c) => (typeof c.id === 'number'
          ? <td key={String(c.id)} className={vals[c.id] === 'n.a.' ? 'tp-mute' : ''}>{fmtTpl(vals[c.id], fmt, locale)}</td>
          : <td key={String(c.id)} className="tp-na" />))}
        <td className={`tp-ltm${vals[L] === 'n.a.' ? ' tp-mute' : ''}`}>{fmtTpl(vals[L], fmt, locale)}</td>
      </tr>
    );
  });

  const m = r.market;
  const money = (v) => fmtTpl(v, 'n1', locale);
  const mkt = deal
    ? [
      ['Implied Equity Value (100%)', money(m.equity), true],
      ['Stake Acquired', Number.isFinite(market.stake) ? `${fmtTpl(market.stake / 100, 'pct', locale)}` : ''],
      ['Consideration Paid', money(market.consideration)],
    ]
    : [
      [`Share Price (${sym})`, fmtTpl(market.price, 'n2', locale)],
      [`Diluted Shares Outstanding (${unit}) – TSM`, fmtTpl(market.shares, 'n2', locale)],
      ['Market Capitalisation', money(m.equity)],
    ];
  const bridge = [
    ['(+) Total Borrowings', money(m.borrowings)],
    [`(+) Lease Liabilities (${toggle ? 'included' : 'excluded'} by the lease toggle)`, money(m.leases)],
    ['(−) Cash, Bank Balances & Current Investments', money(m.cashLike)],
    ['Net Debt / (Net Cash)', money(m.netDebt), true],
    ['(+) Non-controlling Interest', money(m.nci)],
    [`(−) Non-operating investments (${inv ? 'deducted' : 'kept in EV'} by the investments toggle)`, money(m.nonOp)],
    [deal ? 'Implied Enterprise Value' : 'Enterprise Value', money(m.ev), true],
    ['Book Value of Equity (owners)', money(m.bookEquity)],
    ...(deal ? [] : [[`Book Value per Share (${sym})`, fmtTpl(m.bvps, 'n2', locale)]]),
  ];

  const section = (id, title, body) => (
    <>
      <tr className="tp-sec" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
        <td colSpan={span}>{open[id] ? '▾' : '▸'} {title}</td>
      </tr>
      {open[id] && body}
    </>
  );

  const checkBad = r.v.check.some((x) => typeof x === 'number' && x !== 0);

  return (
    <div className="tp">
      <div className={historicals ? 'tp-top tp-top-h' : 'tp-top'}>
        {!historicals && <div className="tp-mkt">
          <div className="tp-mkt-h">{deal ? 'Deal Terms & Implied Transaction Value' : 'Market Data & Enterprise Value'} <span>{sym} {unit}</span></div>
          <table className="fin compact">
            <tbody>
              {[...mkt, ...bridge].map(([k, v, b]) => <tr key={k} className={b ? 'tp-sub' : ''}><td>{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
          <div className="fld-h">Balance-sheet items use the LTM column{ytd ? ' (the interim balance sheet when entered, else the latest FY)' : ' (the latest FY)'}.</div>
        </div>}
        <div className="tp-side">
          {notes}
          <div className="row-btns">
            <button className="btn sm" onClick={() => setPasting(true)}>Paste from Excel</button>
            {actions}
          </div>
          {checkBad && <div className="fld-e">The balance sheet does not balance in at least one column — see the Balance Check row.</div>}
          <div className="fld-h">
            {sym} {unit} unless stated. Expenses positive in the P&amp;L (exceptional items: gain +, loss −); cash-flow outflows negative, as reported.
            {historicals ? '' : ytd ? ' P&L and cash flow LTM = latest FY + current YTD − prior YTD (blank YTD → LTM = latest FY).' : ' No YTD columns: LTM = latest FY.'}
            {' '}A blank cell counts as 0.
          </div>
        </div>
      </div>

      <div className="tablewrap tp-grid">
        <table className="fin compact">
          {head}
          <tbody>
            {section('is', 'INCOME STATEMENT', statementRows(IS_LINES, 'is'))}
            {section('bs', 'BALANCE SHEET', statementRows(BS_LINES, 'bs'))}
            {section('cf', 'CASH FLOW STATEMENT', statementRows(CF_LINES, 'cf'))}
            {!historicals && section('ratios', 'KEY RATIOS (fiscal years & LTM)', ratioRows)}
          </tbody>
        </table>
      </div>

      {pasting && (
        <PasteDialog
          mode="page" page={page} n={n} columns={inputCols}
          onApply={(pg) => onChange(pg)} onClose={() => setPasting(false)}
        />
      )}
    </div>
  );
}
