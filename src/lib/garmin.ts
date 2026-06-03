import type { Collection } from "../data/trip";

interface GarminHydratedQuery {
  queryKey?: unknown[];
  state?: {
    data?: unknown;
  };
}

interface GarminSessionData {
  sessionName?: string;
  start?: string;
  end?: string;
  postTrackPointFrequency?: number;
}

interface GarminTrackPointSource {
  dateTime?: string;
  reportedTime?: string;
  altitude?: number;
  speed?: number;
  speedMetersPerSec?: number;
  heartRateBeatsPerMin?: number;
  cadenceCyclesPerMin?: number;
  powerWatts?: number;
  totalDurationSecs?: number;
  durationSecs?: number;
  totalDistanceMeters?: number;
  distanceMeters?: number;
  position?: {
    lat?: number;
    lon?: number;
  };
}

export interface GarminTrackPoint {
  lat: number;
  lon: number;
  elevation?: number;
  speedMetersPerSec?: number;
  heartRateBeatsPerMin?: number;
  cadenceCyclesPerMin?: number;
  powerWatts?: number;
  time?: string;
  reportedTime?: string;
  distanceMeters?: number;
  durationSecs?: number;
}

export interface GarminRouteSummary {
  pointCount: number;
  totalDistanceMeters?: number;
  totalDurationSecs?: number;
  minimumAltitudeMeters?: number;
  maximumAltitudeMeters?: number;
  lastReportedTime?: string;
  sessionStartTime?: string;
  sessionEndTime?: string;
  postTrackPointFrequencySecs?: number;
  isActive: boolean;
}

interface GarminRouteBase {
  sourceUrl: string;
  extractedAt: string;
}

export interface GarminRouteOk extends GarminRouteBase {
  status: "ok";
  sessionName?: string;
  points: GarminTrackPoint[];
  summary: GarminRouteSummary;
}

export interface GarminRouteEmpty extends GarminRouteBase {
  status: "empty";
}

export interface GarminRouteError extends GarminRouteBase {
  status: "fetch_error" | "parse_error";
  errorDetail: string;
}

export type GarminRouteData = GarminRouteOk | GarminRouteEmpty | GarminRouteError;

// routeData[collectionIndex][activityIndex]
export type GarminRouteDataByCollection = Record<number, Record<number, GarminRouteData>>;

const GARMIN_HOSTS = ["livetrack.garmin.com", "connect.garmin.com"];
const hydrationPattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/gs;

export function normalizeGarminUrl(url?: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" || !GARMIN_HOSTS.includes(parsed.hostname)) {
      return null;
    }

    if (parsed.hostname === "livetrack.garmin.com") {
      if (!parsed.pathname.startsWith("/session/") || !parsed.pathname.includes("/token/")) {
        return null;
      }
    } else if (parsed.hostname === "connect.garmin.com") {
      if (!parsed.pathname.includes("/activity/")) {
        return null;
      }
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function loadRouteData(collections: Collection[]): Promise<GarminRouteDataByCollection> {
  const result: GarminRouteDataByCollection = {};

  for (let ci = 0; ci < collections.length; ci++) {
    const collection = collections[ci];
    result[ci] = {};

    for (let ai = 0; ai < collection.activities.length; ai++) {
      const activity = collection.activities[ai];
      const sourceUrl = activity.garminConnectUrl || activity.garminLivetrackUrl;
      const url = normalizeGarminUrl(sourceUrl);
      if (!url) {
        continue;
      }

      result[ci][ai] = await extractGarminRoute(url, `collection ${ci + 1} activity ${ai + 1}`);
    }
  }

  return result;
}

async function extractGarminRoute(sourceUrl: string, label: string): Promise<GarminRouteData> {
  const extractedAt = new Date().toISOString();
  const url = new URL(sourceUrl);

  if (url.hostname === "connect.garmin.com") {
    return extractGarminConnectActivity(sourceUrl, label, extractedAt);
  }

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      const result: GarminRouteError = {
        status: "fetch_error",
        sourceUrl,
        extractedAt,
        errorDetail: `Garmin returned ${response.status} ${response.statusText} for activity: ${label}.`,
      };
      console.warn(`[garmin] ${result.errorDetail}`);
      return result;
    }

    const html = await response.text();
    const parsed = parseTrackDataFromHtml(html);
    if ("errorDetail" in parsed) {
      const result: GarminRouteError = {
        status: "parse_error",
        sourceUrl,
        extractedAt,
        errorDetail: `${parsed.errorDetail} (Activity: ${label})`,
      };
      console.warn(`[garmin] ${result.errorDetail}`);
      return result;
    }

    const normalizedPoints = parsed.points
      .map((point) => normalizeTrackPoint(point))
      .filter((point): point is GarminTrackPoint => point !== null);

    if (normalizedPoints.length === 0) {
      return {
        status: "empty",
        sourceUrl,
        extractedAt,
      };
    }

    return {
      status: "ok",
      sourceUrl,
      extractedAt,
      sessionName: parsed.session.sessionName,
      points: normalizedPoints,
      summary: buildRouteSummary(normalizedPoints, parsed.session, extractedAt),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Garmin fetch error.";
    const result: GarminRouteError = {
      status: "fetch_error",
      sourceUrl,
      extractedAt,
      errorDetail: detail,
    };
    console.warn(`[garmin] ${result.errorDetail}`);
    return result;
  }
}

