import React, { useId, useState } from 'react';
import './outputs.css';

/**
 * A detail section on an output page — CLOSED by default (the user's layout
 * choice: the answer on top, the build-up one click away).
 *
 * The body mounts only while open, so the charts and grids inside a closed
 * section cost nothing and ECharts never measures a zero-width container.
 */
export default function Collapsible({ title, tag, note, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`qo-coll${open ? ' open' : ''}`}>
      <button
        type="button" className="qo-coll-head"
        aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="qo-chev" aria-hidden="true">▶</span>
        {tag ? <span className="qo-coll-tag">{tag}</span> : null}
        <span>{title}</span>
        {note ? <span className="qo-coll-note">{note}</span> : null}
      </button>
      {open && <div className="qo-coll-body" id={id}>{children}</div>}
    </section>
  );
}

/** Vertical stack of collapsible sections. */
export function Sections({ children }) {
  return <div className="qo-sections">{children}</div>;
}
