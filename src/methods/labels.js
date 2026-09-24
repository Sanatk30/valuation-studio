/** Method names and groups — kept apart from the registry so steps can import them. */
export const METHOD_META = {
  dcf: { label: 'Discounted Cash Flow', short: 'DCF', group: 'valuation', blurb: 'Value the business on its forecast free cash flows — FCFF at WACC, optional FCFE at cost of equity.' },
  comps: { label: 'Comparable Companies', short: 'Comps', group: 'valuation', blurb: 'Price the company off listed peers’ LTM trading multiples, with an optional regression.' },
  precedent: { label: 'Precedent Transactions', short: 'Precedent', group: 'valuation', blurb: 'Price the company off multiples and premiums paid in past acquisitions.' },
  lbo: { label: 'Leveraged Buyout', short: 'LBO', group: 'valuation', blurb: 'What a financial sponsor could pay and earn — IRR, MOIC and the LBO floor price.' },
  ipo: { label: 'IPO Valuation', short: 'IPO', group: 'valuation', blurb: 'Offer price, deal structure, proceeds, dilution and ownership for a listing.' },
  combined: { label: 'Combined Valuation', short: 'Combined', group: 'valuation', blurb: 'Weight the results of the methods you have completed into one value.' },
  ts: { label: '3-Statement Analysis', short: '3-Statement', group: 'analysis', blurb: 'Linked income statement, cash flow and balance sheet with a debt schedule.' },
  ratios: { label: 'Ratio Analysis', short: 'Ratios', group: 'analysis', blurb: 'Profitability, returns, liquidity, leverage and valuation ratios — past or forecast.' },
};

export const VALUATION_ORDER = ['dcf', 'comps', 'precedent', 'lbo', 'ipo', 'combined'];
export const ANALYSIS_ORDER = ['ts', 'ratios'];
