import type { TripActivity, TripData } from "../data/trip";
import type { GarminRouteData, GarminRouteDataByDate, GarminRouteOk, GarminTrackPoint } from "../lib/garmin";
import {
  formatLongDate,
  getDayActivities,
  getLocalIsoDate,
  getPrimaryGarminUrl,
  selectCurrentDay,
  sortDays,
} from "../lib/trip";

interface TrackerPayload {
  tripData: TripData;
  routesByDate: GarminRouteDataByDate;
}

interface ActivityEntry {
  dayDate: string;
  dayTitle: string;
  activity: TripActivity;
  routeData?: GarminRouteData;
}

interface ActivityRouteEntry extends ActivityEntry {
  routeData: GarminRouteOk;
}

interface ChartSeriesPoint {
  x: number;
  y: number;
}

interface ChartSeries {
  color: string;
  label: string;
  points: ChartSeriesPoint[];
}

interface GraphCardDefinition {
  title: string;
  axisLabel: string;
  emptyLabel: string;
  series: ChartSeries[];
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  baselineAtZero: boolean;
}

interface LeafletState {
  map: import("leaflet").Map;
  tileLayer: import("leaflet").TileLayer;
  routeLayers: import("leaflet").Polyline[];
  activityMarkers: Array<import("leaflet").CircleMarker>;
}

let leafletState: LeafletState | null = null;
let gpxDownloadUrls: string[] = [];

export async function setupTripTracker(payload: TrackerPayload): Promise<void> {
  const { tripData, routesByDate } = payload;
  const sortedDays = sortDays(tripData.days ?? []);

  if (sortedDays.length === 0) {
    return;
  }

  const todayIso = getLocalIsoDate();
  const selection = selectCurrentDay(sortedDays, todayIso);
  const selectedDay = selection.day;
  const allActivityEntries = sortedDays.flatMap((day) =>
    getDayActivities(day).map((activity) => ({
      dayDate: day.date,
      dayTitle: day.title || "Trip day",
      activity,
      routeData: routesByDate[day.date]?.[activity.id],
    })),
  );

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
  updateDayLiveLink(getPrimaryGarminUrl(selectedDay));

  revokeGpxUrls();
  renderActivityList(allActivityEntries);

  const placeholder = getElement<HTMLDivElement>("live-placeholder");
  const mapShell = getElement<HTMLDivElement>("live-map-shell");
  const mapElement = getElement<HTMLDivElement>("live-map");

  if (placeholder && mapShell && mapElement) {
    await renderSelectedRouteMap({
      activityEntries: allActivityEntries,
      placeholder,
      mapShell,
      mapElement,
    });
  }
}

async function renderSelectedRouteMap(options: {
  activityEntries: ActivityEntry[];
  placeholder: HTMLDivElement;
  mapShell: HTMLDivElement;
  mapElement: HTMLDivElement;
}): Promise<void> {
  const { activityEntries, placeholder, mapShell, mapElement } = options;

  hideMapStats();
  hideGraphs();
  mapShell.classList.add("hidden");
  placeholder.classList.remove("hidden");

  const successfulRoutes = activityEntries.filter(
    (entry): entry is ActivityRouteEntry => entry.routeData?.status === "ok" && entry.routeData.points.length > 0,
  );

  if (successfulRoutes.length === 0) {
    placeholder.innerHTML = buildPlaceholderCopy(activityEntries);
    return;
  }

  const Leaflet = await import("leaflet");
  const map = ensureLeafletMap(Leaflet, mapElement);
  clearMapLayers();

  const bounds = Leaflet.latLngBounds([]);

  for (const entry of successfulRoutes) {
    const latLngs = entry.routeData.points.map((point) => [point.lat, point.lon] as [number, number]);
    const routeLayer = Leaflet.polyline(latLngs, {
      color: entry.activity.color,
      weight: 4,
      opacity: 0.9,
    }).addTo(map);
    leafletState!.routeLayers.push(routeLayer);
    bounds.extend(routeLayer.getBounds());

    const latestPoint = latLngs.at(-1);
    if (latestPoint) {
      const marker = Leaflet.circleMarker(latestPoint, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: entry.activity.color,
        fillOpacity: 1,
      }).addTo(map);
      leafletState!.activityMarkers.push(marker);
    }
  }

  if (successfulRoutes.every((entry) => entry.routeData.points.length === 1)) {
    const firstPoint = successfulRoutes[0].routeData.points[0];
    map.setView([firstPoint.lat, firstPoint.lon], 11);
  } else {
    map.fitBounds(bounds, {
      padding: [72, 72],
      maxZoom: 13,
    });
  }

  mapShell.classList.remove("hidden");
  placeholder.classList.add("hidden");
  updateMapStats(successfulRoutes);
  renderGraphs(successfulRoutes);

  requestAnimationFrame(() => {
    map.invalidateSize();
  });
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
      routeLayers: [],
      activityMarkers: [],
    };
  }

  return leafletState.map;
}

