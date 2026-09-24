import React, { useState } from 'react';

export default function Section({ title, children, defaultOpen = true, note }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${open ? ' open' : ''}`} data-assum-sec={title}>
      <div className="sec-head" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="chev">▶</span>
      </div>
      <div className="sec-wrap">
        <div className="sec-body">
          {note ? <div className="sec-note">{note}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
