import type { TripActivity, TripDay } from "../data/trip";

const GARMIN_HOST = "livetrack.garmin.com";
const ACTIVITY_COLORS = ["#60a5fa", "#f97316", "#22c55e", "#a855f7", "#eab308"];

export interface CurrentSelection {
  day: TripDay;
  reason: string;
}

export function sortDays(days: TripDay[]): TripDay[] {
  return [...days].sort((left, right) => left.date.localeCompare(right.date));
}

export function getLocalIsoDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

export function normalizeGarminUrl(url?: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== GARMIN_HOST ||
      !parsed.pathname.startsWith("/session/") ||
      !parsed.pathname.includes("/token/")
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function isEmbeddableGarminUrl(url?: string | null): boolean {
  return Boolean(normalizeGarminUrl(url));
}

export function getDayActivities(day: TripDay): TripActivity[] {
  if (Array.isArray(day.activities) && day.activities.length > 0) {
    return day.activities.map((activity, index) => ({
      ...activity,
      color: activity.color || ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
      livetrackUrl: activity.livetrackUrl ?? null,
    }));
  }

  return [
    {
      id: "primary-route",
      title: day.title || "Route",
      color: ACTIVITY_COLORS[0],
      livetrackUrl: day.livetrackUrl ?? null,
      notes: day.notes,
    },
  ];
}

export function dayHasAnyUrl(day: TripDay): boolean {
  return getDayActivities(day).some((activity) => isEmbeddableGarminUrl(activity.livetrackUrl));
}

export function getPrimaryGarminUrl(day: TripDay): string | null {
  const firstMatchingActivity = getDayActivities(day).find((activity) => isEmbeddableGarminUrl(activity.livetrackUrl));
  return normalizeGarminUrl(firstMatchingActivity?.livetrackUrl);
}

export function selectCurrentDay(days: TripDay[], todayIso: string): CurrentSelection {
  const todayMatch = days.find((day) => day.date === todayIso);

  if (todayMatch) {
    return {
      day: todayMatch,
      reason: dayHasAnyUrl(todayMatch)
        ? "Showing today's route."
        : "Today's Garmin session has not been added yet.",
    };
  }

  const previousWithUrl = days.filter((day) => day.date <= todayIso && dayHasAnyUrl(day)).at(-1);
  if (previousWithUrl) {
    return {
      day: previousWithUrl,
      reason: "No entry exists for today yet, so this page is showing the most recent day with a Garmin link.",
    };
  }

  const latestWithUrl = days.filter((day) => dayHasAnyUrl(day)).at(-1);
  if (latestWithUrl) {
    return {
      day: latestWithUrl,
      reason: "No current Garmin session is configured yet, so this page is showing the latest available route.",
    };
  }

  return {
    day: days.at(-1) ?? {
      date: todayIso,
      title: "Trip day",
    },
    reason: "No Garmin session is configured yet.",
  };
}

export function formatLongDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function serializeDataForScript(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
