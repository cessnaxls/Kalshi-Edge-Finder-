# EdgeLab v6 — Universal Three-Engine Architecture

## Goal
Analyze essentially any Kalshi ticker without asking the user for a probability.

A ticker is processed by three independent engines.

### 1. Fundamental engine
Routes supported propositions to real-world quantitative models:
- Sports: real schedules/results + recent scoring distributions; soccer Poisson.
- Crypto/financial thresholds: independent public price history + realized-volatility distribution.
- Unsupported categories return NO FUNDAMENTAL MODEL rather than a fabricated probability.

### 2. Structural engine
Does not need to know the "true" probability. It scans related Kalshi markets for mathematical inconsistencies:
- nested threshold monotonicity;
- apparent exhaustive winner-set sums;
- related-contract probability ordering.

Structural flags are candidates requiring settlement-rule verification, not guaranteed arbitrage.

### 3. Microstructure engine
Uses the Kalshi order book and recent trades:
- YES vs NO displayed depth;
- depth imbalance;
- recent taker-side imbalance;
- BUY PRESSURE / SELL PRESSURE / BALANCED signal.

Microstructure is intentionally kept separate from fundamental probability. Order flow is not proof of fair value.

## Ranking
The scanner can rank a market when either:
- an independent fundamental model has positive uncertainty-adjusted discrepancy, or
- a structural relationship produces a measurable inconsistency.

Order flow is shown as execution/timing context rather than being silently converted into a fake probability.

## Important limitations
No system can know that every apparent discrepancy is a true mispricing. Settlement-rule differences, fees, queue priority, stale quotes, model error, latency and hidden relationships can invalidate an apparent edge. The app therefore exposes the engine and evidence behind every candidate.
