# Gratis LA

A community-sourced map of restaurants around Los Angeles that either enforce a strict no-tipping policy or fold gratuity/service fees transparently into their final prices. 

Built to help locals find straightforward dining experiences under strict criteria:
- Tips are generally not accepted or entirely optional.
- Service fees are clearly documented and credited.
- Fast food chains are excluded to focus on full-service and unique counter-service spots.
- Every single listing includes source citations so you know *why* it's on the map.

## Project Structure

This project uses a React frontend powered by Vite and a backend powered by Supabase.

- **`src/`**: The React application code. This is where all the UI components, styles, map logic (Leaflet), and state management live.
- **`public/`**: Static assets that don't need processing, like the PWA manifest, service workers, and app icons.
- **`scripts/`** *(local only)*: Automation tools used for gathering, validating, and managing data behind the scenes. This includes scrapers, formatting scripts, and database sync utilities.
- **`supabase/`** *(local only)*: Contains the database schema and seed data to replicate the exact database state locally.
- **`data/`** *(local only)*: Raw output logs from web scrapers and AI agents used to gather new leads and build the database.

*(Note: Certain data files, Supabase credentials, and iOS build artifacts are kept off the public repository for security and cleanliness.)*

## Quick Start (No accounts, no API keys)

You can run the app immediately in local mode to check it out:

```bash
npm install
npm run dev
```

When running locally without a database connected:
- The app automatically loads bundled demo data.
- No Supabase account is required.
- You get the exact same responsive UI on both mobile and desktop.
- The live interactive map works out of the box.

## Setting up Full Cloud Mode (Optional)

If you want to run the live site with shared data, moderation features, and scheduled verification updates, you'll need to hook it up to a backend.

### 1. Configure your local environment

1. Copy `.env.example` to `.env`.
2. Fill your Supabase variables:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

With valid environment keys, the website automatically switches from demo mode to Supabase-backed live mode when you run `npm run dev`.

## Important Note

Restaurant policies change frequently! While we try our best, no free data source can guarantee perfect policy freshness at all times. This app is built entirely around transparency, which is why we link out to menus, articles, and Reddit threads as visible citations for every spot.
