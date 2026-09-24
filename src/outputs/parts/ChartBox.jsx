import React from 'react';
import LiveChart from '../../components/LiveChart.jsx';
import './outputs.css';

/** A titled chart card. `option` null → the reason it can't be drawn. */
export default function ChartBox({ title, option, height = 260, empty = 'Not enough data to draw this chart.', note, group }) {
  return (
    <div className="chartbox">
      {title ? <div className="ct">{title}</div> : null}
      {option ? <LiveChart option={option} height={height} group={group} /> : <div className="sec-note">{empty}</div>}
      {note ? <div className="sec-note" style={{ marginTop: 8, marginBottom: 0 }}>{note}</div> : null}
    </div>
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
