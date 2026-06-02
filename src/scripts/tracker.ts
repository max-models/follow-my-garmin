import type { TripData } from "../data/trip";
import type { GarminRouteDataByDate, GarminRouteOk, GarminTrackPoint } from "../lib/garmin";
import {
  formatLongDate,
  getLocalIsoDate,
  normalizeGarminUrl,
  selectCurrentDay,
  sortDays,
} from "../lib/trip";

interface TrackerPayload {
  tripData: TripData;
  routesByDate: GarminRouteDataByDate;
}

interface LeafletState {
  map: import("leaflet").Map;
  tileLayer: import("leaflet").TileLayer;
  routeLayer?: import("leaflet").Polyline;
  currentMarker?: import("leaflet").Marker;
}

let leafletState: LeafletState | null = null;
let gpxDownloadUrl: string | null = null;

export async function setupTripTracker(payload: TrackerPayload): Promise<void> {
  const { tripData, routesByDate } = payload;
  const sortedDays = sortDays(tripData.days ?? []);

  if (sortedDays.length === 0) {
    return;
  }

  const todayIso = getLocalIsoDate();
  const selection = selectCurrentDay(sortedDays, todayIso);
  const selectedDay = selection.day;
  const normalizedUrl = normalizeGarminUrl(selectedDay.livetrackUrl);
  const routeData = routesByDate[selectedDay.date];

  setText("trip-title", tripData.trip.title || "Follow My Garmin Trip");
  setText(
    "trip-subtitle",
    tripData.trip.subtitle || "Keep one stable trip page while updating the Garmin LiveTrack link each day.",
  );
  setText("current-day-title", selectedDay.title || "Trip day");
  setText("current-day-date", formatLongDate(selectedDay.date));
  setOptionalText("current-day-location", selectedDay.location);
  setOptionalText("current-day-notes", selectedDay.notes);
  setOptionalText("live-context", selection.reason);
  setOptionalText("current-day-status", selectedDay.status);

  const liveLink = getElement<HTMLAnchorElement>("live-link");
  if (liveLink) {
    if (normalizedUrl) {
      liveLink.href = normalizedUrl;
      liveLink.classList.remove("hidden");
    } else {
      liveLink.removeAttribute("href");
      liveLink.classList.add("hidden");
    }
  }

  const placeholder = getElement<HTMLDivElement>("live-placeholder");
  const mapShell = getElement<HTMLDivElement>("live-map-shell");
  const mapElement = getElement<HTMLDivElement>("live-map");

  if (placeholder && mapShell && mapElement) {
    await renderSelectedRouteMap({
      dayTitle: selectedDay.title || "Trip day",
      livetrackUrl: normalizedUrl,
      placeholder,
      routeData,
      mapShell,
      mapElement,
    });
  }
}

