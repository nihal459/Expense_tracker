# Expense Dashboard

React dashboard for the expense Google Sheet. It reads the `Transactions` tab through a small Apps Script feed, and reloads only when an entry is added, edited or deleted (it checks a small fingerprint every 10 seconds) or when you press Refresh.

## Setup

1. In the sheet, open Extensions › Apps Script. Add `apps-script/api.gs` as a new file next to the existing dashboard builder (it reuses `DASH_SPREADSHEET_ID` and `DASH_SOURCE`).
2. In Apps Script, open Project Settings › Script Properties and add `DASH_PASSWORD` with your login password. The feed refuses every request without it.
3. Deploy › New deployment › Web app. Set Execute as **Me** and Who has access **Anyone**. Copy the URL ending in `/exec`.
4. Copy `.env.example` to `.env.local` and set `VITE_SHEET_API_URL` to that URL.
5. `npm install`, then `npm run dev`.

If you edit `api.gs` later, use Deploy › Manage deployments › Edit › New version, so the URL stays the same.

`npm test` runs the filter logic checks.
