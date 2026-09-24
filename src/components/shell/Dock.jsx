import React from 'react';

/**
 * Right-hand assumptions dock. Every view gets: Key Levers on top, the
 * active method's panels, then shared panels — all live sliders.
 * On narrow screens it overlays with a scrim; on wide screens it's a column.
 */
export default function Dock({ open, title, onClose, children }) {
  return (
    <>
      <div className={`dock-scrim${open ? ' show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`dock${open ? ' open' : ''}`} aria-label="Assumptions" aria-hidden={!open}>
        <div className="dock-head">
          <div>
            <div className="dock-title">Assumptions</div>
            <div className="dock-sub">{title} · every drag recalculates the whole model</div>
          </div>
          <button className="dock-close" onClick={onClose} title="Hide dock (A)">✕</button>
        </div>
        <div className="dock-body">{children}</div>
      </aside>
    </>
  );
}
