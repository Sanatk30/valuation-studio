# Build contract — Quant Value stepwise rebuild

Read `docs/STEPWISE_SPEC.md` first: it is the user's agreed spec. This file is
the technical contract between the parallel work streams. **Nothing may be
assumed.** If you hit a hidden input or a modelling choice the spec does not
settle, do NOT pick a value: make the output NA / hidden, leave a
`// OPEN QUESTION:` comment, and list it in your final report so the user can
be asked.

## House rules
- No invented defaults, no back-cast history, no static FX, no fabricated
  estimates, no "assumed" fallbacks (e.g. 25 % tax). Missing → NA.
- Engines stay pure functions of the assumption object `a` (see
  `src/store/methodModel.js` → `toEngineInput`). A missing input arrives as
  `NaN`, never as 0.
- Match the surrounding code style (comment density, naming, idiom).
- The `npm test` script runs every `test/*.test.mjs` file; keep all green.
- Only edit files your stream owns (below). If you need a change in someone
  else's file, say so in your final report instead of editing it.

## Shared modules (already written — import, don't fork)
- `src/store/methodModel.js` — per-method data shapes (`blankMethodData`),
  `toEngineInput(company, data)`, `SENS_DEFAULTS`, `blankCompsTarget`.
- `src/lib/historyModel.js` — canonical History shape, `HISTORY_LINES`,
  `historyLine`, `historyReference`, `fyLabel`, `hasHistory`.

`company` (the record the user creates first) =
`{ id, name, currency: 'INR'|'USD'|'EUR'|'GBP', unit: 'Cr'|'Lakh'|'Mn'|'Bn'|'K', startYear, fyEndMonth: 12|3|6|9 }`.
Money in every method is in `company.currency` × `company.unit`. Share counts
are in the same unit scale as money (as today). Per-share prices are plain
currency.

Method ids: `dcf, comps, precedent, lbo, ipo, ts, ratios, combined`.

---------------------------------------------------------------------------
## Stream 1 — Engines + Excel export (+ their tests)
Owns: `src/lib/engine/**`, `src/lib/excel/**`, `src/lib/compsPaste.js`,
`src/lib/defaults.js`, `src/lib/driverEdit.js`, `src/lib/period.js`,
`test/engine.test.mjs`, `test/comps.test.mjs`, `test/paste.test.mjs`,
`test/excel*.test.mjs` (may add new `test/*.test.mjs`).

### Inputs (new or changed; names are fixed)
- `a.drivers.ebitda0` — LTM EBITDA (explicit). `ops.ebitda0 = d.ebitda0`.
- `a.drivers.nwc0` — opening operating NWC balance (explicit). Year-0 NWC =
  `d.nwc0`; `nwcPct` / grid drive the forecast years only.
  (Legacy fallback to the old derivations ONLY when the field is absent/NaN, to
  keep old fixtures working; the UI always supplies them.)
- `a.company.nol0` — opening tax-loss carryforward (money, ≥ 0). Absent/NaN →
  treat as 0 (fixtures only; UI always supplies it).
- `a.ts.equity0` — reported opening equity. 3-statement: `otherNetAssets =
  equity0 − (cash0 + nwc0 + ppe0 − debt0)`, held constant every year as its own
  balance-sheet line so the sheet ties to reported equity. Absent → 0 other.
- `a.lbo.cashAtClose` — cash left on the balance sheet at close (money ≥ 0):
  uses += cashAtClose; LBO opening cash = cashAtClose; floor solve and value
  bridge (entry net debt = total new debt − cashAtClose) include it.
