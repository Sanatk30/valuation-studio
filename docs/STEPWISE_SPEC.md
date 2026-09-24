# Quant Value — step-by-step redesign (agreed spec, 2026-09-24)

Every item below was decided by the user in Q&A. Nothing here is a default the
app invents; where the model needs a number, a step asks for it.

## Shell
- App renamed **Quant Value** (logo/theme only, green-on-navy; no splash).
- First screen: **method picker** with a **company bar** on top
  (name · currency · unit · FY start, with Switch / New / Duplicate / Delete).
- First launch (no company yet): a card asks company name, **valuation
  currency** (INR / USD / EUR / GBP), money unit, start year, fiscal basis.
- Removed: ticker strip, right-hand assumptions dock, Bear/Base/Bull scenarios,
  top-bar Enter Data / Export menu, keyboard view shortcuts.
- Kept: listed-company search (Yahoo), saved companies library, Excel export,
  paste from Excel, bulk entry (as a per-method "Fill all steps at once" form).
- Old browser save is discarded (fresh storage key).

## Method cards
Valuation: DCF · Comparable companies · Precedent transactions · LBO · IPO ·
Combined. Analysis: 3-Statement Analysis · Ratio Analysis.
Each card shows status: Not started / Step k of n / Complete, plus Start over.

## Independence
- Each method has its **own copy of every input** (company, forecast, …).
- Company step and Forecast step offer **"Copy from <another method>"**.
- Every method starts **blank**; required fields must be valid to continue.
- Currency/unit/start year/fiscal basis are per company (shared by methods).

## Navigation
- Strict wizard: Next / Back; can't pass a step until its required fields are
  valid; click back to any completed step.
- Output page has **Edit** beside each step → opens it → returns to output.
- Small **running preview** card while filling (e.g. WACC once known).
- Progress resumes where left (browser storage), per company.

## Steps
Common: **Company** (shares, market price *optional*, gross debt, cash, tax;
Yahoo search; copy-from) and **Forecast** (years, LTM revenue, **LTM EBITDA —
explicit**, **opening NWC — explicit**, growth path, margin path, D&A %,
capex %, NWC %; per-year grid with paste).

- **DCF**: Company → Historical financials (optional) → Forecast → Cost of
  capital (CAPM, beta Hamada/direct, optional **beta-peers list owned by DCF**,
  Kd, D/V) → Terminal value → FCFE financing (optional; skipped = FCFF only)
  → Output.
- **Comps** (**LTM only** — no forward/NFY estimates anywhere): Company →
  **Target LTM financials** (required: LTM revenue, EBITDA, EBIT, net income;
  optional: prior-FY revenue/EBITDA, gross profit, interest, beta, ratings,
  description) → Peer set (min 3; search/paste/type; tiers) → Regression
  (optional, today's full options) → Output. Implied price rows: EV/LTM Sales,
  EV/LTM EBITDA, EV/LTM EBIT, P/LTM E.
- **Precedent**: Company → Target LTM financials → Deal set (min 3) → Output.
  Premia analysis only when market price given.
- **LBO**: Company → Forecast → Entry & exit → Debt structure → Cash sweep &
  hurdle → Output.
- **IPO**: Company → Forecast → Financing rates → Pricing basis → Offer
  structure (**greenshoe % exercised** + **primary/secondary**) → Output.
- **3-Statement Analysis**: Company → Historical financials (optional) →
  Forecast → Financing & PP&E → Output.
- **Ratio Analysis**: Company → Historical financials (optional) → Forecast →
  Financing & PP&E → Ratio settings (Past only if history exists) → Output.
- **Combined**: lists completed valuation methods; per method tick include,
  **pick the figure** (e.g. DCF → FCFF Gordon), weight % (sum = 100);
  market price field (optional, prefilled from included methods). Output:
  weighted value + football field of each method's low–high.

## History
- No back-cast anywhere. History = Yahoo reported history, or an optional typed
  grid (core lines, ≤10 years, Excel paste). None → no history columns;
  Ratio Analysis runs Future-only.
- History grid lines — IS: revenue, COGS, EBITDA, D&A, interest, PBT, tax, NI.
  BS: cash, receivables, inventory, net PP&E, total assets, payables, current
  liabilities, total debt, equity. CF: CFO, capex, dividends. Missing → NA.

## Currency
- Yahoo pulls convert into the company's valuation currency at a **live spot
  rate** (Yahoo FX), shown and **editable** in the preview; live fetch failing
  → user must type the rate. One spot rate for P&L, balance sheet and price.
- A listing in a currency outside the four → user types the rate.
- Search prefill = **reported facts only**; historical CAGR / margins / D&A% /
  capex% shown as reference beside the forecast fields, never auto-filled.
- Company currency is changeable: every money input in every method converts
  at a live rate the user confirms.

## Output
- Headline (price/share, EV, equity, upside) + 1–2 key charts, then
  collapsible detail sections (closed by default).
- Sensitivity grids: step sizes editable above each grid.
- Excel per method: Cover + that method's inputs + its calculation sheets only;
  3-Statement sheets only where the method collected those inputs.

## Later decisions (round 2, same day)
- Peers from Yahoo: reported InterestExpense and tax provision fetched; anything
  not reported = blank/NA (no 25 % tax fallback, no back-solved interest, no
  extrapolated estimates). Blank peer pages start fully blank.
- Blank **adjustment** lines (non-recurring, NCI, preferred, options, converts,
  stubs) = none (0), stated on the page. Blank **core** lines = NA, never 0.
- Yahoo LTM = trailing-twelve-months where available, else latest FY (labelled
  "FY2025 used as LTM"); balance sheet = latest reported quarter.
- 3-Statement / Ratios: ask reported **opening equity**; the gap to
  cash + NWC + PP&E − debt is an "Other net assets / (liabilities)" line held
  constant, so the balance sheet ties to reported equity.
- LBO: **cash left on balance sheet at close** is an input (0 allowed).
- **NOL carryforward** in DCF (FCFF and FCFE), LBO, 3-Statement, IPO: losses
  build a tax-loss balance used against later profits; opening NOL is asked
  (0 allowed). No negative tax anywhere.
- Forecast views are **annual only**; half-yearly/quarterly only for past
  (reported) data.
- Regression size variables use the valuation currency (no static USD FX).
