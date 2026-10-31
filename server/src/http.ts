import { VERSION } from './version.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET a document as text with a timeout and exponential backoff on 429/5xx and network errors. */
export type TextFetchOptions = FetchOptions & { accept?: string; method?: 'GET' | 'POST'; form?: Record<string, string> };

export async function fetchText(url: string, opts: TextFetchOptions = {}): Promise<string> {
  const { timeoutMs = 30_000, retries = 2, headers = {}, fetchImpl = fetch, sleep = defaultSleep, accept = '*/*', method = 'GET', form } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          'user-agent': `sentinel/${VERSION} (+https://github.com/HVStudios/sentinel)`,
          accept,
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...headers,
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.text();
      const err = new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (attempt < retries) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
      if (attempt < retries) await sleep(2 ** attempt * 2000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET a JSON document (see fetchText for retry behaviour). */
export async function fetchJson<T = unknown>(url: string, opts: TextFetchOptions = {}): Promise<T> {
  const text = await fetchText(url, { accept: 'application/json', ...opts });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(200, `Invalid JSON from ${new URL(url).host}: ${text.slice(0, 120)}`);
  }
}

/** Sliding-window limiter: at most `max` acquisitions per `windowMs`. */
export class RateLimiter {
  private stamps: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(max: number, windowMs: number, now: () => number = Date.now, sleep = defaultSleep) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.sleep = sleep;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(this.windowMs - (t - this.stamps[0]!) + 1);
    }
  }
}