async function extractGarminConnectActivity(
  sourceUrl: string,
  label: string,
  extractedAt: string,
): Promise<GarminRouteData> {
  // Activity ID is the last numeric part of the path
  const activityId = sourceUrl.split("/").filter(Boolean).at(-1);
  if (!activityId || !/^\d+$/.test(activityId)) {
    return {
      status: "parse_error",
      sourceUrl,
      extractedAt,
      errorDetail: "Invalid Garmin Connect activity ID.",
    };
  }

  // Attempt to fetch from the public sharing endpoint
  // This often works for public activities without auth
  const shareUrl = `https://connect.garmin.com/gc-api/activity-service/activity/${activityId}/details?maxChartSize=2000&maxPolylineSize=4000`;

  try {
    const response = await fetch(shareUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: sourceUrl,
        "NK: NT": "NK",
      },
    });

    if (!response.ok) {
      // Fallback: search for metadata in HTML if details API fails
      return extractSummaryFromConnectHtml(sourceUrl, label, extractedAt);
    }

    const data = await response.json();
    return parseConnectDetailsJson(data, sourceUrl, extractedAt);
  } catch (e) {
    return extractSummaryFromConnectHtml(sourceUrl, label, extractedAt);
  }
}

async function extractSummaryFromConnectHtml(
  sourceUrl: string,
  label: string,
  extractedAt: string,
): Promise<GarminRouteData> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const html = await response.text();

    // Extract basic info from meta tags
    const latMatch = html.match(/property="og:latitude" content="([^"]+)"/);
    const lonMatch = html.match(/property="og:longitude" content="([^"]+)"/);
    const titleMatch = html.match(/property="og:title" content="([^"]+)"/);

    if (latMatch && lonMatch) {
      const lat = parseFloat(latMatch[1]);
      const lon = parseFloat(lonMatch[1]);
      const point: GarminTrackPoint = { lat, lon, time: extractedAt };

      return {
        status: "ok",
        sourceUrl,
        extractedAt,
        sessionName: titleMatch ? titleMatch[1] : "Garmin Connect Activity",
        points: [point],
        summary: {
          pointCount: 1,
          lastReportedTime: extractedAt,
          isActive: false,
        },
      };
    }

    return {
      status: "empty",
      sourceUrl,
      extractedAt,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error.";
    return {
      status: "fetch_error",
      sourceUrl,
      extractedAt,
      errorDetail: `Could not load Garmin Connect activity ${label}: ${detail}. Public activities may require a different share link or manual GPX upload.`,
    };
  }
}

