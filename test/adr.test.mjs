/* ADR share count: Yahoo's ordinary-share count restated per ADR by the ratio
   of ordinary ÷ diluted (ADR-equivalent) shares — the user's choice (b). */
import { adrRatio } from '../src/lib/yahoo.js';
let checks = 0, failures = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.error('FAIL', m); } };
const pt = (date, value) => [{ date, value }];
const raw = (pxCcy, finCcy, ord, dil) => ({
  symbol: 'X', financialCurrency: finCcy, price: { value: 10, currency: pxCcy },
  annual: { OrdinarySharesNumber: pt('2025-12-31', ord), DilutedAverageShares: pt('2025-12-31', dil) }, quarterly: {}, trailing: {},
});
ok(adrRatio(raw('USD', 'TWD', 25.93e9, 5.186e9)).ratio === 5, 'TSM-like: ratio 5');
ok(adrRatio(raw('USD', 'CNY', 19.19e9, 2.41e9)).ratio === 8, 'BABA-like: ratio 8');
ok(adrRatio(raw('USD', 'INR', 15.39e9, 5.106e9)).ratio === 3, 'HDB-like: ratio 3');
ok(adrRatio(raw('USD', 'USD', 25.93e9, 5.186e9)).ratio === 1, 'same price and reporting currency: never restated');
ok(adrRatio(raw('INR', 'USD', 4.05e9, 4.07e9)).ratio === 1, 'INFY.NS-like: ratio 1');
ok(adrRatio(raw('USD', 'TWD', 13e9, 5e9)).ratio === 1, 'a ratio far from a whole number (2.6) is not taken');
ok(adrRatio(raw('USD', 'TWD', 25.93e9, null)).ratio === 1, 'no diluted count: ratio 1');
console.log(`adr: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);
