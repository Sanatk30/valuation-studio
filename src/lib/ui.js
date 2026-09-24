import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Keep an absolutely-positioned dropdown inside the viewport. The menu is
 * authored as right-aligned (CSS `right: 0`); when its anchor button sits near
 * the left edge (e.g. after the header wraps) that would push it off-screen, so
 * we measure on open and pin an explicit `left` clamped to the viewport.
 * Returns [ref, style] — spread the style onto the menu element.
 */
export function useEdgeClamp(open) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const el = ref.current;
    const parent = el.offsetParent;
    if (!parent) return;
    const pr = parent.getBoundingClientRect();
    const w = el.offsetWidth;
    const pad = 12;
    const vw = window.innerWidth;
    let vx = pr.right - w;                  // viewport-left the menu wants at right:0
    if (vx + w > vw - pad) vx = vw - pad - w;
    if (vx < pad) vx = pad;
    setPos({ left: Math.round(vx - pr.left), right: 'auto' });
  }, [open]);

  return [ref, pos || undefined];
}
