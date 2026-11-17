# Security update checks

## Card nicknames
- User reports the deployed sample switch and one real bank connection/manual sync work. Do not access or modify the live database during development.
- Open a card → Rename card → enter a nickname → Save; use the nickname in Cards, next-payment text, detail, Activity/Spending filters and transaction card labels.
- Preserve bank name, account ID, balance, transactions and token. A later bank sync must not overwrite the nickname.
- Clearing the nickname restores the current bank-provided name. Cancel and rejected saves must not change the stored name.
- Add only the independent account_preferences table on startup; no alteration, deletion or migration of existing financial rows.
- Validate with isolated dummy-data tests and TypeScript. Live mobile/browser checks remain pending manual deployment.

## Sample visibility change
- Baseline: user confirmed password gate, unlock, manual lock and Plaid opening on Render; existing stored samples are still visible without real banks.
- Requested: Connect offers "Show sample cards", off by default; show/hide applies to Cards, card detail, Activity and Spending through the shared state response.
- Visibility is session-only and resets after refresh or locking. No sample, bank, account or transaction rows are deleted by this setting.
- When any real connection exists, samples remain hidden even if requested; sample totals never mix with real totals.
- Validate: dummy-only state and mutation-response tests, client request preference/reset tests, TypeScript. Live browser verification requires user redeployment; do not claim it was performed.

The first checklist records earlier manual flow checks, not verification of the
current readiness branch. Re-run deployed/browser checks only after explicit
deployment approval. Current automated checks use dummy data and mocked Plaid.

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

## Scoped lifecycle fixes (local dummy fixtures, no deployment)
- Production: empty storage stays empty; reload-samples API is forbidden and its button is hidden.
- Development samples: reloading replaces only demo records, preserving real item/account/transaction fixtures.
- Disconnect: confirmation is required in the UI; rejected provider revocation retains local records and shows an error.
- Deletion: successful revocation removes only the selected item's rows in one local transaction; local failure rolls back.
- Disconnect all: explicit request confirmation; revoke before deleting each item, retain failures and report partial completion.
- Backend unavailable: config error blocks the app with Retry; network/404/405 never produce preview data or success.

## Readiness regressions
- Password middleware: public config only; missing/wrong passwords reject, throttling expires and responses use no-store.
- Tokens: AES-256-GCM ciphertext round-trips; modified ciphertext and a wrong key fail.
- Production config: strong password and a separate encryption key are required when enabling banks.
- Disconnect retry: upstream acknowledgment is persisted before transactional cleanup; failed cleanup retains a retry marker.
- Sync: modified transactions update, removed-object IDs delete, pending-to-posted replacement does not duplicate, and deletion is scoped to the bank.
- Sync integrity: page failure or liability failure preserves the prior complete snapshot; pagination mutation restarts from the original cursor.
- Sync/disconnect race: a removed item cannot be reinserted by a delayed sync.
- Linking: encrypted token is stored before metadata; failed initial sync reports a warning; failed persistence attempts compensating revocation.
- State: cursors/tokens never reach the client, and real connections hide demo fixtures.
- Client: a 401 clears the memory-only password and emits the lock event.
- Missing accounts/unknown balances: refresh fails without advancing the complete-sync timestamp or deleting history.
- Legacy plaintext production tokens: fail closed without provider calls or local deletion; migration/reconnection remains required if any exist.
- Revocation marker write failure: records remain and a rejected second revocation is not misreported as successful cleanup; manual reconciliation remains necessary.
- Source-implemented, browser validation pending: manual lock, query-cache clearing, 15-minute idle/visibility lock, SDK lifecycle and refreshed errors.

## Remaining external validation
- Render authorization is unavailable; current branch, auto-deploy settings, environment values and live runtime are unverified.
- A clean build with the updated lockfile is still required; no dependencies were installed during this review.
- Verify old credential revocation, account MFA, Turso token scope and backup/restore settings in their dashboards.
- Confirm provider product coverage and lost-acknowledgment recovery with disposable sandbox connections before real linking.