async function renderSelectedRouteMap(options: {
  dayTitle: string;
  livetrackUrl: string | null;
  placeholder: HTMLDivElement;
  routeData?: GarminRouteDataByDate[string];
  mapShell: HTMLDivElement;
  mapElement: HTMLDivElement;
}): Promise<void> {
  const { dayTitle, livetrackUrl, placeholder, routeData, mapShell, mapElement } = options;
  const gpxLink = getElement<HTMLAnchorElement>("gpx-link");

  hideMapStats();
  mapShell.classList.add("hidden");
  placeholder.classList.remove("hidden");

  if (gpxDownloadUrl) {
    URL.revokeObjectURL(gpxDownloadUrl);
    gpxDownloadUrl = null;
  }

  if (gpxLink) {
    gpxLink.removeAttribute("href");
    gpxLink.classList.add("hidden");
  }

  if (routeData?.status === "ok" && routeData.points.length > 0) {
    const Leaflet = await import("leaflet");
    const map = ensureLeafletMap(Leaflet, mapElement);
    const latLngs = routeData.points.map((point) => [point.lat, point.lon] as [number, number]);

    if (leafletState?.routeLayer) {
      leafletState.routeLayer.remove();
    }

    if (leafletState?.currentMarker) {
      leafletState.currentMarker.remove();
    }

    leafletState!.routeLayer = Leaflet.polyline(latLngs, {
      color: "#60a5fa",
      weight: 4,
      opacity: 0.9,
    }).addTo(map);

    const latestPoint = latLngs.at(-1);
    if (latestPoint) {
      leafletState!.currentMarker = Leaflet.marker(latestPoint, {
        icon: Leaflet.divIcon({
          className: "route-marker",
          html: '<span class="route-marker__pin"></span>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(map);
    }

    if (latLngs.length === 1) {
      map.setView(latLngs[0], 11);
    } else {
      map.fitBounds(leafletState!.routeLayer.getBounds(), {
        padding: [72, 72],
        maxZoom: 13,
      });
    }

    mapShell.classList.remove("hidden");
    placeholder.classList.add("hidden");
    updateMapStats(routeData);
    updateGpxDownload(routeData, dayTitle, gpxLink);

    requestAnimationFrame(() => {
      map.invalidateSize();
    });
    return;
  }

  placeholder.innerHTML = buildPlaceholderCopy(routeData, livetrackUrl);
}

function ensureLeafletMap(Leaflet: typeof import("leaflet"), mapElement: HTMLDivElement): import("leaflet").Map {
  if (!leafletState) {
    const map = Leaflet.map(mapElement, {
      zoomControl: true,
      scrollWheelZoom: true,
    });

    const tileLayer = Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    leafletState = {
      map,
      tileLayer,
    };
  }

  return leafletState.map;
}

function updateMapStats(routeData: GarminRouteOk): void {
  setText("stat-distance", formatDistance(routeData.summary.totalDistanceMeters));
  setText("stat-duration", formatDuration(routeData.summary.totalDurationSecs));
  setText("stat-updated", formatDateTime(routeData.summary.lastReportedTime));
  setText("stat-points", String(routeData.summary.pointCount));

  const stats = getElement<HTMLDivElement>("map-stats");
  if (stats) {
    stats.classList.remove("hidden");
  }
}

function hideMapStats(): void {
  const stats = getElement<HTMLDivElement>("map-stats");
  if (stats) {
    stats.classList.add("hidden");
  }
}

function updateGpxDownload(
  routeData: GarminRouteOk,
  dayTitle: string,
  gpxLink: HTMLAnchorElement | null,
): void {
  if (!gpxLink) {
    return;
  }

  const gpx = buildGpxDocument(routeData.points, dayTitle);
  gpxDownloadUrl = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  gpxLink.href = gpxDownloadUrl;
  gpxLink.download = `${slugify(dayTitle)}.gpx`;
  gpxLink.classList.remove("hidden");
}

function buildPlaceholderCopy(routeData: GarminRouteDataByDate[string] | undefined, livetrackUrl: string | null): string {
  if (!livetrackUrl) {
    return "Add today's Garmin LiveTrack URL in <code>src/data/trip.ts</code> once the ride has started, and this page will switch from the placeholder to the custom route map automatically.";
  }

  if (!routeData) {
    return "The Garmin link is set, but no extracted route data is available yet. Try the Garmin link while the next site refresh runs.";
  }

  if (routeData.status === "empty") {
    return "The Garmin session exists, but it has not published any track points yet. Check back after the ride has started moving.";
  }

  return "The last build could not extract route data from Garmin, so use the Garmin link as a fallback for now.";
}

function buildGpxDocument(points: GarminTrackPoint[], dayTitle: string): string {
  const trkpts = points
    .map((point) => {
      const elevation = typeof point.elevation === "number" ? `<ele>${point.elevation.toFixed(2)}</ele>` : "";
      const time = point.time ? `<time>${escapeXml(point.time)}</time>` : "";

      return `<trkpt lat="${point.lat}" lon="${point.lon}">${elevation}${time}</trkpt>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="follow-my-garmin" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(dayTitle)}</name>
    <trkseg>${trkpts}</trkseg>
  </trk>
</gpx>`;
}

function formatDistance(distanceMeters?: number): string {
  if (typeof distanceMeters !== "number") {
    return "-";
  }

  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSecs?: number): string {
  if (typeof durationSecs !== "number") {
    return "-";
  }

  const hours = Math.floor(durationSecs / 3600);
  const minutes = Math.floor((durationSecs % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatDateTime(isoDateTime?: string): string {
  if (!isoDateTime) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDateTime));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function setText(id: string, value: string): void {
  const element = getElement<HTMLElement>(id);
  if (element) {
    element.textContent = value;
  }
}

function setOptionalText(id: string, value?: string): void {
  const element = getElement<HTMLElement>(id);
  if (!element) {
    return;
  }

  if (value) {
    element.textContent = value;
    element.classList.remove("hidden");
    return;
  }

  element.textContent = "";
  element.classList.add("hidden");
}

function getElement<ElementType extends HTMLElement>(id: string): ElementType | null {
  return document.getElementById(id) as ElementType | null;
}
