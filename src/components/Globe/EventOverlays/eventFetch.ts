type CachedRequest<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

const cache = new Map<string, CachedRequest<unknown>>();

export function fetchJsonCached<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const existing = cache.get(url) as CachedRequest<T> | undefined;

  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Request failed: ${url}`);
      }

      return response.json() as Promise<T>;
    })
    .catch((error: unknown) => {
      if (cache.get(url)?.promise === promise) {
        cache.delete(url);
      }
      throw error;
    });

  cache.set(url, { promise, expiresAt: now + ttlMs });
  return promise;
}
