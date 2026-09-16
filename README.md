# Kalshi Edge Lab

A deployable research workstation for comparing user/model probability estimates with live Kalshi executable prices.

## What is implemented
- Paste N Kalshi market tickers
- Live public market retrieval through a server-side proxy
- YES bid/ask, NO ask, spread, volume, liquidity, OI, close time and settlement rule
- User/model P(YES) input
- YES and NO executable discrepancy calculation
- Configurable per-market cost/slippage buffer
- Ranking by estimated edge
- Data-quality score based only on market-data quality (not outcome confidence)
- Beginner-friendly dashboard plus technical inspection panel
- Mobile/iPad responsive UI
- Render blueprint

## Important modeling rule
The app deliberately does **not** ask an LLM to hallucinate a probability. A credible probability engine must be category-specific and grounded in evidence. This v1 provides the market-data and valuation layer and accepts a probability from your chosen model/research process.

## Run
```bash
npm install
npm start
```
Open http://localhost:3000

## Render
Push this folder to GitHub, then create a Render Blueprint from `render.yaml`.

## Edge definition
For YES:
`edge = model_probability_yes - executable_yes_ask - cost_buffer`

For NO:
`edge = (1 - model_probability_yes) - executable_no_ask - cost_buffer`

The cost buffer is user supplied in cents and is intended to conservatively account for fees/slippage.

## Next production modules
1. Category adapters: weather, economics, financial thresholds, sports, politics/news.
2. Evidence ingestion with source timestamps.
3. Monte Carlo and ensemble probability models.
4. Historical prediction ledger, Brier score, log loss and reliability diagrams.
5. Order-book authenticated feed and trade-flow analytics.
6. Paper portfolio and forward-test engine.
7. Optional AI explanation layer that cites evidence but does not fabricate numeric probabilities.
