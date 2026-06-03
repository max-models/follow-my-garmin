import type { GarminRouteData, GarminRouteOk, GarminTrackPoint } from "../lib/garmin";

interface TrackerActivity {
  livetrackUrl: string | null;
  notes: string | null;
  routeData: GarminRouteData | null;
}

interface TrackerCollection {
  name: string;
  color: string;
  activities: TrackerActivity[];
}

interface TrackerPayload {
  collections: TrackerCollection[];
}

interface RouteEntry {
  collectionIndex: number;
  collectionName: string;
  color: string;
  activityIndex: number;
  livetrackUrl: string | null;
  notes: string | null;
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

interface LeafletState {
  map: import("leaflet").Map;
  tileLayer: import("leaflet").TileLayer;
  collectionGroups: Map<number, import("leaflet").FeatureGroup>;
}

let leafletState: LeafletState | null = null;
let gpxDownloadUrls: string[] = [];
let visibleCollections: Set<number> = new Set();
let allRouteEntries: RouteEntry[] = [];

export async function setupTripTracker(payload: TrackerPayload): Promise<void> {
  const { collections } = payload;

  allRouteEntries = collections.flatMap((col, ci) =>
    col.activities
      .map((activity, ai) => ({ col, ci, ai, activity }))
      .filter(
        ({ activity }): activity is typeof activity & { routeData: GarminRouteOk } =>
          activity.routeData?.status === "ok" && activity.routeData.points.length > 0,
      )
      .map(({ col, ci, ai, activity }) => ({
        collectionIndex: ci,
        collectionName: col.name,
        color: col.color,
        activityIndex: ai,
        livetrackUrl: activity.livetrackUrl,
        notes: activity.notes,
        routeData: activity.routeData as GarminRouteOk,
      })),
  );

  visibleCollections = new Set(collections.map((_, i) => i));

  const mapShell = getElement<HTMLDivElement>("map-shell");
  const placeholder = getElement<HTMLDivElement>("map-placeholder");
  const mapElement = getElement<HTMLDivElement>("main-map");

  if (mapShell && placeholder && mapElement) {
    await renderMap({ mapShell, placeholder, mapElement, collections });
  }

  renderCollectionControls(collections);
  renderActivityList(collections);
  revokeGpxUrls();
}

async function renderMap(options: {
  mapShell: HTMLDivElement;
  placeholder: HTMLDivElement;
  mapElement: HTMLDivElement;
  collections: TrackerCollection[];
}): Promise<void> {
  const { mapShell, placeholder, mapElement, collections } = options;

  mapShell.classList.add("hidden");
  placeholder.classList.remove("hidden");
  hideMapStats();
  hideGraphs();

  const allVisible = getVisibleRouteEntries();

  if (allVisible.length === 0) {
    placeholder.innerHTML = buildPlaceholderCopy(collections);
    return;
  }

  const Leaflet = await import("leaflet");

  if (!leafletState) {
    const map = Leaflet.map(mapElement, {
      zoomControl: true,
      scrollWheelZoom: true,
    });

    Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const collectionGroups = new Map<number, import("leaflet").FeatureGroup>();

    leafletState = {
      map,
      tileLayer: Leaflet.tileLayer(""),
      collectionGroups,
    };
  }

  // rebuild collection groups
  leafletState.collectionGroups.forEach((group) => group.remove());
  leafletState.collectionGroups.clear();

  const bounds = Leaflet.latLngBounds([]);

  for (const entry of allRouteEntries) {
    let group = leafletState.collectionGroups.get(entry.collectionIndex);
    if (!group) {
      group = Leaflet.featureGroup().addTo(leafletState.map);
      leafletState.collectionGroups.set(entry.collectionIndex, group);
    }

    const latLngs = entry.routeData.points.map((p) => [p.lat, p.lon] as [number, number]);
    Leaflet.polyline(latLngs, { color: entry.color, weight: 4, opacity: 0.9 }).addTo(group);

    const lastLatLng = latLngs.at(-1);
    if (lastLatLng) {
      Leaflet.circleMarker(lastLatLng, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: entry.color,
        fillOpacity: 1,
      }).addTo(group);
    }

    if (visibleCollections.has(entry.collectionIndex)) {
      bounds.extend(Leaflet.polyline(latLngs).getBounds());
    }
  }

  // hide collections that are toggled off
  leafletState.collectionGroups.forEach((group, ci) => {
    if (!visibleCollections.has(ci)) {
      group.remove();
    }
  });

