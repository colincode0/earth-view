const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function validDate(value: number | string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEventDate(value: number | string, options?: { dateOnly?: boolean }) {
  const date = validDate(value);

  if (!date) {
    return null;
  }

  return options?.dateOnly ? DATE_FORMAT.format(date) : DATE_TIME_FORMAT.format(date);
}

export function formatEventAge(value: number | string) {
  const date = validDate(value);

  if (!date) {
    return null;
  }

  const elapsedMs = Date.now() - date.getTime();
  const future = elapsedMs < 0;
  const absoluteMs = Math.abs(elapsedMs);
  const minutes = Math.round(absoluteMs / 60_000);

  if (minutes < 1) {
    return future ? "less than a minute from now" : "less than a minute ago";
  }

  if (minutes < 60) {
    return future ? `in ${minutes} min` : `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return future ? `in ${hours} hr` : `${hours} hr ago`;
  }

  const days = Math.round(hours / 24);
  return future ? `in ${days} days` : `${days} days ago`;
}

export function formatCoordinate(value: number, suffixes: [string, string]) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? suffixes[0] : suffixes[1]}`;
}
