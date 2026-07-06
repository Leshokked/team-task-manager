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
- `app/design-brief.md` — design language notes

## Architecture

React 19 + TanStack Start, server-rendered on a Cloudflare Worker, with a D1 (SQLite) database. The `app/` source expects that runtime; migrations run at deploy.

Maintained with Louie. Questions → Carlos.
