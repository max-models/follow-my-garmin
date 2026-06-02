import type { TripDay } from "../data/trip";

interface GarminHydratedQuery {
  queryKey?: unknown[];
  state?: {
    data?: unknown;
  };
}

interface GarminSessionData {
  sessionName?: string;
  position?: {
    lat?: number;
    lon?: number;
  };
}

interface GarminTrackPointSource {
  dateTime?: string;
  reportedTime?: string;
  altitude?: number;
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
export type GarminRouteDataByDate = Record<string, GarminRouteData>;

const hydrationPattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/gs;

export async function loadRouteDataByDate(days: TripDay[]): Promise<GarminRouteDataByDate> {
  const entries = await Promise.all(
    days
      .filter((day) => day.livetrackUrl)
      .map(async (day) => [
        day.date,
        await extractGarminRoute(day.livetrackUrl as string),
      ] as const),
  );

  return Object.fromEntries(entries);
}

export async function extractGarminRoute(url: string): Promise<GarminRouteData> {
  const extractedAt = new Date().toISOString();

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const result: GarminRouteError = {
        status: "fetch_error",
        sourceUrl: url,
        extractedAt,
        errorDetail: `Garmin returned ${response.status} ${response.statusText}.`,
      };
      console.warn(`[garmin] ${result.errorDetail}`);
      return result;
    }

    const html = await response.text();
    const parsed = parseTrackDataFromHtml(html);
    if ("errorDetail" in parsed) {
      const result: GarminRouteError = {
        status: "parse_error",
        sourceUrl: url,
        extractedAt,
        errorDetail: parsed.errorDetail,
      };
      console.warn(`[garmin] ${result.errorDetail}`);
      return result;
    }

    const { points, session } = parsed;
    if (points.length === 0) {
      return {
        status: "empty",
        sourceUrl: url,
        extractedAt,
      };
    }

    const normalizedPoints = points
      .map((point) => normalizeTrackPoint(point))
      .filter((point): point is GarminTrackPoint => point !== null);

    if (normalizedPoints.length === 0) {
      return {
        status: "empty",
        sourceUrl: url,
        extractedAt,
      };
    }

    return {
      status: "ok",
      sourceUrl: url,
      extractedAt,
      sessionName: session.sessionName,
      points: normalizedPoints,
      summary: buildRouteSummary(normalizedPoints),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Garmin fetch error.";
    const result: GarminRouteError = {
      status: "fetch_error",
      sourceUrl: url,
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

function buildRouteSummary(points: GarminTrackPoint[]): GarminRouteSummary {
  const altitudes = points
    .map((point) => point.elevation)
    .filter((value): value is number => typeof value === "number");
  const lastPoint = points.at(-1);

  return {
    pointCount: points.length,
    totalDistanceMeters: lastPoint?.distanceMeters,
    totalDurationSecs: lastPoint?.durationSecs,
    minimumAltitudeMeters: altitudes.length > 0 ? Math.min(...altitudes) : undefined,
    maximumAltitudeMeters: altitudes.length > 0 ? Math.max(...altitudes) : undefined,
    lastReportedTime: lastPoint?.reportedTime ?? lastPoint?.time,
  };
}
