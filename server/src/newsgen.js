// Synthetic newswire. Phrasing deliberately differs from the training generator in
// places, so the live feed exercises the classifier on wording it has not memorised.
const SOURCES = ['PulseWire', 'MarketDesk', 'Capital Brief', 'StreetLedger', 'FinNote', 'Ticker Daily'];
const PCT = () => `${[2, 3, 4, 5, 6, 8, 9, 11, 14, 17, 21][Math.floor(Math.random() * 11)]}%`;
const AMT = () => ['$80 million', '$240 million', '$600 million', '$1.5 billion', '$3 billion'][Math.floor(Math.random() * 5)];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const POSITIVE = [
  (c) => `${c} beats earnings estimates as revenue climbs ${PCT()}`,
  (c) => `${c} raises full-year guidance on strong demand`,
  (c) => `${c} shares surge after record quarterly revenue`,
  (c) => `${c} announces ${AMT()} share buyback`,
  (c) => `Analysts upgrade ${c} to buy, citing margin expansion`,
  (c) => `${c} wins ${AMT()} government contract`,
  (c) => `${c} stock rallies ${PCT()} on upbeat outlook`,
  (c) => `${c} lifts dividend as free cash flow soars`,
  (c) => `${c} reports better-than-expected sales growth`,
  (c) => `${c} gains market share, price target raised`,
];
const NEUTRAL = [
  (c) => `${c} to report quarterly results next week`,
  (c) => `${c} declares regular quarterly dividend`,
  (c) => `${c} names new independent board member`,
  (c) => `${c} shares little changed ahead of fed decision`,
  (c) => `${c} reaffirms full-year outlook`,
  (c) => `${c} to present at industry conference`,
  (c) => `${c} schedules investor day for next month`,
  (c) => `${c} reports results in line with expectations`,
];
const NEGATIVE = [
  (c) => `${c} misses earnings estimates, cuts guidance`,
  (c) => `${c} shares slump ${PCT()} after profit warning`,
  (c) => `${c} faces class action lawsuit from shareholders`,
  (c) => `${c} ordered by jury to pay ${AMT()} in damages`,
  (c) => `${c} under SEC investigation over accounting`,
  (c) => `Regulators fine ${c} ${AMT()} for compliance violations`,
  (c) => `${c} credit rating cut to junk, default fears rise`,
  (c) => `${c} warns of liquidity crunch as cash burn accelerates`,
  (c) => `${c} halts production on supply chain disruption`,
  (c) => `Chip shortage forces ${c} to cut output`,
  (c) => `${c} CEO resigns abruptly amid board turmoil`,
  (c) => `${c} discloses data breach exposing millions of customers`,
  (c) => `Ransomware attack shuts down ${c} systems`,
  (c) => `${c} warns new tariffs will hit profits`,
  (c) => `${c} stock tumbles as recession fears deepen`,
  (c) => `${c} shares drop ${PCT()} amid antitrust probe`,
];
const MIXED = [
  (c) => `${c} shares climb despite class action lawsuit`,
  (c) => `${c} stock rises despite supply chain disruption`,
];

export function generateHeadline(stock) {
  // Tilt the tone mix toward the stock's prevailing sentiment so stories cluster.
  const tilt = stock.sentiment * 0.15;
  const r = Math.random();
  let pool;
  if (r < 0.04) pool = MIXED;
  else if (r < 0.38 + tilt) pool = POSITIVE;
  else if (r < 0.70) pool = NEUTRAL;
  else pool = NEGATIVE;
  return { headline: pick(pool)(stock.name), source: pick(SOURCES) };
}
