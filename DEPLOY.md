# Card Tracker hosting guide

This is a single-user bank-data tracker. The readiness changes must be reviewed,
configured and explicitly approved for deployment before connecting a real bank.
Pushing this work to a separate branch is not a deployment.

## Existing service: changes needed before deployment

Use the Render dashboard's Environment settings. Never paste passwords, API
secrets, database tokens or encryption keys into chat, source files or GitHub.
Do not save environment changes until you are ready for the resulting restart or
redeployment.

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_PIN` | A unique password-manager-generated password, at least 20 characters, not just digits. The variable keeps its old name but short PINs are no longer accepted. |
| `TOKEN_ENCRYPTION_KEY` | A separate cryptographically random secret, at least 32 characters. Use a password manager's random generator; do not reuse the app password. |
| `PLAID_ENV` | `production` for real connections, `sandbox` for Plaid test connections. |
| `PLAID_CLIENT_ID` | Your current Plaid client ID. |
| `PLAID_SECRET` | The current secret for the selected Plaid environment. |
| `TURSO_DATABASE_URL` | Your intended persistent Turso database URL. |
| `TURSO_AUTH_TOKEN` | A current token restricted to that database, with only the permissions this app requires. |

Keep a secure backup of `TOKEN_ENCRYPTION_KEY` separate from the database.
Changing or losing it makes existing encrypted bank tokens unreadable. Encryption
protects stored bank tokens, not the transaction rows, and does not protect
against compromise of the running server or an attacker holding both the
database credentials and the encryption key.

The application refuses production startup without the stronger password, or
without an encryption key when Plaid is configured. The `render.yaml` blueprint
generates an encryption key for newly created blueprint services; it does not
update the environment of an existing manually configured service.

No bank is expected to have been connected yet. If real connections already
exist with old plaintext tokens, stop before deploying: they require a controlled
encryption migration or provider-side revocation/reconnection. This update does
not silently read legacy plaintext tokens in production.

## Deployment settings

When deployment is explicitly approved:

- **Repository and branch:** select the reviewed branch deliberately. Check the
  service's current auto-deploy and preview settings first.
- **Build command:** `npm ci --include=dev && npm run build`
- **Start command:** `npm start`
- **Persistent storage:** confirm the intended Turso database is configured.
  The development fallback SQLite file is not suitable for ephemeral hosting.
- **Runtime:** use a supported Node version compatible with the locked
  dependencies. Do not omit development dependencies during the build.

Before approving a deployment, verify a clean build using the updated lockfile,
then check the deployed password gate, logout/idle lock, Plaid SDK loading,
browser console, and mobile layout. Source-level and dummy-fixture tests do not
replace these deployment checks.

## Account and data safety checklist

- **Previously shared credentials:** revoke the GitHub PAT previously posted in
  chat. Plaid and Turso credentials were reported rotated; verify that the old
  values are actually revoked rather than merely replaced in the app.
- **Account protection:** enable MFA on GitHub, Render, Turso, Plaid and your bank
  accounts. The app itself remains password-only, not MFA-protected.
- **Access limits:** restrict team membership and database-token scope. Avoid
  sharing the app password or connecting banks from an untrusted/shared device.
- **Recovery:** confirm database backup retention, restore procedure and
  deletion/retention policy in Turso. These cannot be inferred from repository
  code. Test restoration only with disposable data first.
- **Bank coverage:** confirm your particular institution, accounts and required
  products are enabled in Plaid before linking. Do not assume all banks expose
  complete payment facts.

## Connecting and maintaining bank data

Stored sample cards are hidden by default, without deleting their database rows.
Use Connect → Show sample cards to display them for the current page session.
Refresh or locking switches them off again. When any real bank is connected,
samples remain hidden regardless of this setting, so payment/spending totals
never mix sample and real data. No new environment variable is needed.

Only after approval and the checks above, open the app, unlock it, and use
Connect a bank. Enter bank credentials only in the bank/Plaid authentication
flow, never in chat or an app configuration field.

Use Connect → Sync now to refresh. This version has no background scheduler or
webhook processing. "Last complete sync" describes the last successfully stored
snapshot, not guaranteed real-time bank data. An initial-sync warning means the
connection was saved but the financial snapshot is not ready.

Confirm payment amounts and due dates directly with the bank. Missing fields,
unavailable products, removed accounts and provider delays can make this tracker
incomplete; do not rely on it as your only bill-payment reminder.

If a previously known account disappears from the provider response, or a current
balance is unavailable, this version rejects the refresh and keeps the prior
snapshot and timestamp. It does not silently delete account history or mark old
balances as current. Review account-sharing settings and the connection before
retrying; an inactive-account reconciliation interface is not implemented.

Use Remove bank to revoke access and delete that bank's local records. If
revocation fails, records remain for retry. If the provider acknowledges
revocation but local cleanup fails, a stored marker allows cleanup to be retried
without a second revocation request. If the provider succeeds but its reply is
lost, or the marker cannot be saved, the app cannot prove the outcome; confirm
access removal with your bank/Plaid before manual cleanup. Local deletion is not
a promise that historical database backups have also been purged.

## Local regression checks

`npm test` runs dummy-only tests inside a Linux sandbox. `npm run check:sandbox`
runs TypeScript checking in the same confinement; `npm run check` is the normal
unsandboxed developer type-check command.

The sandbox command requires Python 3, bubblewrap, libseccomp, GNU timeout,
prlimit, a Node binary at `/usr/local/bin/node`, and already installed local
dependencies. It has no external network or ambient credentials, uses read-only
source/dependencies, permits writes only in a 16 MiB scratch filesystem, and
limits CPU, memory, process creation, files and wall-clock time. It does not
install packages or contact Turso/Plaid.

Tests cover the password middleware in process, sample-data isolation, deletion
and retry behavior, encrypted tokens, sync pagination/rollback/reconciliation,
link persistence, redacted state and client authentication errors. They are not
a full browser end-to-end test or a guarantee of production security.
