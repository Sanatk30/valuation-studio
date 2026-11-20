import { useSyncExternalStore } from 'react';
import { blankMethodState, METHOD_IDS } from './methodModel.js';

/**
 * Company library + per-method progress, persisted in the browser.
 *
 * State = { activeId, companies: { [id]: CompanyRecord } }
 * CompanyRecord = { id, name, currency, unit, startYear, fyEndMonth,
 *                   createdAt, updatedAt, methods: { [methodId]: MethodState } }
 * MethodState   = { data, step, skipped, completedAt, updatedAt }  (see methodModel)
 *
 * A fresh storage key: the pre-redesign single-model save is discarded, as agreed.
 */
const KEY = 'quant-value-v1';

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Comps, precedent, the DCF and the LBO moved to the template layout (company pages
 * with N fiscal years, peer / deal slots, per-year drivers). A save from the
 * earlier layout has no
 * `settings` block; that method starts blank again — its old inputs cannot be
 * mapped line for line onto the new pages. Every other method is untouched.
 */
export function migrate(state) {
  for (const rec of Object.values(state.companies || {})) {
    for (const id of ['comps', 'precedent', 'dcf', 'lbo']) {
      const d = rec.methods?.[id]?.data;
      if (d && !d[id]?.settings) rec.methods[id] = blankMethodState(id);
    }
    // The DCF beta method used to start as 'direct'; it now starts blank (round 4). A saved
    // 'direct' with no beta typed is that old default, not a choice the user made: it goes
    // back to blank, so an untouched DCF reads "not started" and the user picks the method.
    // A typed beta keeps 'direct'.
    const ms = rec.methods?.dcf;
    const capm = ms?.data?.dcf?.capm;
    if (isObj(capm) && capm.betaMode === 'direct' && !Number.isFinite(capm.beta)) {
      rec.methods.dcf = { ...ms, data: { ...ms.data, dcf: { ...ms.data.dcf, capm: { ...capm, betaMode: null } } } };
    }
  }
  return state;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A saved state the shell can always render: company entries that are not
 * records are dropped, every method has a state (a missing or unreadable one
 * starts blank), and `activeId` names a company that exists — else the most
 * recently edited one, so saved companies never hide behind the first-run card.
 */
export function normalizeState(raw) {
  if (!isObj(raw) || !isObj(raw.companies)) return { activeId: null, companies: {} };
  const companies = {};
  for (const [id, rec] of Object.entries(raw.companies)) {
    if (!isObj(rec)) continue;
    const methods = isObj(rec.methods) ? { ...rec.methods } : {};
    for (const m of METHOD_IDS) if (!isObj(methods[m]) || !isObj(methods[m].data)) methods[m] = blankMethodState(m);
    companies[id] = { ...rec, id, methods };
  }
  const st = migrate({ ...raw, companies });
  if (!companies[st.activeId]) {
    st.activeId = Object.values(companies).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id ?? null;
  }
  return st;
}

function read() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(KEY)));
  } catch { /* private mode, corrupt save */ }
  return { activeId: null, companies: {} };
}

let state = read();
const listeners = new Set();

/** The current state (tests; components use useStore). */
export const getState = () => state;

/**
 * Another tab of the app saved: take its state, so this tab's next save does
 * not write its older copy over the companies and edits made there.
 */
export function syncFromStorage(json) {
  let next;
  try { next = normalizeState(JSON.parse(json)); } catch { return; }
  if (next.companies[state.activeId]) next.activeId = state.activeId;   // each tab keeps the company it shows
  state = next;
  listeners.forEach((l) => l());
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) syncFromStorage(e.newValue); });
}

function commit(next) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* storage full / private mode — the session still works */ }
  listeners.forEach((l) => l());
}

export function useStore() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
  );
}

/* ------------------------------------------------------------ companies */

export function createCompany({ name, currency, unit, startYear, fyEndMonth }) {
  const id = uid();
  const now = Date.now();
  const rec = {
    id, name: name.trim(), currency, unit, startYear, fyEndMonth,
    createdAt: now, updatedAt: now,
    methods: Object.fromEntries(METHOD_IDS.map((m) => [m, blankMethodState(m)])),
  };
  commit({ activeId: id, companies: { ...state.companies, [id]: rec } });
  return id;
}

export function setActive(id) {
  if (state.companies[id]) commit({ ...state, activeId: id });
}

/** Replace a whole company record (used by currency/unit conversion). */
export function replaceCompany(rec) {
  commit({ ...state, companies: { ...state.companies, [rec.id]: { ...rec, updatedAt: Date.now() } } });
}

export function updateCompany(id, patch) {
  const rec = state.companies[id];
  if (!rec) return;
  replaceCompany({ ...rec, ...patch });
}

export function duplicateCompany(id, name) {
  const rec = state.companies[id];
  if (!rec) return null;
  const nid = uid();
  const copy = JSON.parse(JSON.stringify(rec));
  const now = Date.now();
  commit({
    activeId: nid,
    companies: { ...state.companies, [nid]: { ...copy, id: nid, name: name.trim(), createdAt: now, updatedAt: now } },
  });
  return nid;
}

export function deleteCompany(id) {
  const companies = { ...state.companies };
  delete companies[id];
  const rest = Object.values(companies).sort((a, b) => b.updatedAt - a.updatedAt);
  commit({ activeId: state.activeId === id ? rest[0]?.id ?? null : state.activeId, companies });
}

/* -------------------------------------------------------------- methods */

/** Apply `fn(methodState) → methodState` to one method of one company. */
export function updateMethod(companyId, methodId, fn) {
  const rec = state.companies[companyId];
  if (!rec) return;
  const cur = rec.methods[methodId] || blankMethodState(methodId);
  const next = { ...fn(cur), updatedAt: Date.now() };
  replaceCompany({ ...rec, methods: { ...rec.methods, [methodId]: next } });
}

export function resetMethod(companyId, methodId) {
  updateMethod(companyId, methodId, () => blankMethodState(methodId));
}

/* ------------------------------------------------------- path helpers */

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Immutable set; `value` may be a function of the current value. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const root = Array.isArray(obj) ? obj.slice() : { ...obj };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const v = cur[k];
    cur[k] = Array.isArray(v) ? v.slice() : { ...(v || {}) };
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  cur[last] = typeof value === 'function' ? value(cur[last]) : value;
  return root;
}
