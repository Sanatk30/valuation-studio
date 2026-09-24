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
| **Comparable companies** (LTM) | Company → Target LTM financials → Peer set (≥ 3 usable peers) → Regression *(optional)* |
| **Precedent transactions** | Company → Target LTM financials → Transaction set (≥ 3 usable deals) |
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

## Excel export

Each method's *Download Excel* builds a live-formula workbook (blue = input,
black = formula, green = cross-sheet link) containing a cover, that method's
inputs and its calculation sheets only. Combined exports its figures, weights and
the weighted value. The exported formulas are recalculated in the test suite and
must match the app's engines.

## Verification

`npm test` runs every `test/*.test.mjs`: hand-checked engine identities (NOL
schedules, balance-sheet ties, sources = uses, IRR, regression), HyperFormula
recalculation of each method's workbook against the engines, the Yahoo mapping
and currency conversion on recorded fixtures, and the shell's data model
(nothing pre-filled, blanks never read as 0).
