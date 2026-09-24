/* ===================================================================
   Click-to-assumption: charts dispatch a request naming the slider(s)
   that drive the clicked series; App opens the dock and flashes them.
   detail: { labels?: string[], section?: string }
     labels  — NumberInput labels to flash (matched on data-assum)
     section — dock Section title to fall back to (data-assum-sec)
   =================================================================== */

export const ASSUME_EVENT = 'vs:assume';

export function requestAssumption(detail) {
  if (!detail || (!detail.labels?.length && !detail.section)) return;
  window.dispatchEvent(new CustomEvent(ASSUME_EVENT, { detail }));
}

/** Find the requested controls in the (now open) dock, open their
    collapsed section if needed, scroll to the first and flash them. */
export function flashAssumption({ labels = [], section } = {}) {
  const dock = document.querySelector('.dock');
  if (!dock) return;
  let targets = labels.flatMap((l) => [...dock.querySelectorAll(`[data-assum="${CSS.escape(l)}"]`)]);
  if (!targets.length && section) targets = [...dock.querySelectorAll(`[data-assum-sec="${CSS.escape(section)}"]`)];
  if (!targets.length) return;

  targets.forEach((el) => {
    const sec = el.closest('.section');
    if (sec && !sec.classList.contains('open')) sec.querySelector('.sec-head')?.click();
  });
  // let the section expand before scrolling
  setTimeout(() => targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  targets.forEach((el) => {
    el.classList.remove('assum-flash');
    void el.offsetWidth; // restart the animation if it was already flashing
    el.classList.add('assum-flash');
    setTimeout(() => el.classList.remove('assum-flash'), 3400);
  });
}
