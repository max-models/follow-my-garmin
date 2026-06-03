import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Collection } from "../data/trip";

export interface PlannedRoutePoint {
  lat: number;
  lon: number;
}

export interface PlannedRouteData {
  points: PlannedRoutePoint[];
}

export interface CollectionPlannedRouteData {
  collectionGpx: PlannedRouteData | null;
  activityGpx: Record<number, PlannedRouteData>;
}

export type PlannedRouteDataByCollection = Record<number, CollectionPlannedRouteData>;

export async function loadPlannedRouteData(collections: Collection[]): Promise<PlannedRouteDataByCollection> {
  const result: PlannedRouteDataByCollection = {};
  const rootDir = resolve(process.cwd());

  for (let ci = 0; ci < collections.length; ci++) {
    const collection = collections[ci];
    result[ci] = { collectionGpx: null, activityGpx: {} };

    const colGpxPath = normalizeGpxPath(collection.routeGpxFile, rootDir);
    if (colGpxPath) {
      try {
        const content = await readFile(colGpxPath, "utf-8");
        const points = parseGpxTrackPoints(content);
        if (points.length > 1) {
          result[ci].collectionGpx = { points };
        }
      } catch (e) {
        console.warn(`[gpx] Could not load collection GPX ${collection.routeGpxFile}: ${e}`);
      }
    }

    for (let ai = 0; ai < collection.activities.length; ai++) {
      const activity = collection.activities[ai];
      const filePath = normalizeGpxPath(activity.routeGpxFile, rootDir);
      if (!filePath) {
        continue;
      }

      try {
        const gpxContent = await readFile(filePath, "utf-8");
        const points = parseGpxTrackPoints(gpxContent);
        if (points.length > 1) {
          result[ci].activityGpx[ai] = { points };
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown GPX load error.";
        console.warn(`[gpx] Could not load ${activity.routeGpxFile}: ${detail}`);
      }
    }
  }

  return result;
}

function normalizeGpxPath(pathValue: string | null | undefined, rootDir: string): string | null {
  if (!pathValue || typeof pathValue !== "string") {
    return null;
  }

  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const resolved = resolve(rootDir, trimmed);
  const rootPrefix = `${rootDir}${sep}`;
  if (resolved !== rootDir && !resolved.startsWith(rootPrefix)) {
    return null;
  }

  return resolved;
}

function parseGpxTrackPoints(gpx: string): PlannedRoutePoint[] {
  const trackPointPattern = /<trkpt\b[^>]*>/gi;
  const points: PlannedRoutePoint[] = [];

  for (const match of gpx.matchAll(trackPointPattern)) {
    const trkptTag = match[0];
    const lat = Number(extractAttributeValue(trkptTag, "lat"));
    const lon = Number(extractAttributeValue(trkptTag, "lon"));

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push({ lat, lon });
    }
  }

  return points;
}

function extractAttributeValue(tag: string, attr: string): string | null {
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrPattern = new RegExp(`${escapedAttr}\\s*=\\s*(['"])(.*?)\\1`, "i");
  const match = tag.match(attrPattern);
  return match?.[2] ?? null;
}
