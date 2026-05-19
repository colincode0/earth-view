const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const COMPLETE_GLOBAL_TRUE_COLOR_LAG_HOURS = 6;
const DEFAULT_TRUE_COLOR_LAYER_ID = "viirs-noaa20";
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getYesterdayIso() {
  return toIsoDate(new Date(Date.now() - DAY_MS));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

export function getRecentIsoDates(endDate: string, count: number) {
  const end = parseIsoDate(endDate);

  return Array.from({ length: count }, (_, index) =>
    toIsoDate(addDays(end, index - count + 1)),
  );
}

export function getLatestTrueColorImagery(now = new Date()) {
  const todayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const latestCompleteDay = now.getTime() - todayUtcStart.getTime() >=
    COMPLETE_GLOBAL_TRUE_COLOR_LAG_HOURS * HOUR_MS
    ? addDays(todayUtcStart, -1)
    : addDays(todayUtcStart, -2);

  return {
    date: toIsoDate(latestCompleteDay),
    layerId: DEFAULT_TRUE_COLOR_LAYER_ID,
  };
}

export function formatLongDate(value: string) {
  return LONG_DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`));
}

export function formatImageryDateTime(value: string) {
  return `${formatLongDate(value)} · exact time unavailable`;
}

export const MODIS_TERRA_START = "2000-02-24";
