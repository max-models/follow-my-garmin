# Follow My Garmin

An Astro website for a bikepacking trip where the Garmin LiveTrack URL can change every day.

## How it works

- The homepage stays at one stable URL.
- Trip metadata and day-by-day entries live in `src/data/trip.ts`.
- The browser picks the current day from the visitor's local date.
- If there is no entry for today yet, the site falls back to the most recent day with a Garmin link.
- The Garmin iframe is only activated for the selected current day in the browser. Older days stay in the timeline with direct Garmin links because Garmin LiveTrack sessions usually expire after the ride ends.

## Edit the trip

Update `src/data/trip.ts` and redeploy the site.

Each day entry looks like this:

```ts
{
  date: "2026-06-05",
  title: "Day 4 - Border crossing",
  location: "Village A to Village B",
  status: "planned",
  livetrackUrl: null,
  notes: "Optional notes for followers."
}
```

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `date` | Yes | Use `YYYY-MM-DD`. The site uses the visitor's local date to decide what counts as today. |
| `title` | Yes | Short label for the day. |
| `location` | No | Route summary or destination. |
| `status` | No | Allowed values are `planned`, `riding`, `finished`, `rest day`, and `cancelled`. |
| `livetrackUrl` | No | Set this to the Garmin LiveTrack URL once Garmin has created that day's session. Leave it `null` until then. |
| `notes` | No | Optional context shown on the page. |

## Daily update workflow

1. Add the new day in `src/data/trip.ts` ahead of time with `livetrackUrl: null`.
2. Once the ride starts and Garmin creates the session, paste the new LiveTrack URL into that day's `livetrackUrl`.
3. Optionally update the day's `status` from `planned` to `riding`.
4. Run a new Astro build and redeploy.

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

This Astro app builds to static files in `dist/`, so it can be deployed to any static host, including:

- GitHub Pages
- Netlify
- Cloudflare Pages
- Vercel static hosting

## Important Garmin caveat

Garmin LiveTrack embedding is not a documented public embed API. It works with a normal iframe today, but Garmin could change that behavior later. The page always keeps a direct Garmin link visible as a fallback.
# follow-my-garmin
