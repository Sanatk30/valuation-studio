# Quant Value

*Financial quantitative analysis & value insights.*

A step-by-step valuation workbench. Open it, pick a method, answer that method's
steps one at a time, and get its output — with a live-formula Excel file to take
away. Each method is independent: it has its own inputs, and nothing typed in one
method changes another. The **Combined** method weights the results of the
methods you have finished.

**No hidden assumptions.** Every number the model uses is either typed by you or
reported by the company (via the Yahoo Finance search). Nothing is back-cast,
nothing is defaulted, and a missing figure shows as **NA**, never as 0. The only
pre-filled values are display settings (sensitivity-grid step sizes), which you
can change on each output page.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/`. `npm test` runs every file in
`test/` (engine math, Excel formula recalculation, Yahoo mapping, the data model).
The company search needs `npm run dev`: the dev server proxies Yahoo, which sends
no CORS headers.

### Double-click launcher (macOS)

`Valuation Studio.app` starts the dev server and opens the app in your browser;
clicking it again while the server runs just reopens the tab. It needs Node 18+
from nodejs.org.

- **Finding the project.** The launcher looks, in order, in the folder the `.app`
  sits in, the folder you chose last time, and `~/Downloads/valuation-studio`. If
  none of them holds the project, it asks you to pick the folder once and
  remembers it.
- **Dependencies.** It runs `npm install` on the first launch and again whenever
  `package.json` or `package-lock.json` changes.
- **Port.** It uses 5173, or the next free port up to 5180 if another program
  holds 5173.
- **Logs.** The server log, install log and remembered folder are kept in
  `~/Library/Logs/ValuationStudio/`. If the server does not start, a dialog shows
  the last lines of the log.

A copy from a `git clone` opens directly. A copy from GitHub's "Download ZIP" is
marked as downloaded from the internet, so macOS blocks it the first time. Either
allow it under System Settings → Privacy & Security → "Open Anyway", or run this
once in the project folder:

```bash
xattr -dr com.apple.quarantine "Valuation Studio.app"
```

## How it works

1. **Company** — the first launch asks which company you are valuing, the
   **valuation currency** (INR, USD, EUR, GBP), the money unit (Cr, Lakh, Mn, Bn,
   '000), the first forecast year and the fiscal year. Every method of that
   company uses these. Companies are saved in the browser; switch, add,
   duplicate, rename or delete them from the company pill in the top bar.
   Changing the currency converts every money input in every method at a live
   exchange rate you confirm (or type).
2. **Pick a method** — each card shows *Not started*, *Step k of n* or
   *Complete*, with *Start over*.
3. **Steps** — a strict wizard: you can't continue until the step's required
   fields are valid, and you can go back to any completed step. Optional steps
   can be skipped. A side card shows the partial results already determined
   (e.g. WACC once the cost-of-capital step is done). *Fill all steps at once*
   opens every step on one page (with a JSON copy / paste of the method's inputs).
4. **Output** — the answer and one or two key charts on top; every schedule,
   build-up, cross-check and sensitivity grid in collapsible sections below.
   *Edit* chips jump back to any step and return you to the output. *Download
   Excel* exports that method only.

## Methods and their steps

| Method | Steps |
| --- | --- |
| **DCF** | Company → Historical financials *(optional)* → Forecast → Cost of capital (CAPM, Hamada or direct beta, optional beta-peer list) → Terminal value → FCFE financing *(optional — skip for FCFF only)* |
| **Comparable companies** | Settings → Target company (full company page) → Peers (as many as you choose, each with its company page, include flag and tier) → Regression *(optional)* |
| **Precedent transactions** | Settings → Company being valued (company page) → Deal list (as many as you choose) → Deal financials (one page per deal) |
| **LBO** | Company → Forecast → Entry & exit (incl. cash left at close) → Debt structure → Cash sweep & hurdle |
| **IPO** | Company → Forecast → Financing rates → Pricing basis → Offer structure (greenshoe size, % exercised, primary or secondary) |
| **Combined** | Pick completed methods, the figure each contributes and its weight (must total 100 %); optional market price |
| **3-Statement Analysis** | Company → Historical financials *(optional)* → Forecast → Financing & balance sheet (incl. reported opening equity) |
| **Ratio Analysis** | Company → Historical financials *(optional)* → Forecast → Financing & balance sheet → Ratio settings (past only if history exists) |

The **Company** step asks share count, market price (optional), gross debt,
cash and — for methods that forecast — tax rate and the opening tax-loss
carryforward (NOL). The **Forecast** step asks LTM revenue, **LTM EBITDA** and
**opening operating NWC** explicitly, then either a start→end fade or a
year-by-year grid (paste from Excel supported). Both steps offer *Copy from
another method* — a one-off copy; the methods stay independent afterwards.

Modelling conventions that are stated rather than assumed: tax is never negative
— losses build an NOL balance used against later profits, and the DCF terminal
value uses a fully-taxed final-year flow with the remaining NOL valued as its own
line; interest accrues on opening balances (no circular references); forecasts
are annual.

## Comparable companies and precedent transactions

Both follow the *Comparable Company Analysis* and *Precedent Transactions*
templates: every company (target, peers, the company being valued, each deal's
target) has a company page — income statement, balance sheet, cash flow and the
ratio block — with **1 to 10 historical fiscal years** plus optional prior and
current **YTD** columns and an **LTM** column (LTM = latest FY + current YTD −
prior YTD; the balance sheet uses the interim column when entered, else the
latest FY). Blanks follow the template: a blank cell counts as 0, NM marks a
zero or negative denominator, and NM values are left out of the statistics.

What you choose on the **Settings** step: price / valuation date, the lease
toggle, the number of years, YTD columns on or off, the period labels, which
multiples feed the implied valuation, which statistics give the low / mid /
high values (template: 25th percentile / median / 75th percentile), the
percentile method (inclusive, as the template, or exclusive) and which
statistics rows are shown. The number of peers and of deals is chosen on their
steps. On the output page you pick the **headline multiple** — the one row
Combined uses (mid statistic as the value, low–high as the range).

Pages fill from Yahoo Finance (Cost of Materials = cost of revenue, Employee
Benefits = salaries when reported, Other Expenses and Other Income balance to
Yahoo's EBITDA and pre-tax income, the "Other" balance-sheet and cash-flow lines
take the difference to Yahoo's totals, YTD columns are left to you; a listed
deal target's page uses the fiscal years ending before the announcement date),
or paste a block straight from Excel (*Paste from Excel*: rows matched by label,
columns lined up by the header row, totals skipped and recalculated). The peer
and deal lists can be pasted too. Peers can be grouped into tiers; the
statistics are shown per tier as well.

## Company search (Yahoo Finance)

Search a name or ticker in the Company step. The preview shows every reported
figure, how it converts into your valuation currency and unit, and the **exchange
rate** used — fetched live and editable (if the live rate can't be fetched, or the
listing reports in another currency, you type it). Nothing changes until Apply.
Only reported facts are filled: LTM uses trailing-twelve-months where Yahoo has
it (else the latest fiscal year, labelled), the balance sheet is the latest
reported quarter, opening NWC is operating working capital built from reported
lines, and the tax rate is reported tax ÷ reported pre-tax income. Historical
growth, margins and cost ratios are shown beside the forecast fields as
reference — never copied into them. Peers are converted the same way; lines the
feed doesn't carry stay blank (NA) until you type them.

### Peer finder (comps Peer step)

**Find peers** ranks candidates against the target and shows its reasons; you
tick which ones to fetch.

**Where candidates come from.** The seed is the target's ticker. If the target is
private, type a close listed competitor instead. The finder takes Yahoo's
co-watched names for the seed, plus the co-watched names of its top five. Funds,
indices and anything Yahoo can't profile are dropped.

**What it scores**, with points out of 100:

| Signal | Points |
|---|---|
| Industry | 30 for the same industry, 15 for the same sector only |
| Market | 15 for the same exchange, 10 for the same reporting currency |
| Size | 25 at 1×, falling to 0 at 10× apart (log scale). Uses market cap, or LTM revenue if either side has no market cap, including depositary receipts. |
| EBITDA margin | 15 at the same margin, 0 at 20 points apart |
| Revenue growth | 15 at the same growth, 0 at 25 points apart |

**Missing data.** A signal either side doesn't report is NA and isn't scored. The
score is the points earned ÷ the points available, and the coverage (x of 5)
shows beside it.

**What it compares against.** Size, margin and growth use the target's own typed
figures where they exist, else the seed's reported figures. The panel says which.

**FX.** Foreign sizes convert at live FX for the ranking only. Ticked peers go
through the normal fetch and rate confirmation, so nothing reaches the model
unconfirmed.

**Cost.** One run makes roughly 60–100 small Yahoo requests (four at a time).

## Excel export

Each method's *Download Excel* builds one live-formula workbook (blue = input,
black = formula, green = cross-sheet link) for that method only:

| Method | Sheets |
| --- | --- |
| DCF | Cover · Inputs · DCF (reported history, LTM, projection, NOL schedule, FCFF valuation, FCFE when not skipped, sensitivity grids) · WACC (CAPM + Hamada build, beta-peer reference, WACC surface) |
| Comps | Instructions · Inputs · Comps Summary (Table 1 multiples, Table 2 benchmarking, statistics overall and per tier) · Implied Valuation · Regression *(when not skipped)* · Target · one page per peer — the template's layout |
| Precedent | Instructions · Inputs · Transaction Summary · Implied Valuation · Company Being Valued · one page per deal — the template's layout |
| LBO | Cover · Inputs · Projection · LBO |
| IPO | Cover · Inputs · Projection · 3 Statement · IPO |
| 3-Statement | Cover · Inputs · Projection · 3 Statement (with the forecast ratio block) |
| Ratios | as 3-Statement, plus Past Ratios when reported history was entered |
| Combined | Cover · Combined (each figure, its range, the weights, the weighted value and the upside) |

The **Inputs** sheet holds only that method's inputs, including the
sensitivity-grid step sizes; a blank input is the text `NA` and every figure
built from it reads NA. The comps and precedent workbooks keep their
templates' rules instead (a blank cell is 0; NM where a denominator is zero or
negative). The test suite recalculates every method's workbook with
HyperFormula and requires it to match the app's engines cell for cell, on the
sample model and on more than 70 edge cases (tax losses, blanks, optional
steps, horizons, 1 / 5 / 10 fiscal years, YTD off, every statistics choice,
no or excluded peers, blank deals). The DCF tornado is an on-screen analysis only.

## Project layout

```
src/
  App.jsx, main.jsx      shell entry
  home/  wizard/         method cards, the step wizard and output frame
  methods/               method registry, steps, validation, Combined
  outputs/               one output page per method (+ shared parts)
  components/            input pages, Yahoo search, FX, charts
  store/                 per-company, per-method data model (localStorage)
  lib/engine/            the valuation engines (pure functions)
  lib/excel/             the per-method workbook writers
  lib/                   Yahoo, FX, peer finder, currency conversion, history, formatting
test/                    engine, Excel, Yahoo/FX, peer-finder and data-model tests (+ fixtures)
docs/                    spec, contract and hand-off notes for the rebuild
```

`backup/`, `copyright-deposit/`, `design-system/`, the `.app` bundle, the image
and the sample `.xlsx` are kept as reference material and are not part of the
build.

## Verification

`npm test` runs every `test/*.test.mjs`: hand-checked engine identities (NOL
schedules, balance-sheet ties, sources = uses, IRR, regression), HyperFormula
recalculation of each method's workbook against the engines, the Yahoo mapping
and currency conversion on recorded fixtures, the Excel paste parser, the
template statistics (inclusive / exclusive quartiles against Excel's values), the peer finder's scoring and
pipeline on the same fixtures, and the shell's data model
(nothing pre-filled, blanks never read as 0).
