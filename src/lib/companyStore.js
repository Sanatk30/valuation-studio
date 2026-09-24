const KEY = 'valuation-studio-companies';

export function readLib() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function writeLib(lib) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
  } catch { /* storage full / private mode */ }
}

export function saveCompany(a) {
  const name = (a.company.name || '').trim() || 'Untitled company';
  const lib = readLib();
  lib[name] = { savedAt: lib[name]?.savedAt ?? Date.now(), updatedAt: Date.now(), data: a };
  writeLib(lib);
  return name;
}

/** Auto-save: refresh a company that's already in the library; never creates
 *  new entries (so half-typed names while renaming don't pollute the list). */
export function updateExistingCompany(a) {
  const name = (a.company.name || '').trim();
  if (!name) return;
  const lib = readLib();
  if (!lib[name]) return;
  lib[name] = { savedAt: lib[name].savedAt, updatedAt: Date.now(), data: a };
  writeLib(lib);
}

export function deleteCompany(name) {
  const lib = readLib();
  delete lib[name];
  writeLib(lib);
}