  if (allVisible.every((e) => e.routeData.points.length === 1)) {
    const firstPoint = allVisible[0].routeData.points[0];
    leafletState.map.setView([firstPoint.lat, firstPoint.lon], 11);
  } else if (bounds.isValid()) {
    leafletState.map.fitBounds(bounds, { padding: [72, 72], maxZoom: 13 });
  }

  mapShell.classList.remove("hidden");
  placeholder.classList.add("hidden");

  updateMapStats(allVisible);
  renderGraphs(allVisible);

  requestAnimationFrame(() => {
    leafletState?.map.invalidateSize();
  });
}

function getVisibleRouteEntries(): RouteEntry[] {
  return allRouteEntries.filter((e) => visibleCollections.has(e.collectionIndex));
}

function toggleCollection(collectionIndex: number): void {
  if (!leafletState) {
    return;
  }

  if (visibleCollections.has(collectionIndex)) {
    visibleCollections.delete(collectionIndex);
    leafletState.collectionGroups.get(collectionIndex)?.remove();
  } else {
    visibleCollections.add(collectionIndex);
    const group = leafletState.collectionGroups.get(collectionIndex);
    if (group) {
      group.addTo(leafletState.map);
    }
  }

  const visible = getVisibleRouteEntries();
  updateMapStats(visible);
  renderGraphs(visible);
  updateCollectionButtonStates();
}

function updateCollectionButtonStates(): void {
  const controls = getElement<HTMLDivElement>("collection-controls");
  if (!controls) {
    return;
  }

  controls.querySelectorAll<HTMLButtonElement>("[data-collection-index]").forEach((btn) => {
    const ci = Number(btn.dataset.collectionIndex);
    btn.classList.toggle("collection-btn--off", !visibleCollections.has(ci));
  });
}

function renderCollectionControls(collections: TrackerCollection[]): void {
  const controls = getElement<HTMLDivElement>("collection-controls");
  if (!controls) {
    return;
  }

  const collectionsWithRoutes = collections.filter((col, ci) =>
    allRouteEntries.some((e) => e.collectionIndex === ci),
  );

  if (collectionsWithRoutes.length < 2) {
    controls.classList.add("hidden");
    return;
  }

  controls.classList.remove("hidden");
  controls.innerHTML = collectionsWithRoutes
    .map((col, _unused, filteredCols) => {
      const ci = collections.indexOf(col);
      return `<button
        class="collection-btn"
        data-collection-index="${ci}"
        style="--col-color:${escapeHtml(col.color)}"
        aria-pressed="true"
      >${escapeHtml(col.name)}</button>`;
    })
    .join("");

  controls.querySelectorAll<HTMLButtonElement>("[data-collection-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ci = Number(btn.dataset.collectionIndex);
      toggleCollection(ci);
    });
  });
}

