# Wajid Swing Liquidity — Cloudflare migration

The site is now prepared to run without Vercel.

## Cloudflare Pages

Create a Pages project from this GitHub repository and use:

- Production branch: `main`
- Root directory: `/`
- Build command: none
- Build output directory: `/`

Pages will serve `index.html` and the `functions/` directory will provide `/api/liquidity`, `/api/history`, and `/api/telegram`.

## Required secrets

Add these as Cloudflare Pages project secrets/environment variables:

- `TWELVE_DATA_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Do not commit secret values to GitHub.

## Cloudflare Worker option

The same API engine is also available under `cloudflare/src/index.js` with `cloudflare/wrangler.toml`. It uses the Cloudflare Cache API and can be deployed independently if desired.

## Strategy safety

The Cloudflare engine keeps the existing Swing Liquidity parameters: Gold/XAUUSD, 5min/15min, swingLeft 15, swingRight 10, ATR 14, sweep lookback 8, confirmation window 6, 3 ATR maximum structural stop, and 1R/2R/3R targets. No strategy calculation is delegated to the browser.

History remains TP2 = official WIN (+2R), SL before TP2 = LOSS (-1R), with TP1 as a milestone only.