- `a.ipo.greenshoeExercisedPct` (0–100) and `a.ipo.greenshoeType`
  (`'primary'` new shares → company proceeds, post shares up; `'secondary'`
  existing holders' shares → selling-holder proceeds, share count unchanged).
  Greenshoe shares = base deal shares × greenshoePct × exercisedPct.
- `a.comps.target` — LTM-only target (see `blankCompsTarget`). Required:
  revenue, ebitda, ebit, netIncome. Optional: priorRevenue, priorEbitda,
  grossProfit, interest, equity, beta, high52, low52, text fields. Missing → NA.
  Shares / debt / cash / price come from `a.company`.
- `a.precedent.target = { revenue, ebitda }` — target LTM. Precedent no longer
  reads drivers.
- `a.wacc.betaPeers = [{ id, name, leveredBeta, de, taxRate }]` (D/E as a
  ratio, tax in %). Reference only — never drives the discount rate.
- `a.sens = { dcf: {waccStep, gStep, multStep, coeStep}, wacc: {wdStep, kdStep},
  lbo: {entryStep, exitStep, hurdleStep} }` — grid step sizes (5 points:
  −2..+2 steps). Defaults in `SENS_DEFAULTS` reproduce today's grids.
- `a.history` — canonical History (reported or typed). Never back-cast.

### Behaviour changes
1. **NOL carryforward** everywhere tax is computed on a projection (DCF FCFF
   *unlevered* schedule on EBIT, DCF FCFE levered schedule on EBT,
   3-statement, LBO, IPO via 3-statement). Loss years: tax 0, NOL += loss.
   Profit years: NOL used = min(NOL, profit); tax = (profit − used) × t.
   No negative tax anywhere (today FCFF NOPAT = EBIT × (1−t) gives a negative
   tax on negative EBIT — fix it).
   **Terminal value**: Gordon TV uses a *normalised, fully-taxed* year-N flow
   (FCFF: EBIT_N×(1−t) + D&A − capex − ΔNWC; FCFE analogous on NI).
   The NOL balance left at year N is valued separately:
   `pvNolFcff = nolCloseU[N] × t / (1+WACC)^N` added to EV (both FCFF TV
   methods); `pvNolFcfe = nolCloseL[N] × t / (1+CoE)^N` added to equity (both
   FCFE TV methods). Show both as their own lines.
2. **No back-cast**: remove the DCF back-cast history (`dcfHistory`) from what
   the UI and Excel use; replace with `dcfReportedHistory(a, maxYears = 3)` →
   `null` or `{ n, dates, labels, revenue, growth, ebitda, margin, da, ebit,
   capex }` from `a.history.annual`, only years whose FY-end year <
   base year (`startYear − 1`), missing → NaN. Comps target page: FY-1/FY-2
   come from `target.priorRevenue/priorEbitda` only (else NA); no de-growing.
   Ratios "Past": `computeHistoryRatios(a, freq)` (`'Y'`, or `'Q'` when
   `a.history.quarterly` exists) → same `{ labels, sections, ... }` shape as
   `computeRatios` over reported periods, NA where a line is missing.
   Projection-based past (`projectHistoryPeriods`) is no longer used.
3. **Forecast annual only** — `projectPeriods(a, 'Y')` is the only forecast
   frequency the UI calls. Leave sub-annual code only if tests need it.
4. **Comps = LTM only.** Remove every estimate/NFY column (`est`, NFY / NFY+1
   multiples, "Est. 1-yr" growth, long-term growth) from the engine column
   specs, pages and export. Implied-price rows: `evSales`, `evEbitda`,
   `evEbit`, `pe` — peer LTM multiple (median / q1 / q3) × target LTM metric →
   `impliedMedian / impliedLow / impliedHigh`. `computeComps(a).rows` keeps
   that shape.
   Company pages: **core** lines blank (null) = NA — sales, COGS/EBITDA, D&A,
   net income, shares, price, debt, cash, tax rate, beta, fyEnd. **Adjustment**
   lines blank = 0 ("none") — non-recurring items, NCI, preferred, options,
   converts, stubs. `blankCompany()` starts fully blank (no beta 1.0, no 25 %
   tax, no preset dates/names). Same for `blankDeal()`.
   Regression: peer `growth` = historical 1-yr sales growth (reported); target
   x-values from `a.comps.target` (growth = revenue/priorRevenue − 1, margin =
   ebitda/revenue, net debt/EBITDA from company, ROE = NI/equity). Size
   variables in the valuation currency: keys `revSize`, `mktCapSize`
   (replace `revUsd` / `mktCapUsd`; no FX table).
5. **Sensitivities** read `a.sens` (dcfSensitivity, WACC surface, lboSensitivity,
   hold-period grid, LBO floor range `floorAt(hurdle ± hurdleStep)`).
6. `betaPeerStats(a)` in `wacc.js` → `{ rows: [{...peer, unleveredBeta}], mean,
   median }` (Hamada with each peer's own tax rate).
7. Scenarios are gone from the product. Engines may keep `scenario.js` for old
   tests, but nothing new may depend on it.

### Output field names Stream 3 relies on (keep or add exactly these)
- `computeDcf(a)`: existing fields + `fcffTax[]`, `nolOpenU[] nolUsedU[]
  nolCloseU[]`, `nolOpenL[] nolUsedL[] nolCloseL[]`, `pvNolFcff`, `pvNolFcfe`,
  `fcffNormN` (normalised terminal FCFF), `fcfeNormN`.
- `computeThreeStatement(a)`: existing + `nolOpen[] nolUsed[] nolClose[]`,
  `otherNetAssets` (number).
- `computeLbo(a)`: existing + `cashAtClose`, `nolOpen[] nolUsed[] nolClose[]`.
- `computeIpo(a)`: existing + `greenshoeShares`, `greenshoeType`,
  `greenshoeProceeds`.
- `computeComps(a)`: `rows` (4 LTM rows above), `targetPage`, `pages`,
  `tiers`, `overall`, `cols` (LTM-only groups).
- `computePrecedent(a)`: unchanged shape; `target` from `a.precedent.target`.
- `computeRegression(a)` / `runRegression(a)`: unchanged shape.
- `dcfReportedHistory(a)`, `computeHistoryRatios(a, freq)`, `betaPeerStats(a)`.

### Excel export
`exportToExcel(a, methodId, opts)` / `buildWorkbook(a, methodId, opts)` with
`methodId ∈ {dcf, comps, precedent, lbo, ipo, ts, ratios, combined}` and
`opts = { skipped: { fcfe?, regression?, history? }, combined?: {...} }`.
- Each file = Cover + an **Inputs** sheet holding ONLY that method's inputs +
  its calculation sheets. 3-Statement sheet only for ts / ratios / ipo (and
  dcf's FCFE block reads only the financing inputs it collected).
- LBO / IPO / ts / ratios need the operating projection: host it on a
  projection sheet (the DCF sheet's projection block, without WACC / TV /
  FCFE when the method is not DCF).
- DCF: no back-cast; reported history columns (blue inputs) only when history
  exists; FCFE block + FCFE grid only when `!skipped.fcfe`; WACC sheet peer
  beta table from `a.wacc.betaPeers`; NOL schedule + NOL PV lines; editable
  grid steps from `a.sens`.
- Comps: LTM-only pages; Regression sheet only when `!skipped.regression`.
- Precedent: standalone (target LTM inputs on the Inputs sheet, no DCF sheet).
- Ratios: the 3-Statement file with its ratio block, titled Ratio Analysis.
- Combined: Cover + one sheet listing each included method's chosen figure,
  low / high (blue inputs, labelled with their source method), weights, the
  weighted value formula and upside vs the market price. `opts.combined =
  { rows: [{ method, figureLabel, value, low, high, weight }], marketPrice }`.
- Keep the HyperFormula recalc tests proving every method file recalculates to
  the engine (update fixtures to the new inputs).

---------------------------------------------------------------------------
## Stream 2 — Yahoo, live FX, currency conversion
Owns: `src/lib/yahoo.js`, `src/lib/fx.js` (new), `src/lib/currency.js`,
`src/lib/history.js`, `src/components/ListingSearch.jsx` (new),
`src/components/PeerYahoo.jsx`, `test/yahoo-fx.test.mjs` (new, fixtures only),
`test/fixtures/**`.

- `fx.js`: `SUPPORTED_CURRENCIES = ['INR','USD','EUR','GBP']`;
  `fetchLiveRate(from, to)` → `{ rate, at, source: 'live', pair }` via Yahoo
  `/yf/v8/finance/chart/{FROM}{TO}=X` (throws on failure). Rate = units of
  `to` per 1 `from`.
- `yahoo.js`:
  - fetch reported TTM (`trailing*` series) where available, else latest FY
    with an explicit `ltmLabel` ("TTM to Jun 2026" / "FY2025 used as LTM");
    balance sheet = latest reported quarter where available.
  - detect the *financial* currency (timeseries `currencyCode`) separately
    from the *price* currency (chart meta); convert each with its own rate.
  - fetch reported InterestExpense, TaxProvision, PretaxIncome; no
    back-solving, no 25 % fallback.
  - `mapListing(raw, company, rates)` → `{ company: {sharesOut, currentPrice,
    grossDebt, cash, taxRate}, drivers: {revenue0, ebitda0, nwc0}, compsTarget:
    {...blankCompsTarget fields}, precedentTarget: {revenue, ebitda, ltmLabel},
    history /* canonical, converted */, listing: { symbol, name, exchange,
    financialCurrency, priceCurrency, rates, ltmLabel, at }, preview: rows[],
    missing: string[] }`. **Reported facts only** — no growth / margin /
    D&A% / capex% / NWC% prefill (those come from `historyReference`).
    Opening NWC = operating NWC = (current assets − cash & short-term
    investments) − (current liabilities − current debt), each line shown in
    the preview; NA if any line is missing. Tax rate = reported tax provision ÷
    reported pre-tax income (NA if either missing or PBT ≤ 0).
- `ListingSearch.jsx`: `<ListingSearch company onApply={(mapped) => …} />` —
  search box → listings dropdown → preview modal: reported value (reported
  currency) → value into the model (valuation currency/unit), the FX rate(s)
  as an **editable** field tagged "live" (live fetch failed or unsupported
  currency → the user must type a rate before Apply is enabled). Nothing
  changes until Apply.
- `PeerYahoo.jsx`: peers convert into the valuation currency at a live,
  editable rate (batch add shows one rate per foreign currency). Fill reported
  lines only (see Stream 1 rule 4). No `est`. Props take `company` instead of
  `settings`.
- `currency.js`: `convertCompanyRecord(record, toCurrency, rate)` — converts
  every money input (and per-share price) in EVERY method's data, including
  comps target & peer pages, precedent target & deal pages (offer cash, acquirer
  price, unaffected prices), LBO minCash / cashAtClose, IPO primaryRaise,
  ts.startingPPE / equity0, company.nol0, drivers revenue0 / ebitda0 / nwc0 and
  absolute per-year grid rows, history lines, combined.marketPrice.
  `rescaleUnit(record, toUnit)` — money and share counts rescale, per-share
  prices do not.
- `history.js`: render `history.statements` (already converted) — no FX table.

---------------------------------------------------------------------------
## Stream 3 — Output pages
Owns: `src/outputs/**` (new).

One component per method: `DcfOutput, CompsOutput, PrecedentOutput, LboOutput,
IpoOutput, ThreeStatementOutput, RatioOutput` (default exports, in
`src/outputs/<Name>.jsx`). Props: `{ a, set, company, skipped }`:
- `a` — engine input from `toEngineInput` (all required inputs valid).
- `set(path, value)` — ONLY for display settings on the output (sensitivity
  steps `sens.*`, `ratio.freq`, `ratio.histYears`); inputs are edited in
  steps, never on the output.
- `skipped` — `{ fcfe?, regression?, history? }`.

Layout (user's choice): a headline block (the answer: price/share, EV,
equity, upside vs market price when given) + 1–2 key charts, then collapsible
detail sections **closed by default** (build-up tables, schedules,
cross-checks, sensitivity grids with editable step inputs above each grid,
extra charts from the old Charts gallery that belong to this method). Reuse
existing components (`StatementTable`, `Heatmap`, `Waterfall`, `LiveChart`,
`FootballField`, `BenchmarkTable`, chartkit) — do not modify them; copy into
`src/outputs/parts/` if a variant is needed. No scenarios, no Bear/Bull
ghosts, no click-to-dock (`requestAssumption`), no editable cells.
The shell renders the page title, the per-step Edit links and the Excel
button — not the output component.

---------------------------------------------------------------------------
## Stream 0 — Shell (lead)
Owns everything else: `src/App.jsx`, `src/store/**`, `src/methods/**`,
`src/wizard/**`, `src/home/**`, `src/styles.css`, `index.html`, `package.json`,
README, and deletion of the old tabs / dock / ticker once replaced.
