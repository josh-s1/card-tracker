# Card Tracker — Hosting Guide

This document explains how to get your personal Card Tracker running with real bank
logins, from zero, with no coding. Total time: about 20 minutes.

## What you're building

The app has two parts:

1. **The app itself** (this folder) — a Node.js server that serves the mobile web app and talks to Plaid.
2. **Two free cloud services:**
   - **Turso** — holds your data (cards, balances, transactions). Free, no credit card.
   - **Render** — runs the app 24/7 at a permanent URL. Free, no credit card.
   - **Plaid** — connects to your banks (US/Canada). Free Trial plan, no credit card.

Free-tier note: Render's free instances sleep after ~15 minutes of inactivity.
Your data is safe (it lives in Turso); the app just takes about a minute to wake up
on the first visit after a long idle period.

## Step 1 — Plaid account (bank connections)

1. Go to https://dashboard.plaid.com and sign up.
2. Verify your email and finish onboarding (choose "Personal" use when asked).
3. On the left menu, go to **Team settings → API keys**.
4. Copy the **Client ID** and the **Production secret key**.
   (The Trial plan gives you real bank data with up to 10 connected banks.)

Save those two values for Step 4.

## Step 2 — Turso account (your data)

1. Go to https://turso.tech and sign up (works with GitHub or Google, no card).
2. Click **Create database**, name it `card-tracker`, pick the closest region.
3. Open the database page and copy its **URL** (looks like `libsql://card-tracker-....turso.io`).
4. On the same database page, find **Database tokens** (under the Connect/settings area),
   click **Generate token**, and copy the token.

Save those two values for Step 4.

## Step 3 — Put this folder on GitHub

1. Go to https://github.com and create a free account (if you don't have one).
2. Click **New repository**, name it `card-tracker`, choose **Public**, leave every
   checkbox empty, and click **Create repository**.
3. On the next page, click the link **"uploading an existing file"**.
4. Unzip `card-tracker-hosting.zip` on your computer, then drag the unzipped
   folder's contents (all files and folders) into the GitHub upload page.
5. Click **Commit changes**.

## Step 4 — Deploy on Render

1. Go to https://render.com and sign up (choose **Sign up with GitHub** — this is
   what lets Render see your repository).
2. Click **New + → Web Service**.
3. Choose the `card-tracker` repository → **Connect**.
4. Fill in:
   - Name: `card-tracker`
   - Region: closest to you
   - Instance type: **Free**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
5. Click **Environment** (or Advanced → Add environment variable) and add these
   variables one by one:
   - `TURSO_DATABASE_URL` → the Turso URL from Step 2
   - `TURSO_AUTH_TOKEN` → the Turso token from Step 2
   - `PLAID_CLIENT_ID` → from Step 1
   - `PLAID_SECRET` → from Step 1
   - `APP_PIN` (optional) → any 4+ digit PIN to lock your app behind a login screen
6. Click **Deploy Web Service** and wait for the build (a few minutes).
7. When it's live, open the URL at the top of the page (e.g. `https://card-tracker-xxxx.onrender.com`).

## Step 5 — Connect your cards

1. Open your app URL on your phone.
2. Go to the **Connect** tab → **Connect a bank**.
3. Sign in with your bank credentials (Chase, Amex, Wells Fargo, Citi, etc. —
   all major US and Canadian banks are supported).
4. Your cards appear in the **Cards** tab with balances, due dates, APR, and transactions.
5. Add to Home Screen: in your phone browser, tap Share → **Add to Home Screen**.

## Maintenance

- **Refresh data**: Connect tab → **Sync now** (transactions update on each visit too).
- **Remove a bank**: Connect tab → the bank card → Remove.
- **App updates**: edit the GitHub repo (or have this assistant do it), and Render
  redeploys automatically. Your data in Turso is never touched.
