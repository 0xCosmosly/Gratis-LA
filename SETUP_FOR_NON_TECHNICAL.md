# Step-by-step setup (non-technical)

Use this checklist in order. You can do all of this for free.

## Fastest start (no accounts required)

1. Open Terminal in this project folder.
2. Run:

```bash
npm run quickstart
```

3. Open the local URL shown in Terminal.

This runs the web app in local mode using built-in seed data and saves your changes on this device.

## Full cloud mode (optional)

Follow this only if you want shared live data, moderation, and auto-verification.

## Part A: Accounts

1. Make a GitHub account at https://github.com.
2. Make a Supabase account at https://supabase.com.
3. Make a Vercel account at https://vercel.com (choose "Continue with GitHub").

## Part B: Supabase project

1. In Supabase, click `New project`.
2. Give it any name (example: `gratis-la`).
3. Wait for project creation.
4. Open `SQL Editor`.
5. Open this file from the project: `supabase/schema.sql`.
6. Copy/paste all SQL into Supabase and click `Run`.

## Part C: Find keys in Supabase

1. In Supabase, go to `Project Settings`.
2. Open `API`.
3. Copy these 3 values and save them temporarily:
   - Project URL
   - anon public key
   - service_role key

## Part D: Enable cloud mode locally

1. Create `.env` from `.env.example`.
2. Put in your Supabase URL and anon key:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

3. Run:

```bash
npm run dev
```

## Part E: Add starter restaurant data

Easiest method:

1. In Supabase SQL Editor, open file `supabase/seed.sql`.
2. Copy/paste and click `Run`.

Optional command-line method:

```bash
SUPABASE_URL="your_project_url" SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" npm run sync:seed
```

## Part F: Put app online for free (Vercel)

1. Push this project to GitHub.
2. In Vercel, import that GitHub repo.
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click Deploy.

## Part G: Turn on free auto-updates

1. In GitHub repo settings -> `Secrets and variables` -> `Actions`.
2. Add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. GitHub action runs every 6 hours and checks source pages.

## Part H: Ongoing moderation

In Supabase table editor:

- `restaurants.verification_status`
  - use `verified` for places you confirm
  - use `rejected` for service fee / fast food
- `photos.status`
  - set to `approved` to show user-submitted photos