function parseConnectDetailsJson(data: any, sourceUrl: string, extractedAt: string): GarminRouteData {
  if (!data || !data.activityDetailMetrics) {
    return { status: "empty", sourceUrl, extractedAt };
  }

  const descriptors: any[] = data.metricDescriptors || [];
  const metrics: any[][] = data.activityDetailMetrics || [];

  const latIdx = descriptors.findIndex((d) => d.key === "directLatitude");
  const lonIdx = descriptors.findIndex((d) => d.key === "directLongitude");
  const eleIdx = descriptors.findIndex((d) => d.key === "directElevation" || d.key === "sumElevation");
  const timeIdx = descriptors.findIndex((d) => d.key === "directTimestamp");
  const distIdx = descriptors.findIndex((d) => d.key === "sumDistance");
  const speedIdx = descriptors.findIndex((d) => d.key === "directSpeed");
  const hrIdx = descriptors.findIndex((d) => d.key === "directHeartRate");
  const pwrIdx = descriptors.findIndex((d) => d.key === "directPower");
  const cadIdx = descriptors.findIndex((d) => d.key === "directCadence");

  const points: GarminTrackPoint[] = [];

  for (const m of metrics) {
    const lat = m[latIdx];
    const lon = m[lonIdx];
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    points.push({
      lat,
      lon,
      elevation: typeof m[eleIdx] === "number" ? m[eleIdx] : undefined,
      time: typeof m[timeIdx] === "number" ? new Date(m[timeIdx]).toISOString() : undefined,
      distanceMeters: typeof m[distIdx] === "number" ? m[distIdx] : undefined,
      speedMetersPerSec: typeof m[speedIdx] === "number" ? m[speedIdx] : undefined,
      heartRateBeatsPerMin: typeof m[hrIdx] === "number" ? m[hrIdx] : undefined,
      powerWatts: typeof m[pwrIdx] === "number" ? m[pwrIdx] : undefined,
      cadenceCyclesPerMin: typeof m[cadIdx] === "number" ? m[cadIdx] : undefined,
    });
  }

  if (points.length === 0) {
    return { status: "empty", sourceUrl, extractedAt };
  }

  return {
    status: "ok",
    sourceUrl,
    extractedAt,
    sessionName: data.activityName || "Garmin Connect Activity",
    points,
    summary: {
      pointCount: points.length,
      totalDistanceMeters: points.at(-1)?.distanceMeters,
      lastReportedTime: points.at(-1)?.time,
      isActive: false,
    },
  };
}

