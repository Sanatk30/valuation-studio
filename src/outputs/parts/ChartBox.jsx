import React, { useEffect, useState } from 'react';
import LiveChart from '../../components/LiveChart.jsx';
import './outputs.css';

/**
 * A titled chart card. `option` null → the reason it can't be drawn. `sub` is
 * a one-line reading guide under the title. The expand button opens the chart
 * full-window (Esc or the button closes it).
 */
export default function ChartBox({ title, sub, option, height = 360, empty = 'Not enough data to draw this chart.', note, group }) {
  const [big, setBig] = useState(false);
  // charts are drawn large: a requested height is raised to at least 340 px
  const h = typeof height === 'number' ? Math.max(height + 80, 340) : height;
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  const head = (
    <div className="ct-row">
      <div>
        {title ? <div className="ct">{title}</div> : null}
        {sub ? <div className="cs">{sub}</div> : null}
      </div>
      {option ? (
        <button type="button" className="ct-expand" onClick={() => setBig((b) => !b)} title={big ? 'Close (Esc)' : 'Expand'} aria-label={big ? 'Close the expanded chart' : 'Expand the chart'}>
          {big ? '✕' : '⤢'}
        </button>
      ) : null}
    </div>
  );
  return (
    <>
      <div className="chartbox">
        {head}
        {option ? <LiveChart option={option} height={h} group={group} /> : <div className="sec-note">{empty}</div>}
        {note ? <div className="sec-note" style={{ marginTop: 8, marginBottom: 0 }}>{note}</div> : null}
      </div>
      {big && option && (
        <div className="bulk-ov chart-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          <div className="chartbox chart-full">
            {head}
            <LiveChart option={option} height="min(70vh, 640px)" />
          </div>
        </div>
      )}
    </>
  );
}

/** An engine failure, shown instead of the page it would have produced. */
export function EngineError({ what, error }) {
  return (
    <div className="warn">
      {what} could not be computed from the inputs{error?.message ? `: ${error.message}` : ''}. Use Edit on the step
      that holds the input to fix it.
    </div>
  );
}
