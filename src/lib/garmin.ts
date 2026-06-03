import type { TripActivity, TripDay } from "../data/trip";
import { getDayActivities } from "./trip";

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
export type GarminRouteDataByActivity = Record<string, GarminRouteData>;
export type GarminRouteDataByDate = Record<string, GarminRouteDataByActivity>;

const hydrationPattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/gs;

export async function loadRouteDataByDate(days: TripDay[]): Promise<GarminRouteDataByDate> {
  const routesByDate: GarminRouteDataByDate = {};

  for (const day of days) {
    const activities = getDayActivities(day).filter((activity) => activity.livetrackUrl);
    if (activities.length === 0) {
      continue;
    }

    const activityRoutes: GarminRouteDataByActivity = {};

    for (const activity of activities) {
      activityRoutes[activity.id] = await extractGarminRoute(activity);
    }

    routesByDate[day.date] = activityRoutes;
  }

  return routesByDate;
}

async function extractGarminRoute(activity: TripActivity): Promise<GarminRouteData> {
  const extractedAt = new Date().toISOString();
  const sourceUrl = activity.livetrackUrl ?? "";

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      const result: GarminRouteError = {
        status: "fetch_error",
        sourceUrl,
        extractedAt,
        errorDetail: `Garmin returned ${response.status} ${response.statusText} for ${activity.id}.`,
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
        errorDetail: parsed.errorDetail,
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

function parseTrackDataFromHtml(
  html: string,
): { points: GarminTrackPointSource[]; session: GarminSessionData } | { errorDetail: string } {
  for (const match of html.matchAll(hydrationPattern)) {
    try {
      const decoded = JSON.parse(match[1]) as string;
      if (!decoded.includes('"track-points"')) {
        continue;
      }

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

      const trackQuery = queries.find((query) => query.queryKey?.at(-1) === "track-points");
      const sessionQuery = queries.find(
        (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "session" && query.queryKey.length === 3,
      );

      const trackPages = asTrackPages(trackQuery?.state?.data);
      const session = asSessionData(sessionQuery?.state?.data);

      return {
        points: trackPages.flatMap((page) => page.trackPoints ?? []),
        session,
      };
    } catch {
      continue;
    }
  }

  return {
    errorDetail: "Could not find Garmin track points in the hydration payload.",
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
