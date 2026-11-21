import React from 'react';

/**
 * The model's years as a timeline (the chosen Settings design): history in
 * grey, forecast / holding years in teal, then the terminal value (DCF) or the
 * exit (LBO). Hover any year for its dates and how it is used; the dashed
 * marker is the valuation date.
 *   hist, fcst      — year labels
 *   startYear       — Year 1 (the calendar year the first forecast year ends in)
 *   fyEndMonth      — 1–12
 *   tail            — { label, sub, tip } for the last box (terminal value / exit)
 *   valDate         — 'YYYY-MM-DD' or ''
 *   fcstSub         — word under each forecast box ('forecast' / 'holding')
 */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Timeline({ hist, fcst, startYear, fyEndMonth = 12, tail, valDate, fcstSub = 'forecast', fcstTip }) {
  const m = Number(fyEndMonth) || 12;
  const span = (endYear) => (m === 12 ? `1-Jan-${endYear} to 31-Dec-${endYear}` : `1-${MON[m % 12]}-${endYear - 1} to ${new Date(endYear, m, 0).getDate()}-${MON[m - 1]}-${endYear}`);
  const y1 = Number.isInteger(startYear) ? startYear : null;
  const boxes = [
    ...hist.map((l, i) => ({ l, k: 'h', sub: i === hist.length - 1 ? 'latest actual' : 'history', end: y1 ? y1 - (hist.length - i) : null,
      tip: i === hist.length - 1 ? 'The latest year that has ended — the base everything grows from.' : 'An actual year — its ratios sit beside the drivers for reference.' })),
    ...fcst.map((l, i) => ({ l, k: 'f', sub: fcstSub, end: y1 ? y1 + i : null, tip: fcstTip ? fcstTip(i, fcst.length) : (i === fcst.length - 1 ? 'The final forecast year — its cash flow sets the terminal value.' : `Forecast year ${i + 1}.`) })),
  ];
  // the valuation date sits after the latest actual year (its own position is approximate)
  // read 'YYYY-MM-DD' as a calendar date (new Date() would take it as UTC and shift it a day west of UTC)
  const vm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valDate || '');
  const vdTxt = vm && Number(vm[2]) >= 1 && Number(vm[2]) <= 12 ? `${Number(vm[3])}-${MON[Number(vm[2]) - 1]}-${vm[1]}` : null;
  return (
    <div className="tl2">
      <div className="tl2-row" style={{ gridTemplateColumns: `repeat(${boxes.length + (tail ? 1 : 0)}, minmax(0, 1fr))` }}>
        {boxes.map((b, i) => (
          <div key={i} className={`tl2-y ${b.k}${i === hist.length ? ' first' : ''} has-tip`} tabIndex={0}>
            <b>{b.l}</b><small>{b.sub}</small>
            <span className="tipcard" role="tooltip"><b>{b.l}{b.end ? ` · ${span(b.end)}` : ''}</b><span>{b.tip}</span></span>
            {i === hist.length && <span className="tl2-vd" aria-hidden="true"><em>{vdTxt ? `Valuation date ${vdTxt}` : 'Valuation date = latest year end'}</em></span>}
          </div>
        ))}
        {tail && (
          <div className="tl2-y t has-tip" tabIndex={0}>
            <b>{tail.label}</b><small>{tail.sub}</small>
            <span className="tipcard" role="tooltip"><b>{tail.label}</b><span>{tail.tip}</span></span>
          </div>
        )}
      </div>
      <div className="tl2-legend"><span>◂ {hist.length} historical year{hist.length === 1 ? '' : 's'} ▸</span><span>◂ {fcst.length} {fcstSub} year{fcst.length === 1 ? '' : 's'} ▸ · FY ends {MON[m - 1]}</span></div>
    </div>
  );
}