function updateMapStats(routes: RouteEntry[]): void {
  const totalDistanceMeters = routes.reduce(
    (sum, e) => sum + (e.routeData.summary.totalDistanceMeters ?? 0),
    0,
  );
  const totalDurationSecs = routes.reduce(
    (sum, e) => sum + (e.routeData.summary.totalDurationSecs ?? 0),
    0,
  );
  const pointCount = routes.reduce((sum, e) => sum + e.routeData.summary.pointCount, 0);
  const lastUpdated = routes
    .map((e) => e.routeData.summary.lastReportedTime)
    .filter((v): v is string => Boolean(v))
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

function renderGraphs(routes: RouteEntry[]): void {
  const graphs = getElement<HTMLElement>("route-graphs");
  const graphGrid = getElement<HTMLDivElement>("graph-grid");

  if (!graphs || !graphGrid) {
    return;
  }

  if (routes.length === 0) {
    graphs.classList.add("hidden");
    graphGrid.innerHTML = "";
    return;
  }

  const elevationSeries = buildCombinedSeries(routes, (point) =>
    typeof point.distanceMeters === "number" && typeof point.elevation === "number"
      ? { x: point.distanceMeters, y: point.elevation }
      : null,
  );

  const speedSeries = buildCombinedSeries(routes, (point, prev) => {
    if (typeof point.durationSecs !== "number") {
      return null;
    }
    if (typeof point.speedMetersPerSec === "number") {
      return { x: point.durationSecs, y: point.speedMetersPerSec * 3.6 };
    }
    const derived = deriveSpeedKmh(point, prev);
    return typeof derived === "number" ? { x: point.durationSecs, y: derived } : null;
  });

  const cards: Array<{ title: string; xLabel: string; yLabel: string; series: ChartSeries[]; baselineAtZero: boolean; xFormatter: (v: number) => string; yFormatter: (v: number) => string }> = [];

  if (elevationSeries.length > 0) {
    cards.push({
      title: "Elevation",
      xLabel: "Distance",
      yLabel: "Metres",
      series: elevationSeries,
      baselineAtZero: false,
      xFormatter: formatDistance,
      yFormatter: (v) => `${Math.round(v)} m`,
    });
  }

  if (speedSeries.length > 0) {
    cards.push({
      title: "Speed",
      xLabel: "Elapsed time",
      yLabel: "km/h",
      series: speedSeries,
      baselineAtZero: true,
      xFormatter: formatDuration,
      yFormatter: (v) => `${Math.round(v)} km/h`,
    });
  }

  if (cards.length === 0) {
    graphs.classList.add("hidden");
    graphGrid.innerHTML = "";
    return;
  }

  graphGrid.innerHTML = cards
    .map(
      (card) => `
      <article class="graph-card">
        <div class="graph-card-header">
          <h3>${escapeHtml(card.title)}</h3>
          <span class="graph-axis-label">${escapeHtml(card.xLabel)} → ${escapeHtml(card.yLabel)}</span>
        </div>
        <div class="graph-canvas">${buildLineChartSvg({ series: card.series, xFormatter: card.xFormatter, yFormatter: card.yFormatter, baselineAtZero: card.baselineAtZero })}</div>
      </article>`,
    )
    .join("");

  graphs.classList.remove("hidden");
}

function hideGraphs(): void {
  const graphs = getElement<HTMLElement>("route-graphs");
  const graphGrid = getElement<HTMLDivElement>("graph-grid");
  if (graphs) {
    graphs.classList.add("hidden");
  }
  if (graphGrid) {
    graphGrid.innerHTML = "";
  }
}

/**
 * Build one ChartSeries per activity with a continuous x-axis across all activities.
 * Each activity's x values are offset by the cumulative maximum x of all prior activities.
 */
function buildCombinedSeries(
  routes: RouteEntry[],
  selectPoint: (point: GarminTrackPoint, prev?: GarminTrackPoint) => ChartSeriesPoint | null,
): ChartSeries[] {
  const result: ChartSeries[] = [];
  let xOffset = 0;

  for (const entry of routes) {
    const rawPoints = entry.routeData.points
      .map((point, index, all) => selectPoint(point, index > 0 ? all[index - 1] : undefined))
      .filter((p): p is ChartSeriesPoint => p !== null && Number.isFinite(p.x) && Number.isFinite(p.y));

    if (rawPoints.length < 2) {
      continue;
    }

    const xMax = rawPoints.at(-1)!.x;
    const offsetPoints = rawPoints.map((p) => ({ x: p.x + xOffset, y: p.y }));

    result.push({
      color: entry.color,
      label: entry.collectionName,
      points: offsetPoints,
    });

    xOffset += xMax;
  }

  return result;
}

function deriveSpeedKmh(point: GarminTrackPoint, prev?: GarminTrackPoint): number | null {
  if (
    !prev ||
    typeof prev.distanceMeters !== "number" ||
    typeof point.distanceMeters !== "number" ||
    typeof prev.durationSecs !== "number" ||
    typeof point.durationSecs !== "number"
  ) {
    return null;
  }

  const dDist = point.distanceMeters - prev.distanceMeters;
  const dTime = point.durationSecs - prev.durationSecs;

  if (dDist <= 0 || dTime <= 0) {
    return null;
  }

  return (dDist / dTime) * 3.6;
}

function buildLineChartSvg(options: {
  series: ChartSeries[];
  xFormatter: (value: number) => string;
  yFormatter: (value: number) => string;
  baselineAtZero: boolean;
}): string {
  const { series, xFormatter, yFormatter, baselineAtZero } = options;
  const width = 680;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 34, left: 48 };

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = 0;
  const xMax = Math.max(...allX, 1);
  const rawYMin = Math.min(...allY, 0);
  const rawYMax = Math.max(...allY, 1);
  const equalPad = rawYMax === rawYMin ? Math.max(Math.abs(rawYMax) * 0.05, 1) : 0;
  const yMin = baselineAtZero ? 0 : rawYMin - equalPad;
  const yMax = rawYMax + equalPad;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const yRange = Math.max(yMax - yMin, 1);

  const scaleX = (v: number) => padding.left + (v / xMax) * chartWidth;
  const scaleY = (v: number) => padding.top + chartHeight - ((v - yMin) / yRange) * chartHeight;

  const gridLines = Array.from({ length: 4 }, (_, i) => {
    const v = yMin + (yRange / 3) * i;
    const y = scaleY(v);
    return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="graph-grid-line" />`;
  }).join("");

  const paths = series
    .map((s) => {
      const d = s.points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(2)} ${scaleY(p.y).toFixed(2)}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${escapeHtml(s.color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");

  const uniqueLabels = [...new Map(series.map((s) => [s.label, s])).values()];
  const legend = uniqueLabels
    .map(
      (s, i) => `
      <g transform="translate(${padding.left + i * 170}, ${height - 6})">
        <line x1="0" y1="-4" x2="16" y2="-4" stroke="${escapeHtml(s.color)}" stroke-width="3" />
        <text x="22" y="0" class="graph-legend-text">${escapeHtml(s.label)}</text>
      </g>`,
    )
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="graph-svg" role="img">
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
    </svg>`;
}

function renderActivityList(collections: TrackerCollection[]): void {
  const activityList = getElement<HTMLDivElement>("activity-list");
  if (!activityList) {
    return;
  }

  const cards = collections
    .flatMap((col, ci) =>
      col.activities.map((activity, ai) => {
        const entry = allRouteEntries.find((e) => e.collectionIndex === ci && e.activityIndex === ai);
        const gpxHref = entry ? buildGpxDownloadUrl(entry.routeData.points, `${col.name} #${ai + 1}`) : null;

        const statusText = getActivityStatusLabel(activity.routeData, activity.livetrackUrl);
        const metrics = entry ? renderActivityMetrics(entry.routeData) : "";
        const notes = activity.notes ? `<p class="activity-notes">${escapeHtml(activity.notes)}</p>` : "";
        const garminLink = activity.livetrackUrl
          ? `<a class="button-link" href="${escapeHtml(activity.livetrackUrl)}" target="_blank" rel="noreferrer">Open in Garmin</a>`
          : "";
        const gpxLink = gpxHref
          ? `<a class="button-link button-link-secondary" href="${gpxHref}" download="${slugify(col.name)}-${ai + 1}.gpx">Download GPX</a>`
          : "";

        return `
          <article class="activity-card">
            <div class="activity-card__header">
              <span class="activity-swatch" style="background:${escapeHtml(col.color)}"></span>
              <div>
                <p class="activity-collection">${escapeHtml(col.name)}</p>
                <p class="activity-status">${escapeHtml(statusText)}</p>
              </div>
            </div>
            ${notes}
            ${metrics}
            <div class="activity-actions">${gpxLink}${garminLink}</div>
          </article>`;
      }),
    )
    .join("");

  if (!cards) {
    activityList.classList.add("hidden");
    return;
  }

  activityList.innerHTML = cards;
  activityList.classList.remove("hidden");
}

function renderActivityMetrics(routeData: GarminRouteOk): string {
  return `
    <div class="activity-metrics">
      <span>${escapeHtml(formatDistance(routeData.summary.totalDistanceMeters))}</span>
      <span>${escapeHtml(formatDuration(routeData.summary.totalDurationSecs))}</span>
      <span>${escapeHtml(String(routeData.summary.pointCount))} pts</span>
      ${routeData.summary.isActive ? '<span class="activity-live-pill">Live</span>' : ""}
    </div>`;
}

function getActivityStatusLabel(routeData: GarminRouteData | null, livetrackUrl: string | null): string {
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

function buildPlaceholderCopy(collections: TrackerCollection[]): string {
  const anyUrl = collections.some((col) => col.activities.some((a) => a.livetrackUrl));

  if (!anyUrl) {
    return "Add Garmin LiveTrack URLs in <code>collections.yaml</code> once the ride has started.";
  }

  return "The last build could not extract route data from Garmin. Use the Garmin links in the activity list as a fallback.";
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

function buildGpxDocument(points: GarminTrackPoint[], title: string): string {
  const trkpts = points
    .map((p) => {
      const ele = typeof p.elevation === "number" ? `<ele>${p.elevation.toFixed(2)}</ele>` : "";
      const time = p.time ? `<time>${escapeXml(p.time)}</time>` : "";
      return `<trkpt lat="${p.lat}" lon="${p.lon}">${ele}${time}</trkpt>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="follow-my-garmin" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(title)}</name>
    <trkseg>${trkpts}</trkseg>
  </trk>
</gpx>`;
}

function formatDistance(distanceMeters?: number): string {
  if (typeof distanceMeters !== "number" || Number.isNaN(distanceMeters)) {
    return "-";
  }
  return distanceMeters >= 1000 ? `${(distanceMeters / 1000).toFixed(1)} km` : `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSecs?: number): string {
  if (typeof durationSecs !== "number" || Number.isNaN(durationSecs)) {
    return "-";
  }
  const hours = Math.floor(durationSecs / 3600);
  const minutes = Math.floor((durationSecs % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  const el = getElement<HTMLElement>(id);
  if (el) {
    el.textContent = value;
  }
}

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
