# Follow My Garmin

An Astro website for a bikepacking trip where the Garmin LiveTrack URL can change every day.

## How it works

- The homepage stays at one stable URL.
- Trip metadata and day-by-day entries live in `src/data/trip.ts`.
- The browser picks the current day from the visitor's local date.
- If there is no entry for today yet, the site falls back to the most recent day with a Garmin link.
- During the Astro build, the site fetches Garmin LiveTrack HTML and extracts track points into its own route data.
- The browser renders those extracted points on its own map, supports multiple activities with different colors, and offers a GPX download for each extracted activity.
- Route graphs are rendered below the map, and active Garmin sessions also expose live metric charts such as heart rate, speed, power, cadence, and elevation when Garmin publishes that data.

## Edit the trip

Update `src/data/trip.ts` and redeploy the site.

Each day entry can look like this:

```ts
{
  date: "2026-06-05",
  title: "Day 4 - Border crossing",
  location: "Village A to Village B",
  status: "planned",
  notes: "Optional notes for followers.",
  activities: [
    {
      id: "morning-route",
      title: "Morning route",
      color: "#60a5fa",
      livetrackUrl: null,
      notes: "Optional activity notes."
    },
    {
      id: "afternoon-route",
      title: "Afternoon route",
      color: "#f97316",
      livetrackUrl: null
    }
  ]
}
```

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `date` | Yes | Use `YYYY-MM-DD`. The site uses the visitor's local date to decide what counts as today. |
| `title` | Yes | Short label for the day. |
| `location` | No | Route summary or destination. |
| `status` | No | Allowed values are `planned`, `riding`, `finished`, `rest day`, and `cancelled`. |
| `notes` | No | Optional context shown on the page. |
| `activities` | No | Array of Garmin activities for the day. Each activity should have `id`, `title`, `color`, and `livetrackUrl`. |
| `livetrackUrl` | Legacy | Still works for a single-route day, but `activities` is the recommended format now. |

## Daily update workflow

1. Add the new day in `src/data/trip.ts` ahead of time and define one or more `activities`.
2. Once each ride starts and Garmin creates its session, paste the new LiveTrack URL into that activity's `livetrackUrl`.
3. Pick a distinct `color` for each activity so the map and graphs stay readable.
4. Optionally update the day's `status` from `planned` to `riding`.
5. Push to `main` to trigger the GitHub Pages deployment workflow.

## Local development

Install dependencies:

```bash
npm install
```

Start the Astro dev server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the built site locally:

```bash
npm run preview
```

## Deployment

This repository includes `.github/workflows/deploy-pages.yml`, which builds the Astro app and publishes it to GitHub Pages on every push to `main`.

The same workflow also runs every 15 minutes so the extracted route can refresh during an active Garmin session without a manual redeploy.

In the repository settings, set **Pages** to use **GitHub Actions** as the source.

The Astro config automatically applies the repository base path during GitHub Actions builds so the site works from the GitHub Pages project URL.

## Important Garmin caveat

Garmin LiveTrack does not provide a documented public GPX or embed API for this use case. This site extracts route points from Garmin's public LiveTrack page at build time, so if Garmin changes that page structure the custom map may stop updating until the extractor is adjusted. The page always keeps a direct Garmin link visible as a fallback.
