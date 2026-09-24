/**
 * Apple-style scroll reveal. Every direct child of a `.view` starts slightly
 * translated + transparent (see styles.css) and glides into place when it
 * scrolls into the viewport; elements revealed in the same frame stagger.
 *
 * One IntersectionObserver drives the reveal; a MutationObserver picks up
 * nodes React adds later (tab switches, conditional warnings, chart focus),
 * so the effect survives remounts without any per-tab wiring. MutationObserver
 * callbacks run as microtasks — before the next paint — so newly mounted
 * sections are hidden and observed before they can flash.
 *
 * Honours prefers-reduced-motion: when set, nothing is observed and the CSS
 * fallback shows everything statically.
 */
export function initScrollReveal() {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches) return () => {};

  const io = new IntersectionObserver(
    (entries) => {
      let batch = 0;
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        el.style.transitionDelay = `${Math.min(batch * 55, 220)}ms`;
        el.classList.add('sr-in');
        io.unobserve(el);
        batch++;
      }
    },
    // reveal a touch before the element's top clears the fold
    { rootMargin: '0px 0px -8% 0px', threshold: 0.04 }
  );

  const prep = (el) => {
    if (el.classList.contains('sr')) return;
    el.classList.add('sr');
    io.observe(el);
  };
  // fixed-position overlays (chart focus modal) are excluded — transforms
  // would break their viewport positioning
  const scan = () => document.querySelectorAll('.view > *:not(.sr):not(.chart-modal-ov)').forEach(prep);

  scan();
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes.length) { scan(); return; }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // if the user flips reduced-motion on mid-session, show everything and stop
  const onMq = () => {
    if (!mq.matches) return;
    document.querySelectorAll('.view > .sr').forEach((el) => el.classList.add('sr-in'));
    io.disconnect();
    mo.disconnect();
  };
  mq.addEventListener?.('change', onMq);

  return () => {
    io.disconnect();
    mo.disconnect();
    mq.removeEventListener?.('change', onMq);
    // untag anything not yet revealed so a re-init (React StrictMode double
    // effect, HMR) can observe it again — otherwise it stays hidden forever
    document.querySelectorAll('.view > .sr:not(.sr-in)').forEach((el) => el.classList.remove('sr'));
  };
}
