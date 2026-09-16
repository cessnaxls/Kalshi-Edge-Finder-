# EdgeLab v7 — Every ticker gets a model

v7 removes the `NO MODEL` dead end.

## Model hierarchy

### Tier 1 — Independent quantitative model
Used whenever EdgeLab has a supported real-world adapter:
- sports scoring/history models;
- soccer Poisson model;
- crypto/financial threshold volatility model.

These models can be compared with Kalshi executable prices as independent model/market discrepancies.

### Tier 2 — Universal Bayesian fallback
Every other quoted market receives a numerical P(YES).

The fallback starts from the executable market midpoint, measures spread/liquidity/activity, shrinks noisy markets toward a 50% prior, and permits only a bounded ±2 percentage-point order-flow adjustment. It then attaches a deliberately wide uncertainty allowance.

This means every ticker has:
- P(YES)
- P(NO)
- uncertainty
- model inputs
- model class/source
- executable YES/NO discrepancy

## Critical distinction
The fallback is market-implied. Because its prior comes from Kalshi itself, its difference from Kalshi price is NOT independent proof of mispricing. v7 therefore excludes fallback-model discrepancies from the independent fundamental-edge ranking.

Fallback markets can still be surfaced by the structural engine when related contracts violate probability constraints, and their microstructure/order-flow signal remains available.

This design gives universal coverage without pretending circular market-derived estimates are independent statistical edge.
