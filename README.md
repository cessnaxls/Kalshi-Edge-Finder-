# EdgeLab v4 — Sports + Crypto autonomous edge scanner

Only user input required for individual analysis: Kalshi ticker(s). The full scanner requires no tickers.

## Full scanner
`SCAN ALL LIVE`:
1. Pages through the complete Kalshi `status=open` universe (up to 1,000/page).
2. Classifies sports and crypto.
3. Attempts independent category-specific probability models.
4. Compares model probability with executable YES/NO ask.
5. Applies a deliberately conservative model-uncertainty allowance.
6. Ranks only positive uncertainty-adjusted discrepancies.

## Sports v4
Sports propositions are matched against independent public game/schedule data. Where a matched event exposes usable consensus reference information, EdgeLab converts the reference spread into a sport-specific margin/win distribution. The model and exact inputs are shown in the audit view.

Supported matching targets include NFL, college football, NBA, men's college basketball, MLB, NHL, and major soccer competitions.

A sports market is NOT ranked if:
- no independent event can be matched confidently;
- no usable independent consensus reference is available;
- the proposition type is not supported by the current model.

This is intentional. The scanner never derives its "independent" probability from Kalshi's own price.

## Crypto
Supported BTC/ETH threshold propositions use independent public spot-price history plus a realized-volatility threshold model.

## Interpretation
Raw edge = independent model probability - executable Kalshi price.
Conservative edge = raw edge - model uncertainty allowance.

A positive modeled discrepancy is not proof of mispricing or future profit. Model error, reference-data error, settlement rules, fees, slippage, latency and changing information can eliminate apparent edge.
