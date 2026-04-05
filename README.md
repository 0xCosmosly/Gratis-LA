# Gratis LA

**[🌟 View the Live Site](https://0xcosmosly.github.io/Gratis-LA/)**

Gratis LA is a community-sourced map of restaurants around Los Angeles that either enforce a strict no-tipping policy or transparently fold gratuity/service fees into their final prices. The project aims to help locals find straightforward dining experiences under strict criteria, bringing clarity to an increasingly confusing dining landscape. 

## Project Description

Gratis LA serves as an interactive directory and map to find restaurants that eliminate hidden fees and expected tips. The core mission is transparency. To ensure accuracy, the platform enforces a strict data verification methodology:
- Tips must be explicitly not expected, not accepted, or entirely optional.
- Service fees must be clearly documented, credited, and mandatory on every bill (transparently included).
- Fast food chains are generally excluded to focus on full-service and unique counter-service spots.
- Every single listing includes source citations (official menus, newsroom pages, institutional hospitality PDFs, etc.) so users know exactly *why* a location is on the map.

## How the Site Functions

The Gratis LA platform is built as a responsive web application (using React and Vite, backed by Supabase) that seamlessly works across desktop and mobile devices. 

### Interactive Map and List Views
- **Dual Interface:** Users can explore restaurants via an interactive map (powered by Leaflet) or scroll through a detailed list view. On mobile devices, the interface elegantly toggles between the map and list panels to maximize screen real estate.
- **Geolocation Integration:** If a user provides location access, the app calculates distances using the Haversine formula and can automatically focus on or highlight the closest mapped restaurant to the user's current location.
- **Detailed Restaurant Cards:** Clicking on a restaurant reveals a detailed card containing its verification status, policy type ("No tip" vs "Included" fee), restaurant category (e.g., sit-down, quick service, bar), and a direct link to the official citation proving their policy.

### Filtering and Search
- **Policy Filters:** Users can filter the map by specific policies:
  - `No Tip`: Restaurants that explicitly state tips are not accepted or expected.
  - `Included`: Restaurants that add a mandatory, transparent service fee to every bill in lieu of an expected tip.
  - `Unverified`: New leads that are awaiting community or admin verification.
- **Restaurant Categories:** The view can be narrowed down to specific dining experiences like Sit-Down, Quick Service, Bars, or Chains.
- **Search Capabilities:** A robust search bar allows users to quickly find specific restaurants by name or explore specific neighborhoods.

### Community Verification System
- **Crowdsourced Accuracy:** The platform includes a community moderation feature. Users can cast verification votes on a restaurant (`verified`, `candidate`, `needs_review`, `rejected`) to maintain the integrity of the data.
- **Strict Evidence Rules:** To maintain high quality, the site relies on exact-phrase discovery on official domains (e.g., "gratuity-free", "tips are not expected or accepted"). Third-party review sites like Yelp or Reddit are used only as leads, not as official proof.

### Technical Architecture
- **Frontend:** A React Single Page Application (SPA) providing a fast, app-like experience with highly responsive state management.
- **Backend/Data Sync:** Designed to work both in a local "demo" mode with bundled data for immediate access, and in a full "cloud" mode using Supabase. The cloud mode enables live data sharing, the community moderation voting system, and scheduled verification updates.
- **Progressive Web App (PWA):** Built with static assets, a manifest, and service workers, allowing users to install the directory directly on their mobile devices for quick access on the go.
