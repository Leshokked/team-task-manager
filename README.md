# 9 Birds — Team Task Board

Live weekly task board for the 9 Birds Creative team: Kanban columns (To Do / In Progress / In Review / Done), per-person filtering, checklists, comments, calendar and reports — backed by a shared SQLite (Cloudflare D1) database so everyone sees the same board in real time.

## Using the board

The team does NOT need this repo to work — use the live app. Pick your name once; everything you check off, move, or comment is stamped with it.

- Check a task off: open the card, Mark complete (or drag it to Done)
- Hand a task to someone: drag the card is not needed — open it and change Assignee, or drag between status columns to change status
- Add work: New task (top right) or the + on any column
- Carlos only: New week (carries unfinished tasks over), delete tasks

## What's in this repo

- `index.html` — the original design spec (self-contained mockup)
- `app/src/routes/index.tsx` — the full React app (board, list, calendar, reports, drawer)
- `app/src/lib/api/board.functions.ts` — server functions (tasks, checklists, comments, week rollover)
- `app/src/styles.css` — the design system
- `app/migrations/` — complete database schema + data history
- `cloudflare/worker.js` — self-contained Cloudflare Worker port (page + API in one file, no build step)
- `cloudflare/schema/` — D1 schema + seed data (idempotent, applied at deploy)
- `.github/workflows/deploy.yml` — one-click deploy to Cloudflare Workers
- `app/design-brief.md` — design language notes

## Architecture

React 19 + TanStack Start, server-rendered on a Cloudflare Worker, with a D1 (SQLite) database. The `app/` source expects that runtime; migrations run at deploy.

Maintained with Louie. Questions → Carlos.

## Go live on your own Cloudflare (one-time)

The `cloudflare/` port deploys itself from GitHub Actions. Set it up once; after that every push to `main` redeploys automatically, and the team just uses the URL.

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Copy your **Account ID** — it's in the right-hand sidebar of the dashboard (Workers & Pages overview).
3. Create an API token: **My Profile → API Tokens → Create Token** → use the **"Edit Cloudflare Workers"** template, then add the **D1 → Edit** permission before creating it. Copy the token.
4. In this GitHub repo: **Settings → Secrets and variables → Actions** → add two repository secrets:
   - `CLOUDFLARE_API_TOKEN` — the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID` — the id from step 2
5. Go to the **Actions** tab → select the **Deploy** workflow → **Run workflow**.

The workflow creates the D1 database (`ninebirds-board`), applies the schema and seed data (safe to re-run), and deploys the Worker. The board will be live at:

```
https://ninebirds-board.<your-subdomain>.workers.dev
```

That URL is all the team needs — pick your name once and go. No accounts, no installs.
