import React, { useEffect, useReducer, useRef } from 'react';

/**
 * Spring-style tweening for live numbers. Exponential approach with a ~140ms
 * time constant: fast enough to feel instant, slow enough that every figure
 * on screen visibly flows when an assumption moves.
 */
export function useTweenedNumber(target, tau = 0.14) {
  const [, force] = useReducer((x) => x + 1, 0);
  const st = useRef({ cur: target, raf: 0, last: 0 });

  useEffect(() => {
    const s = st.current;
    if (!isFinite(target) || !isFinite(s.cur)) {
      s.cur = target;
      force();
      return;
    }
    cancelAnimationFrame(s.raf);
    s.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.064, (now - s.last) / 1000);
      s.last = now;
      s.cur += (target - s.cur) * (1 - Math.exp(-dt / tau));
      const scale = Math.max(1, Math.abs(target));
      if (Math.abs(target - s.cur) < scale * 5e-5) {
        s.cur = target;
        force();
        return;
      }
      force();
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
  }, [target, tau]);

  return st.current.cur;
}

/** Tween a whole numeric array (length changes snap instantly). */
export function useTweenedArray(target, tau = 0.14) {
  const [, force] = useReducer((x) => x + 1, 0);
  const st = useRef({ cur: target.slice(), raf: 0, last: 0 });
  const key = target.join('|');

  useEffect(() => {
    const s = st.current;
    if (s.cur.length !== target.length || target.some((v) => !isFinite(v)) || s.cur.some((v) => !isFinite(v))) {
      s.cur = target.slice();
      force();
      return;
    }
    cancelAnimationFrame(s.raf);
    s.last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.064, (now - s.last) / 1000);
      s.last = now;
      const k = 1 - Math.exp(-dt / tau);
      let maxRel = 0;
      for (let i = 0; i < target.length; i++) {
        s.cur[i] += (target[i] - s.cur[i]) * k;
        maxRel = Math.max(maxRel, Math.abs(target[i] - s.cur[i]) / Math.max(1, Math.abs(target[i])));
      }
      if (maxRel < 5e-5) {
        s.cur = target.slice();
        force();
        return;
      }
      force();
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return st.current.cur;
}

/** Drop-in animated number: <Anim value={x} fmt={(v)=>fmtPrice(v,s)} /> */
export function Anim({ value, fmt = (v) => v, tau }) {
  const v = useTweenedNumber(value, tau);
  return <>{fmt(v)}</>;
}

