# Gratis LA

A website-first Koreatown research database that works on mobile and desktop under strict rules:

- Tips are not accepted.
- No service fee is imposed.
- Fast food chains are excluded.
- Listings include source citations.

This repo contains:

- A React web app (`src/`)
- Supabase schema/seed files (`supabase/`)
- Verification scripts and a free GitHub Action (`scripts/`, `.github/workflows/`)

## Quick start (no accounts, no data keys)

Run immediately in local mode:

```bash
npm run quickstart
```

Local mode behavior:

- Loads bundled public data from `data/seed-restaurants.json`.
- Keeps internal scrape history in `data/tracked-restaurants.json`, `data/review-restaurants.json`, and `data/rejected-restaurants.json`.
- Runs as a read-only Koreatown pilot dataset.
- No Supabase account needed.
- Uses the same responsive UI on phones and desktops.
- Includes a live map in local mode without any extra keys.

## Enable full cloud mode (optional)

Use this only when you want live shared data, moderation, and scheduled verification updates.

### 1. Create free accounts

1. Create a [GitHub](https://github.com/) account.
2. Create a [Supabase](https://supabase.com/) project.
3. Create a [Vercel](https://vercel.com/) account (can use GitHub login).

### 2. Set up Supabase

1. In Supabase, open `SQL Editor`.
2. Run `/Users/ray/Documents/2. AI Coding/Gratis LA/supabase/schema.sql`.
3. Copy from `Project Settings -> API`:
   - Project URL
   - anon public key
   - service_role key (private)

### 3. Configure local env

1. Copy `.env.example` to `.env`.
2. Fill:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### 4. Seed data (choose one)

- SQL: run `/Users/ray/Documents/2. AI Coding/Gratis LA/supabase/seed.sql` in Supabase SQL Editor
- Script:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync:seed
```

### 5. Run locally in cloud mode

```bash
npm run dev
```

With valid env keys, the website switches automatically from demo mode to Supabase-backed mode.

## Deploy for free on Vercel

1. Push this repo to GitHub.
2. Import repo in Vercel.
3. Set env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

## Deploy on GitHub Pages

1. Push this repo to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Under `Build and deployment`, choose the `main` branch and the `/docs` folder.
4. Build with `VITE_BASE_PATH=/your-repo-name/ npm run build`, copy `dist` into `docs`, then push.
   For this repo specifically, use `VITE_BASE_PATH=/Gratis-LA/`.

Notes:

- Local-data mode works on GitHub Pages without any extra keys.
- If you want Supabase-backed mode on GitHub Pages, add repository variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- If you later use a custom domain or a root `username.github.io` site, you can override the detected base path during build with:
  - `VITE_BASE_PATH=/`

## Automatic verification checks (free)

Workflow: `/Users/ray/Documents/2. AI Coding/Gratis LA/.github/workflows/verify-restaurants.yml`

1. In GitHub repo settings, add Actions secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Workflow runs every 6 hours and can also be run manually.
3. It executes `npm run verify:db` and uploads `data/latest-verification-report.json`.

## Local dataset maintenance

To rescan Koreatown official restaurant websites for no-tip or fee language:

```bash
npm run scrape:koreatown
```

This writes a report to `/Users/ray/Documents/2. AI Coding/Gratis LA/data/koreatown-site-policy-scan.json`.

To validate bundled local restaurant quality (required fields, duplicate checks, dining-hall exclusion, coordinate bounds):

```bash
npm run validate:local-data
```

## Important note

No free data source can guarantee perfect policy freshness at all times. This app is built for transparency with visible citations and scheduled checks.
