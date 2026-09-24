/**
 * Comprehensive ratio analysis over the sub-annual projection. Flow-based
 * metrics that compare to a balance (returns, turnover, yields, EPS, EV/EBITDA,
 * P/E) are ANNUALISED (× m) and use average balances, so they read the same
 * whether you view yearly, half-yearly or quarterly.
 */
const g = (n, d) => (isFinite(n) && isFinite(d) && d !== 0 ? n / d : NaN);

export function computeRatios(pm) {
  const m = pm.m, N = pm.N;
  const idx = Array.from({ length: N }, (_, i) => i);
  const map = (fn) => idx.map(fn);
  const avg = (open, close) => idx.map((i) => (open[i] + close[i]) / 2);

  const avgEquity = avg(pm.openEquity, pm.closeEquity);
  const avgAssets = avg(pm.openAssets, pm.closeAssets);
  const avgPpe = avg(pm.openPpe, pm.closePpe);
  const avgNwc = avg(pm.openNwc, pm.nwcClose);
  const avgInvCap = idx.map((i) => ((pm.openDebt[i] - pm.openCash[i] + pm.openEquity[i]) + (pm.closeDebt[i] - pm.closeCash[i] + pm.closeEquity[i])) / 2);
  const avgCapEmp = idx.map((i) => ((pm.openDebt[i] + pm.openEquity[i]) + (pm.closeDebt[i] + pm.closeEquity[i])) / 2);

  const revA = map((i) => pm.rev[i] * m);          // annualised flows
  const ebitdaA = map((i) => pm.ebitda[i] * m);
  const niA = map((i) => pm.ni[i] * m);
  const nopatA = map((i) => pm.nopat[i] * m);
  const divA = map((i) => pm.div[i] * m);
  const fcffA = map((i) => pm.fcff[i] * m);
  const fcfeA = map((i) => pm.fcfe[i] * m);

  const shares = pm.company.sharesOut;
  const price = pm.company.currentPrice;
  const mktcap = price > 0 && shares > 0 ? price * shares : NaN;

  const epsA = map((i) => g(niA[i], shares));
  const bvps = map((i) => g(pm.closeEquity[i], shares));
  const dpsA = map((i) => g(divA[i], shares));
  const roe = map((i) => g(niA[i], avgEquity[i]) * 100);
  const retention = map((i) => 100 - g(pm.div[i], pm.ni[i]) * 100);
  const ev = map((i) => mktcap + pm.netDebtClose[i]);
  const pe = map((i) => g(price, epsA[i]));

  const yoy = (arr) => idx.map((i) => (i >= m ? g(arr[i], arr[i - m]) * 100 - 100 : NaN));

  const sec = (title, rows) => ({ title, rows });
  const row = (label, fmt, vals, note) => ({ label, fmt, vals, note });

  const sections = [
    sec('Profitability & margins', [
      row('EBITDA margin', 'pct', map((i) => g(pm.ebitda[i], pm.rev[i]) * 100)),
      row('EBIT (operating) margin', 'pct', map((i) => g(pm.ebit[i], pm.rev[i]) * 100)),
      row('Pre-tax margin', 'pct', map((i) => g(pm.ebt[i], pm.rev[i]) * 100)),
      row('Net profit margin', 'pct', map((i) => g(pm.ni[i], pm.rev[i]) * 100)),
      row('FCFF margin', 'pct', map((i) => g(pm.fcff[i], pm.rev[i]) * 100)),
      row('Effective tax rate', 'pct', map((i) => g(pm.tax[i], pm.ebt[i]) * 100)),
    ]),
    sec('Returns (annualised) & DuPont', [
      row('Return on equity (ROE)', 'pct', roe),
      row('Return on assets (ROA)', 'pct', map((i) => g(niA[i], avgAssets[i]) * 100)),
      row('Return on invested capital (ROIC)', 'pct', map((i) => g(nopatA[i], avgInvCap[i]) * 100)),
      row('Return on capital employed (ROCE)', 'pct', map((i) => g(pm.ebit[i] * m, avgCapEmp[i]) * 100)),
      row('DuPont · net margin', 'pct', map((i) => g(pm.ni[i], pm.rev[i]) * 100)),
      row('DuPont · asset turnover', 'x', map((i) => g(revA[i], avgAssets[i]))),
      row('DuPont · equity multiplier', 'x', map((i) => g(avgAssets[i], avgEquity[i]))),
    ]),
    sec('Leverage & solvency', [
      row('Debt / Equity', 'x', map((i) => g(pm.closeDebt[i], pm.closeEquity[i]))),
      row('Net debt / Equity', 'x', map((i) => g(pm.netDebtClose[i], pm.closeEquity[i]))),
      row('Net debt / EBITDA (ann.)', 'x', map((i) => g(pm.netDebtClose[i], ebitdaA[i]))),
      row('Debt / EBITDA (ann.)', 'x', map((i) => g(pm.closeDebt[i], ebitdaA[i]))),
      row('Net debt / Capital', 'pct', map((i) => g(pm.netDebtClose[i], pm.netDebtClose[i] + pm.closeEquity[i]) * 100)),
      row('Equity ratio (equity / assets)', 'pct', map((i) => g(pm.closeEquity[i], pm.closeAssets[i]) * 100)),
      row('Financial leverage (assets / equity)', 'x', map((i) => g(pm.closeAssets[i], pm.closeEquity[i]))),
    ]),
    sec('Coverage', [
      row('Interest coverage (EBIT / int.)', 'x', map((i) => g(pm.ebit[i], pm.interestExp[i]))),
      row('EBITDA / interest', 'x', map((i) => g(pm.ebitda[i], pm.interestExp[i]))),
      row('(EBITDA − capex) / interest', 'x', map((i) => g(pm.ebitda[i] - pm.capex[i], pm.interestExp[i]))),
      row('Debt-service cover (DSCR)', 'x', map((i) => g(pm.ebitda[i], pm.interestExp[i] + pm.repay[i]))),
    ]),
    sec('Efficiency & liquidity', [
      row('Asset turnover (ann.)', 'x', map((i) => g(revA[i], avgAssets[i]))),
      row('Fixed-asset turnover (ann.)', 'x', map((i) => g(revA[i], avgPpe[i]))),
      row('NWC turnover (ann.)', 'x', map((i) => g(revA[i], avgNwc[i]))),
      row('NWC / revenue', 'pct', map((i) => g(pm.nwcClose[i], revA[i]) * 100)),
      row('Cash / debt', 'x', map((i) => g(pm.closeCash[i], pm.closeDebt[i]))),
      row('Reinvestment rate', 'pct', map((i) => g(pm.capex[i] - pm.da[i] + pm.dNWC[i], pm.nopat[i]) * 100)),
    ]),
    sec('Per share', [
      row('EPS (ann.)', 'price', epsA),
      row('DPS (ann.)', 'price', dpsA),
      row('Book value / share', 'price', bvps),
      row('FCFF / share (ann.)', 'price', map((i) => g(fcffA[i], shares))),
      row('Dividend payout', 'pct', map((i) => g(pm.div[i], pm.ni[i]) * 100)),
      row('Retention ratio', 'pct', retention),
    ]),
    sec('Cash flow', [
      row('FCFF', 'num', map((i) => pm.fcff[i])),
      row('FCFE', 'num', map((i) => pm.fcfe[i])),
      row('Operating cash flow (CFO)', 'num', map((i) => pm.cfo[i])),
      row('FCF conversion (FCFF / EBITDA)', 'pct', map((i) => g(pm.fcff[i], pm.ebitda[i]) * 100)),
      row('Cash-flow margin (CFO / rev.)', 'pct', map((i) => g(pm.cfo[i], pm.rev[i]) * 100)),
    ]),
    sec('Growth', [
      row('Revenue growth (period/period)', 'pct', idx.map((i) => (i ? g(pm.rev[i], pm.rev[i - 1]) * 100 - 100 : NaN))),
      row('Revenue growth (YoY)', 'pct', yoy(pm.rev)),
      row('EBITDA growth (YoY)', 'pct', yoy(pm.ebitda)),
      row('Net income growth (YoY)', 'pct', yoy(pm.ni)),
      row('Sustainable growth (ROE × retention)', 'pct', map((i) => (roe[i] * retention[i]) / 100)),
    ]),
  ];

  if (price > 0 && shares > 0) {
    sections.push(sec('Valuation (at current price)', [
      row('Market capitalisation', 'num', map(() => mktcap)),
      row('Enterprise value (EV)', 'num', ev),
      row('P / E', 'x', pe),
      row('P / B', 'x', map((i) => g(price, bvps[i]))),
      row('EV / EBITDA (ann.)', 'x', map((i) => g(ev[i], ebitdaA[i]))),
      row('EV / Sales (ann.)', 'x', map((i) => g(ev[i], revA[i]))),
      row('Dividend yield', 'pct', map((i) => g(dpsA[i], price) * 100)),
      row('FCFE yield', 'pct', map((i) => g(fcfeA[i], mktcap) * 100)),
      row('Earnings yield', 'pct', map((i) => g(1, pe[i]) * 100)),
    ]));
  }

  return { sections, labels: pm.labels, m, N, balanceOk: pm.check.every((c) => Math.abs(c) < 1e-6) };
}
