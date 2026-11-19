/*
 * Where Yahoo Finance calls go. Yahoo sends no CORS headers, so the browser
 * cannot call it directly:
 *   - `npm run dev`: the Vite dev-server proxy at /yf (vite.config.js);
 *   - the GitHub Pages build: the Cloudflare relay (relay/yahoo-relay.js),
 *     whose URL is VITE_YF_BASE in .env.production.
 */
const env = import.meta.env || {};
export const YF_BASE = String(env.VITE_YF_BASE || '/yf').replace(/\/+$/, '');

/** What to tell the user when a Yahoo call fails, for where the app is running. */
export const YF_HINT = env.VITE_YF_BASE
  ? 'the Yahoo relay could not be reached or Yahoo is busy; try again in a minute'
  : 'the Yahoo proxy needs the dev server (npm run dev)';
