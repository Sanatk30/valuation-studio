# Status — rebuild complete (2026-09-25)

Every stream below is finished and integrated: all eight methods run end to
end in the browser (wizard, Fill-all, edit-from-output, Start over, Combined,
currency / unit conversion), each exports its own live-formula Excel file, and
`npm test` (engines, Excel recalculation on the sample model + 55 edge cases,
structure, Yahoo / FX, data model) and `npm run build` pass. Superseded code
(old tabs, panels, dock / rail / ticker shell, their libs and CSS) is deleted.
The round-3 answers are recorded at the end of `docs/STEPWISE_SPEC.md`.
The notes below are the history of how the work was split.

---

# Handoff — Quant Value stepwise rebuild (state at 2026-09-24 ~16:20 IST)

Read in this order: `docs/STEPWISE_SPEC.md` (the user's agreed spec — every
decision came from Q&A), `docs/CONTRACT.md` (interfaces between the work
streams), then this file. The user's standing rules: **no assumptions — ask if
anything is unclear**; run work in **parallel agents**; don't reduce quality;
clean out code that is no longer needed; work through **every method end to
end** until it is bug-free.

Pre-rebuild source backup: `backup/src-before-stepwise-2026-09-24.tar.gz`.

## Streams and where each stopped
The three local agents were cut off by an API session limit; their partial work
is in this commit. Restart each as its own agent with the contract section as
its brief.

### Stream 0 — shell (lead) — mostly done
Done: `src/App.jsx` (hash routing `#/dcf`), `src/store/store.js` (company library,
localStorage key `quant-value-v1`), `src/store/methodModel.js` (per-method blank
data + `toEngineInput`), `src/methods/*` (fields/validation, registry, progress,
figures for Combined, combined step + output), `src/methods/steps/*` (every
step), `src/wizard/*` (MethodPage: rail, strict Next/Back, skip, edit-from-output,
preview card; FillAllDialog; Field/NumBox; YearGrid), `src/home/*` (top bar with
company pill, first-run card, method picker, company settings with currency and
unit conversion), `src/shell.css`, theme tokens in `src/styles.css`
(green-on-navy), `public/favicon.svg`, README, `test/shell-model.test.mjs` (passes).
`src/components/CompanyPageEditor.jsx` made LTM-only and blank-aware.
Still to do: `DealPageEditor.jsx` blank-aware (null stays null, core blank = NA,
adjustment blank = none); integrate once the other streams land (the app does
not build yet — it imports `ListingSearch.jsx`, `currency.js` exports and the
missing output pages); delete superseded code (below); full end-to-end QA of
every method in the browser; package.json test script already runs every
`test/*.test.mjs`.

### Stream 1 — engines + Excel — about 35 %
Changed so far: `engine/drivers.js` (explicit ebitda0 / nwc0), `engine/tax.js`
(new NOL schedule), `engine/dcf.js` (NOL, normalised TV + NOL PV, reported
history), `engine/wacc.js` (betaPeerStats), `engine/lbo.js` (in progress:
cashAtClose, NOL, sens, floor range), `engine/threeStatement.js`.
Not started: IPO greenshoe; comps LTM-only + blank semantics (`compsCo`,
`comps`, `compsPaste`); precedent target; regression (reported growth, size vars
`revSize`/`mktCapSize`, and the bug below); `computeHistoryRatios`; the whole
per-method Excel export; every test update. Tests `comps`, `excel*` currently
fail on `HIST_CLAMP` no longer exported from `dcf.js`.
Known bug to fix: `regressionModel.targetValues()` uses global `isFinite(ov)`;
a cleared override is `null`, `isFinite(null) === true`, so it becomes 0. Sweep
engine/excel code for the same null-as-0 pattern.

### Stream 2 — Yahoo / FX / currency — about 40 %
Done: `lib/yahoo.js` rewrite (TTM-else-FY LTM, financial vs price currency,
reported interest/tax, `mapListing`), `lib/fx.js`, `test/fixtures/yahoo/` started.
Missing: `components/ListingSearch.jsx` (DEFAULT export, props
`{ company, onApply(mapped) }`), `components/PeerYahoo.jsx` update (the Peer
step uses `<PeerSearchAdd company onAdd>`, `<PeerBatchAdd company existingNames
onAddMany>`, `<PeerRowFetch name company onFilled>`, `mergePeerRow(row, m,
company)`), `lib/currency.js` (`convertCompanyRecord(record, toCurrency, rate)`,
`rescaleUnit(record, toUnit)`), `lib/history.js`, `test/yahoo-fx.test.mjs`.

### Stream 3 — output pages — about 60 %
Done: `outputs/DcfOutput.jsx`, `CompsOutput.jsx`, `PrecedentOutput.jsx`,
`LboOutput.jsx` (check it is complete), `outputs/parts/*`.
Missing: `IpoOutput.jsx`, `ThreeStatementOutput.jsx`, `RatioOutput.jsx`.

## Open questions to put to the user (left in code as `// OPEN QUESTION:`)
1. `lib/yahoo.js:527` — a negative reported effective tax rate (tax credit on
   positive PBT): pass through as reported (current, with a warning) or NA?
2. `lib/yahoo.js:566` — with a TTM LTM, "prior FY" for growth: the TTM a year
   earlier, or the latest completed fiscal year? (Both left blank now.)
3. `lib/yahoo.js:597` — cash filled as cash + short-term investments (matching
   the operating-NWC build). Confirm, or cash & equivalents only?
4. `lib/yahoo.js:712` — Yahoo peers with TTM: stub columns hold 12-month
   figures vs rebuilding true YTD stubs (needs prior-year quarters, usually
   unavailable).
5. `lib/yahoo.js:719` — peer SG&A as one balancing line (gross profit − EBIT) so
   EBIT/EBITDA equal Yahoo's; the alternative is NA for EBIT, EBITDA, PBT and NI
   on every Yahoo peer.
6. `engine/dcf.js:183` — should opening cash be added to FCFE equity value
   (FCFE excludes interest income on it)?
7. `outputs/DcfOutput.jsx:130` — WACC-surface rows outside 0 ≤ D/(D+E) < 100 %
   shown as n/m (old grid clamped to 0–90 %). Confirm.
8. `outputs/DcfOutput.jsx:509` — the old DCF tornado used fixed ±1 pp bumps:
   drop it, or add editable bump sizes?
9. `outputs/CompsOutput.jsx:76` / `PrecedentOutput.jsx:116` — no single headline
   row is specified, so all implied-price rows are shown side by side. OK, or
   should a step let the user choose the headline row?
Also mention to the user: ADR / depositary receipts get a warning only (Yahoo's
crumbless endpoints have no ADR ratio).

## Superseded code to delete once the new app builds
`src/tabs/**`, `src/panels.jsx`, `src/panels/**`, `src/components/shell/**`,
`src/components/DataEntry.jsx`, `FetchCompany.jsx`, `CompanySearchBar.jsx`,
`CompanyLibrary.jsx`, `NumberInput.jsx`, `Section.jsx`, `PerYearGrid.jsx`,
`src/lib/companyStore.js`, `src/lib/assume.js`, `src/lib/valuations.js`,
`src/lib/reveal.js` (check no new code imports it), `src/lib/engine/scenario.js`
and old CSS for the rail / dock / ticker / scenario bar in `styles.css` — verify
with a grep for imports before each deletion. The user said NOT to remove the
non-code folders (backup/, copyright-deposit/, design-system/, the .app, the
image and xlsx).
