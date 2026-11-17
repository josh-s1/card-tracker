# Security update checks

- Live baseline: unauthenticated app shows "Card Tracker is locked".
- Unlock: incorrect password stays locked with an error; correct password loads cards.
- Cards: three sample cards and balances; card detail shows payment facts and transactions.
- Activity: transaction list, search and card filter work.
- Spending: category and merchant views work.
- Connect: sample-data and configuration controls render without real bank calls.
- Security: unauthenticated state/unlock rejected; config remains public with no secrets.
- Security: after ten failed guesses, further requests return 429 with Retry-After.
- Security: API logs contain method, path, status and duration only, never response bodies.
- Production without APP_PIN refuses startup.
- Desktop/mobile: no horizontal overflow; no new browser errors in ordinary flows.
- Hosted check: public config includes security release marker after Render redeploys.
- Plaid script: Connect a bank loads the official SDK directly from Plaid.
- Plaid retry: failed SDK download clears the cached promise; next click retries without refresh.
