import React, { useEffect, useRef, useState } from 'react';

/*
 * The animations the user picked (design-concepts/animations.html):
 *   3A numbers count from the old value to the new one   → <CountUp>
 *   11B table / sensitivity cells roll in when they change → <Roll>
 *   13B a ripple spreads from a button click              → installRipple()
 * Everything else is CSS (flow.css, "motion" section). All of it is off when
 * the computer asks for reduced motion.
 */
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Split "₹1,402.84 Cr" into prefix, number, suffix; null when there is no number. */
function parse(text) {
  const m = String(text ?? '').match(/^(.*?)(−|-)?(\d[\d,]*(?:\.\d+)?)(.*)$/s);
  if (!m) return null;
  const raw = m[3];
  const dec = raw.includes('.') ? raw.split('.')[1].length : 0;
  const grouped = raw.includes(',');
  const value = Number(raw.replace(/,/g, '')) * (m[2] ? -1 : 1);
  if (!Number.isFinite(value)) return null;
  // Indian grouping (12,34,567) vs western (1,234,567)
  const indian = /\d,\d\d,\d{3}/.test(raw);
  return { pre: m[1], suf: m[4], dec, grouped, indian, value, neg: m[2] || '-' };
}
function format(p, v) {
  const s = Math.abs(v).toFixed(p.dec);
  let [i, d] = s.split('.');
  if (p.grouped) {
    if (p.indian && i.length > 3) i = `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i.slice(-3)}`;
    else i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return `${p.pre}${v < 0 ? p.neg : ''}${i}${d ? `.${d}` : ''}${p.suf}`;
}

/** A formatted number that counts from its previous value to the new one. */
export function CountUp({ children, ms = 700 }) {
  const text = String(children ?? '');
  const [shown, setShown] = useState(text);
  const onScreen = useRef(text);   // what is showing now — a count interrupted mid-way carries on from here
  useEffect(() => {
    const show = (s) => { onScreen.current = s; setShown(s); };
    const from = parse(onScreen.current), to = parse(text);
    if (!from || !to || from.pre !== to.pre || from.suf !== to.suf || reduced() || from.value === to.value) { show(text); return undefined; }
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3;
      show(k >= 1 ? text : format(to, from.value + (to.value - from.value) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return <>{shown}</>;
}

/** A cell value that rolls in when it changes (not on the first render). */
export function Roll({ children }) {
  const text = String(children ?? '');
  const first = useRef(true);
  const [n, setN] = useState(0);
  const prev = useRef(text);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (prev.current !== text) { prev.current = text; setN((x) => x + 1); }
  }, [text]);
  return <span key={n} className={n ? 'roll-in' : undefined}>{children}</span>;
}

/** A soft ripple from the click point on buttons (13B). */
export function installRipple() {
  if (typeof document === 'undefined' || installRipple.done) return;
  installRipple.done = true;
  document.addEventListener('pointerdown', (e) => {
    if (reduced()) return;
    const b = e.target.closest?.('.btn, .tb-ic, .cm-res-b, .nc-seg > button, .mg, .dchip');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'rpl';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
  });
}
