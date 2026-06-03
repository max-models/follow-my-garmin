const COLLECTION_COLORS = ["#60a5fa", "#f97316", "#22c55e", "#a855f7", "#eab308", "#ec4899", "#14b8a6", "#f43f5e"];
const ACTIVITY_COLORS = [
  "#60a5fa",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#eab308",
  "#ec4899",
  "#14b8a6",
  "#f43f5e",
  "#8b5cf6",
  "#84cc16",
  "#ef4444",
  "#06b6d4",
];

export function getCollectionColor(index: number): string {
  return COLLECTION_COLORS[index % COLLECTION_COLORS.length];
}

export function getActivityColor(index: number): string {
  return ACTIVITY_COLORS[index % ACTIVITY_COLORS.length];
}

export function serializeDataForScript(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
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

export function getLocalIsoDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA");
}
