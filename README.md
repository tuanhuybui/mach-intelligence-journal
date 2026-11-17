# MẠCH. — The Intelligence Journal

Vietnamese technology, AI, Agent, science and robotics editorial webapp.

## Architecture
- `index.html` — standalone single-page site, responsive editorial UI and reader engagement.
- `api/index.js` — Vercel Node.js serverless API (Supabase-backed).
- `sql/` — Supabase Postgres analytics migrations used by v7.
- `vercel.json` — project configuration, **no Vercel cron**.
- ChatGPT scheduled Newsroom automations create five daily editorial articles directly in the Supabase Mach project. These are managed in ChatGPT, **not** in this GitHub source.
- Frontend user submissions require moderator approval.

## Deployment

Vercel project: `mach-intelligence-journal`; production URL: https://mach-intelligence-journal.vercel.app

Environment variables configured in Vercel settings (do not commit values):
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `MACH_AGENT_KEY` (if external agents should submit pending articles)

## Article reading UI v8
- Article metadata contains author, date, reading time and views **once**.
- Compact unified 2×2 toolbar: Like, Save, Share and Copy link.
- Toolbar becomes a horizontal row on mobile.
- All counters continue to use existing Supabase metrics, with their original API events.

## Security
Never add secrets, service-role credentials, API tokens, .env files or Supabase credentials to the repository. Public readers cannot publish via browser. Content from public submissions enters `pending`.