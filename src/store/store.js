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

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object' && raw.companies) return raw;
  } catch { /* private mode, corrupt save */ }
  return { activeId: null, companies: {} };
}

let state = load();
const listeners = new Set();

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
export const getState = () => state;

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
