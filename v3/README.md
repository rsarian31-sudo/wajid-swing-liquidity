# Wajid Swing Liquidity — Clean Rebuild v3

## Non-negotiable strategy lock

This rebuild is a new presentation/application layer. The canonical Swing Liquidity strategy mathematics must not be changed.

- Symbol: XAU/USD only
- Timeframes: 5M and 15M only
- No look-ahead / no repainting
- Swing high/low processing starts from the next candle after the swing is confirmed
- Signal lifecycle and locking remain canonical
- TP1 = 1R milestone only
- TP2 = official WIN at +2R
- SL before TP2 = LOSS at -1R
- Same-candle SL + TP2 resolves as LOSS conservatively
- Gold max-stop history filter: $10

Canonical parameters:
- swingLeft: 15
- swingRight: 10
- ATR: 14
- sweepLookback: 8
- confirmationBars: 6
- outputSize: 300
- slAtrBuffer: 0.35
- maxStopAtr: 3
- TP1/TP2/TP3: 1R / 2R / 3R

## Target architecture

Frontend: HTML + CSS + Vanilla JS
Chart: Lightweight Charts
Backend: Cloudflare Pages Functions
Market data: Twelve Data initially
Caching: Cloudflare Cache API
Notifications: Telegram through Cloudflare Functions
Database: none initially
Hosting: Cloudflare Pages only
Vercel: intentionally excluded
React/Next.js: intentionally excluded

## v3 UI direction

The dashboard takes inspiration from modern trading/AI products: strong status hierarchy, compact performance cards, clear signal lifecycle, transparent history, and a clean terminal-like chart. We recreate general UX patterns only; no third-party code or protected visual assets are copied.

## Build order

1. Freeze canonical strategy contract.
2. Build backend endpoints around the canonical engine and server-side caching.
3. Build the dashboard shell and chart.
4. Add signal, trade-plan, and diagnostics panels.
5. Add history/performance using the same canonical resolution rules.
6. Add Telegram notification endpoint.
7. Add production hardening: cache headers, API-key secrecy, rate protection, error states, and health checks.
8. Validate 5M/15M output against the canonical implementation before release.