function clearMapLayers(): void {
  if (!leafletState) {
    return;
  }

  leafletState.routeLayers.forEach((layer) => layer.remove());
  leafletState.activityMarkers.forEach((marker) => marker.remove());
  leafletState.routeLayers = [];
  leafletState.activityMarkers = [];
}

function renderActivityList(activityEntries: ActivityEntry[]): void {
  const activityList = getElement<HTMLDivElement>("activity-list");
  if (!activityList) {
    return;
  }

  if (activityEntries.length === 0) {
    activityList.classList.add("hidden");
    activityList.innerHTML = "";
    return;
  }

  activityList.classList.remove("hidden");
  activityList.innerHTML = activityEntries
    .map((entry) => {
      const garminUrl = entry.activity.livetrackUrl;
      const routeData = entry.routeData;
      const gpxHref =
        routeData?.status === "ok"
          ? buildGpxDownloadUrl(routeData.points, `${entry.dayTitle} - ${entry.activity.title}`)
          : null;

      return `
        <article class="activity-card">
          <div class="activity-card__header">
            <div class="activity-title-row">
              <span class="activity-swatch" style="background:${escapeHtml(entry.activity.color)}"></span>
              <div>
                <h3>${escapeHtml(entry.activity.title)}</h3>
                <p class="activity-day">${escapeHtml(entry.dayTitle)} · ${escapeHtml(formatLongDate(entry.dayDate))}</p>
                <p class="activity-status">${escapeHtml(getActivityStatusLabel(routeData, garminUrl))}</p>
              </div>
            </div>
          </div>
          ${entry.activity.notes ? `<p class="activity-notes">${escapeHtml(entry.activity.notes)}</p>` : ""}
          ${routeData?.status === "ok" ? renderActivityMetrics(routeData) : ""}
          <div class="activity-actions">
            ${
              gpxHref
                ? `<a class="button-link button-link-secondary" href="${gpxHref}" download="${slugify(entry.dayTitle)}-${slugify(entry.activity.title)}.gpx">Download GPX</a>`
                : ""
            }
            ${
              garminUrl
                ? `<a class="button-link" href="${escapeHtml(garminUrl)}" target="_blank" rel="noreferrer">Open in Garmin</a>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderActivityMetrics(routeData: GarminRouteOk): string {
  return `
    <div class="activity-metrics">
      <span>${escapeHtml(formatDistance(routeData.summary.totalDistanceMeters))}</span>
      <span>${escapeHtml(formatDuration(routeData.summary.totalDurationSecs))}</span>
      <span>${escapeHtml(String(routeData.summary.pointCount))} pts</span>
      ${routeData.summary.isActive ? '<span class="activity-live-pill">Live</span>' : ""}
    </div>
  `;
}

function updateDayLiveLink(url: string | null): void {
  const liveLink = getElement<HTMLAnchorElement>("day-live-link");
  if (!liveLink) {
    return;
  }

  if (url) {
    liveLink.href = url;
    liveLink.classList.remove("hidden");
    return;
  }

  liveLink.removeAttribute("href");
  liveLink.classList.add("hidden");
}

function updateMapStats(successfulRoutes: ActivityRouteEntry[]): void {
  const totalDistanceMeters = successfulRoutes.reduce(
    (sum, entry) => sum + (entry.routeData.summary.totalDistanceMeters ?? 0),
    0,
  );
  const totalDurationSecs = successfulRoutes.reduce(
    (sum, entry) => sum + (entry.routeData.summary.totalDurationSecs ?? 0),
    0,
  );
  const pointCount = successfulRoutes.reduce((sum, entry) => sum + entry.routeData.summary.pointCount, 0);
  const lastUpdated = successfulRoutes
    .map((entry) => entry.routeData.summary.lastReportedTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  setText("stat-distance", formatDistance(totalDistanceMeters));
  setText("stat-duration", formatDuration(totalDurationSecs));
  setText("stat-updated", formatDateTime(lastUpdated));
  setText("stat-points", String(pointCount));

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

function renderGraphs(successfulRoutes: ActivityRouteEntry[]): void {
  const graphs = getElement<HTMLDivElement>("route-graphs");
  const graphGrid = getElement<HTMLDivElement>("graph-grid");
  const graphsContext = getElement<HTMLParagraphElement>("graphs-context");
  const livePill = getElement<HTMLSpanElement>("graphs-live-pill");

  if (!graphs || !graphGrid || !graphsContext || !livePill) {
    return;
  }

  const activeRoutes = successfulRoutes.filter((entry) => entry.routeData.summary.isActive);
  const graphCards: GraphCardDefinition[] = [
    {
      title: "Elevation profile",
      axisLabel: "Meters vs distance",
      emptyLabel: "Elevation data is not available for these activities yet.",
      series: buildMetricSeries(successfulRoutes, (point) =>
        typeof point.distanceMeters === "number" && typeof point.elevation === "number"
          ? { x: point.distanceMeters, y: point.elevation }
          : null,
      ),
      xFormatter: (value) => formatDistance(value),
      yFormatter: (value) => `${Math.round(value)} m`,
      baselineAtZero: false,
    },
    {
      title: "Speed profile",
      axisLabel: "km/h vs elapsed time",
      emptyLabel: "Speed data is not available for these activities yet.",
      series: buildMetricSeries(successfulRoutes, (point, previousPoint) => {
        if (typeof point.durationSecs !== "number") {
          return null;
        }

        if (typeof point.speedMetersPerSec === "number") {
          return {
            x: point.durationSecs,
            y: point.speedMetersPerSec * 3.6,
          };
        }

        const derivedSpeed = deriveSpeedPoint(point, previousPoint);
        return typeof derivedSpeed === "number"
          ? {
              x: point.durationSecs,
              y: derivedSpeed,
            }
          : null;
      }),
      xFormatter: (value) => formatDuration(value),
      yFormatter: (value) => `${Math.round(value)} km/h`,
      baselineAtZero: true,
    },
  ];

  if (activeRoutes.length > 0) {
    graphCards.push(
      {
        title: "Heart rate",
        axisLabel: "BPM vs elapsed time",
        emptyLabel: "Heart-rate data is not available from the active Garmin session yet.",
        series: buildMetricSeries(activeRoutes, (point) =>
          typeof point.durationSecs === "number" && typeof point.heartRateBeatsPerMin === "number"
            ? { x: point.durationSecs, y: point.heartRateBeatsPerMin }
            : null,
        ),
        xFormatter: (value) => formatDuration(value),
        yFormatter: (value) => `${Math.round(value)} bpm`,
        baselineAtZero: false,
      },
      {
        title: "Power",
        axisLabel: "Watts vs elapsed time",
        emptyLabel: "Power data is not available from the active Garmin session yet.",
        series: buildMetricSeries(
          activeRoutes,
          (point) =>
            typeof point.durationSecs === "number" && typeof point.powerWatts === "number"
              ? { x: point.durationSecs, y: point.powerWatts }
              : null,
          { requirePositiveValue: true },
        ),
        xFormatter: (value) => formatDuration(value),
        yFormatter: (value) => `${Math.round(value)} W`,
        baselineAtZero: true,
      },
      {
        title: "Cadence",
        axisLabel: "RPM vs elapsed time",
        emptyLabel: "Cadence data is not available from the active Garmin session yet.",
        series: buildMetricSeries(
          activeRoutes,
          (point) =>
            typeof point.durationSecs === "number" && typeof point.cadenceCyclesPerMin === "number"
              ? { x: point.durationSecs, y: point.cadenceCyclesPerMin }
              : null,
          { requirePositiveValue: true },
        ),
        xFormatter: (value) => formatDuration(value),
        yFormatter: (value) => `${Math.round(value)} rpm`,
        baselineAtZero: true,
      },
    );
  }

  graphGrid.innerHTML = graphCards
    .map((graph) => {
      const body =
        graph.series.length > 0
          ? buildLineChartSvg({
              title: graph.title,
              series: graph.series,
              xFormatter: graph.xFormatter,
              yFormatter: graph.yFormatter,
              baselineAtZero: graph.baselineAtZero,
            })
          : `<p class="graph-empty">${escapeHtml(graph.emptyLabel)}</p>`;

      return `
        <article class="graph-card">
          <div class="graph-card-header">
            <h4>${escapeHtml(graph.title)}</h4>
            <span class="graph-axis-label">${escapeHtml(graph.axisLabel)}</span>
          </div>
          <div class="graph-canvas">${body}</div>
        </article>
      `;
    })
    .join("");

  if (activeRoutes.length > 0) {
    graphsContext.textContent = "Live Garmin metrics are available for active activities and refresh whenever the site updates.";
    graphsContext.classList.remove("hidden");
    livePill.classList.remove("hidden");
  } else {
    graphsContext.textContent = "These charts use the latest extracted Garmin samples across all trip activities.";
    graphsContext.classList.remove("hidden");
    livePill.classList.add("hidden");
  }

  graphs.classList.remove("hidden");
}

function hideGraphs(): void {
  const graphs = getElement<HTMLDivElement>("route-graphs");
  const graphGrid = getElement<HTMLDivElement>("graph-grid");
  const graphsContext = getElement<HTMLParagraphElement>("graphs-context");
  const livePill = getElement<HTMLSpanElement>("graphs-live-pill");

  if (graphs) {
    graphs.classList.add("hidden");
  }

  if (graphGrid) {
    graphGrid.innerHTML = "";
  }

  if (graphsContext) {
    graphsContext.textContent = "";
    graphsContext.classList.add("hidden");
  }

  if (livePill) {
    livePill.classList.add("hidden");
  }
}

function buildMetricSeries(
  routes: ActivityRouteEntry[],
  selectPoint: (point: GarminTrackPoint, previousPoint?: GarminTrackPoint) => ChartSeriesPoint | null,
  options?: {
    requirePositiveValue?: boolean;
  },
): ChartSeries[] {
  return routes
    .map((entry) => {
      const points = entry.routeData.points
        .map((point, index, allPoints) => selectPoint(point, index > 0 ? allPoints[index - 1] : undefined))
        .filter((point): point is ChartSeriesPoint => point !== null && Number.isFinite(point.x) && Number.isFinite(point.y));

      if (points.length < 2) {
        return null;
      }

      if (options?.requirePositiveValue && !points.some((point) => point.y > 0)) {
        return null;
      }

      return {
        color: entry.activity.color,
        label: entry.activity.title,
        points,
      };
    })
    .filter((series): series is ChartSeries => series !== null);
}

function deriveSpeedPoint(point: GarminTrackPoint, previousPoint?: GarminTrackPoint): number | null {
  if (
    !previousPoint ||
    typeof previousPoint.distanceMeters !== "number" ||
    typeof point.distanceMeters !== "number" ||
    typeof previousPoint.durationSecs !== "number" ||
    typeof point.durationSecs !== "number"
  ) {
    return null;
  }

  const deltaDistance = point.distanceMeters - previousPoint.distanceMeters;
  const deltaTime = point.durationSecs - previousPoint.durationSecs;

  if (deltaDistance <= 0 || deltaTime <= 0) {
    return null;
  }

  return (deltaDistance / deltaTime) * 3.6;
}

function buildLineChartSvg(options: {
  title: string;
  series: ChartSeries[];
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  baselineAtZero: boolean;
}): string {
  const { title, series, xFormatter, yFormatter, baselineAtZero } = options;
  const width = 680;
  const height = 240;
  const padding = {
    top: 16,
    right: 16,
    bottom: 34,
    left: 48,
  };

  const allX = series.flatMap((entry) => entry.points.map((point) => point.x));
  const allY = series.flatMap((entry) => entry.points.map((point) => point.y));
  const xMin = 0;
  const xMax = Math.max(...allX, 1);
  const rawYMin = Math.min(...allY, 0);
  const rawYMax = Math.max(...allY, 1);
  const equalRangePadding = rawYMax === rawYMin ? Math.max(Math.abs(rawYMax) * 0.05, 1) : 0;
  const yMin = baselineAtZero ? 0 : rawYMin - equalRangePadding;
  const yMax = rawYMax + equalRangePadding;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const yRange = Math.max(yMax - yMin, 1);

  const scaleX = (value: number) => padding.left + (value / xMax) * chartWidth;
  const scaleY = (value: number) => padding.top + chartHeight - ((value - yMin) / yRange) * chartHeight;

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const value = yMin + (yRange / 3) * index;
    const y = scaleY(value);
    return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="graph-grid-line" />`;
  }).join("");

  const paths = series
    .map((entry) => {
      const path = entry.points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${scaleX(point.x).toFixed(2)} ${scaleY(point.y).toFixed(2)}`)
        .join(" ");

      return `<path d="${path}" fill="none" stroke="${escapeHtml(entry.color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");

  const legend = series
    .map(
      (entry, index) => `
        <g transform="translate(${padding.left + index * 170}, ${height - 6})">
          <line x1="0" y1="-4" x2="16" y2="-4" stroke="${escapeHtml(entry.color)}" stroke-width="3" />
          <text x="22" y="0" class="graph-legend-text">${escapeHtml(entry.label)}</text>
        </g>
      `,
    )
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="graph-svg" role="img" aria-label="${escapeHtml(title)} graph">
      <g>
        ${gridLines}
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="graph-axis" />
        <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="graph-axis" />
        ${paths}
        <text x="${padding.left}" y="${padding.top - 2}" class="graph-label">${escapeHtml(yFormatter(yMax))}</text>
        <text x="${padding.left}" y="${height - padding.bottom + 26}" class="graph-label">${escapeHtml(xFormatter(xMin))}</text>
        <text x="${width - padding.right}" y="${height - padding.bottom + 26}" text-anchor="end" class="graph-label">${escapeHtml(xFormatter(xMax))}</text>
        <text x="${padding.left}" y="${height - padding.bottom + 26}" dy="-16" class="graph-label">${escapeHtml(yFormatter(yMin))}</text>
        ${legend}
      </g>
    </svg>
  `;
}

function buildPlaceholderCopy(activityEntries: ActivityEntry[]): string {
  if (activityEntries.length === 0 || activityEntries.every((entry) => !entry.activity.livetrackUrl)) {
    return "Add Garmin LiveTrack URLs in <code>src/data/trip.ts</code> once the ride has started, and this page will switch from the placeholder to the combined trip map automatically.";
  }

  if (activityEntries.some((entry) => entry.routeData?.status === "empty")) {
    return "One or more Garmin sessions exist, but they have not published any track points yet. Check back after the ride has started moving.";
  }

  return "The last build could not extract route data from Garmin, so use the Garmin links in the activity list as a fallback for now.";
}

function getActivityStatusLabel(routeData: GarminRouteData | undefined, livetrackUrl?: string | null): string {
  if (!livetrackUrl) {
    return "No Garmin session URL yet.";
  }

  if (!routeData) {
    return "Waiting for the next site refresh.";
  }

  if (routeData.status === "ok") {
    return routeData.summary.isActive
      ? `Live now · ${formatDistance(routeData.summary.totalDistanceMeters)} · ${formatDuration(routeData.summary.totalDurationSecs)}`
      : `${formatDistance(routeData.summary.totalDistanceMeters)} · ${formatDuration(routeData.summary.totalDurationSecs)}`;
  }

  if (routeData.status === "empty") {
    return "Session exists but no route points are available yet.";
  }

  return "Route extraction failed; Garmin fallback is still available.";
}

function buildGpxDownloadUrl(points: GarminTrackPoint[], title: string): string {
  const gpx = buildGpxDocument(points, title);
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  gpxDownloadUrls.push(url);
  return url;
}

function revokeGpxUrls(): void {
  gpxDownloadUrls.forEach((url) => URL.revokeObjectURL(url));
  gpxDownloadUrls = [];
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
  if (typeof distanceMeters !== "number" || Number.isNaN(distanceMeters)) {
    return "-";
  }

  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSecs?: number): string {
  if (typeof durationSecs !== "number" || Number.isNaN(durationSecs)) {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