function parseTrackDataFromHtml(
  html: string,
): { points: GarminTrackPointSource[]; session: GarminSessionData } | { errorDetail: string } {
  let trackQuery: GarminHydratedQuery | undefined;
  let sessionQuery: GarminHydratedQuery | undefined;

  for (const match of html.matchAll(hydrationPattern)) {
    try {
      const decoded = JSON.parse(match[1]) as string;
      
      const payloadSeparator = decoded.indexOf(":");
      if (payloadSeparator === -1) {
        continue;
      }

      const payload = JSON.parse(decoded.slice(payloadSeparator + 1)) as unknown[];
      if (!Array.isArray(payload)) {
        continue;
      }

      const stateNode = payload.find(
        (value): value is { state?: { queries?: GarminHydratedQuery[] } } =>
          typeof value === "object" && value !== null && "state" in value,
      );

      const queries = stateNode?.state?.queries;
      if (!Array.isArray(queries)) {
        continue;
      }

      if (!trackQuery) {
        trackQuery = queries.find((query) => query.queryKey?.at(-1) === "track-points");
      }
      if (!sessionQuery) {
        sessionQuery = queries.find(
          (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "session" && query.queryKey.length === 3,
        );
      }
    } catch {
      continue;
    }
  }

  if (sessionQuery) {
    const session = asSessionData(sessionQuery.state?.data);
    const trackPages = trackQuery ? asTrackPages(trackQuery.state?.data) : [];
    const points = trackPages.flatMap((page) => page.trackPoints ?? []);

    // If no track points, but we have a session position, use that as a fallback point
    if (points.length === 0 && session.position) {
      points.push({
        position: session.position,
        dateTime: session.end || session.start,
        reportedTime: session.end || session.start,
      });
    }

    return { points, session };
  }

  return {
    errorDetail: "Could not find Garmin session data in the hydration payload.",
  };
}

function asTrackPages(value: unknown): Array<{ trackPoints?: GarminTrackPointSource[] }> {
  if (!value || typeof value !== "object" || !("pages" in value)) {
    return [];
  }

  const pages = (value as { pages?: unknown[] }).pages;
  return Array.isArray(pages) ? (pages as Array<{ trackPoints?: GarminTrackPointSource[] }>) : [];
}

function asSessionData(value: unknown): GarminSessionData {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as GarminSessionData;
}

function normalizeTrackPoint(point: GarminTrackPointSource): GarminTrackPoint | null {
  const lat = point.position?.lat;
  const lon = point.position?.lon;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return null;
  }

  return {
    lat,
    lon,
    elevation: typeof point.altitude === "number" ? point.altitude : undefined,
    speedMetersPerSec:
      typeof point.speedMetersPerSec === "number"
        ? point.speedMetersPerSec
        : typeof point.speed === "number"
          ? point.speed
          : undefined,
    heartRateBeatsPerMin:
      typeof point.heartRateBeatsPerMin === "number" && point.heartRateBeatsPerMin > 0
        ? point.heartRateBeatsPerMin
        : undefined,
    cadenceCyclesPerMin: typeof point.cadenceCyclesPerMin === "number" ? point.cadenceCyclesPerMin : undefined,
    powerWatts: typeof point.powerWatts === "number" ? point.powerWatts : undefined,
    time: point.dateTime,
    reportedTime: point.reportedTime,
    distanceMeters:
      typeof point.totalDistanceMeters === "number"
        ? point.totalDistanceMeters
        : typeof point.distanceMeters === "number"
          ? point.distanceMeters
          : undefined,
    durationSecs:
      typeof point.totalDurationSecs === "number"
        ? point.totalDurationSecs
        : typeof point.durationSecs === "number"
          ? point.durationSecs
          : undefined,
  };
}

function buildRouteSummary(
  points: GarminTrackPoint[],
  session: GarminSessionData,
  extractedAt: string,
): GarminRouteSummary {
  const altitudes = points
    .map((point) => point.elevation)
    .filter((value): value is number => typeof value === "number");
  const lastPoint = points.at(-1);
  const lastReportedTime = lastPoint?.reportedTime ?? lastPoint?.time;

  return {
    pointCount: points.length,
    totalDistanceMeters: lastPoint?.distanceMeters,
    totalDurationSecs: lastPoint?.durationSecs,
    minimumAltitudeMeters: altitudes.length > 0 ? Math.min(...altitudes) : undefined,
    maximumAltitudeMeters: altitudes.length > 0 ? Math.max(...altitudes) : undefined,
    lastReportedTime,
    sessionStartTime: session.start,
    sessionEndTime: session.end,
    postTrackPointFrequencySecs: session.postTrackPointFrequency,
    isActive: isSessionActive({
      session,
      lastReportedTime,
      extractedAt,
    }),
  };
}

function isSessionActive(options: {
  session: GarminSessionData;
  lastReportedTime?: string;
  extractedAt: string;
}): boolean {
  const { session, lastReportedTime, extractedAt } = options;
  const extractedAtMs = Date.parse(extractedAt);
  const startMs = session.start ? Date.parse(session.start) : Number.NaN;
  const endMs = session.end ? Date.parse(session.end) : Number.NaN;
  const lastReportedMs = lastReportedTime ? Date.parse(lastReportedTime) : Number.NaN;

  if ([extractedAtMs, startMs, endMs, lastReportedMs].some((value) => Number.isNaN(value))) {
    return false;
  }

  const frequencySecs = typeof session.postTrackPointFrequency === "number" ? session.postTrackPointFrequency : 15;
  const freshnessWindowMs = Math.max(frequencySecs * 8_000, 10 * 60_000);

  return (
    extractedAtMs >= startMs &&
    extractedAtMs <= endMs + freshnessWindowMs &&
    extractedAtMs - lastReportedMs <= freshnessWindowMs
  );
}
