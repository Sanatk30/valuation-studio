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
    <section className={`qo-coll${open ? ' open' : ''}`} data-title={String(title)}>
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

/**
 * Vertical stack of collapsible sections, with a sticky bar of their titles:
 * a click opens that section (if closed) and scrolls to it.
 */
export function Sections({ children }) {
  const items = React.Children.toArray(children).filter((c) => c && c.props && c.props.title);
  const go = (title) => {
    const el = document.querySelector(`.qo-coll[data-title="${CSS.escape(String(title))}"]`);
    if (!el) return;
    if (!el.classList.contains('open')) el.querySelector('.qo-coll-head')?.click();
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  return (
    <>
      {items.length > 1 && (
        <nav className="sec-bar" aria-label="Sections">
          {items.map((c) => <button key={c.props.title} type="button" onClick={() => go(c.props.title)}>{shortTitle(c.props)}</button>)}
        </nav>
      )}
      <div className="qo-sections">{children}</div>
    </>
  );
}

/** A section's chip label: its tag in words when it has one, else the title up to the first dash or colon. */
const shortTitle = ({ title, tag }) => {
  const t = String(title);
  const head = t.split(/ — |: /)[0];
  return head.length > 34 ? `${head.slice(0, 32)}…` : head || tag;
};
