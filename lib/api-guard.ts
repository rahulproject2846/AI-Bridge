type RLStore = Map<string, number[]>;
const g = globalThis as unknown as { __rl?: RLStore };
if (!g.__rl) g.__rl = new Map();
const store = g.__rl!;

export function getClientIp(req: Request): string {
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}

export function checkRateLimit(key: string, ip: string, max: number, windowMs: number): boolean {
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const arr = store.get(bucketKey) || [];
  const filtered = arr.filter((t) => now - t < windowMs);
  if (filtered.length >= max) {
    store.set(bucketKey, filtered);
    return false;
  }
  filtered.push(now);
  store.set(bucketKey, filtered);
  return true;
}

export async function parseJsonWithLimit<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const text = await req.text();
  const size = new TextEncoder().encode(text).length;
  if (size > maxBytes) {
    throw Object.assign(new Error("Payload too large"), { status: 413 });
  }
  return JSON.parse(text) as T;
}

export function errorStatus(e: unknown, fallback = 500): number {
  if (e && typeof e === "object" && "status" in e) {
    const val = (e as Record<string, unknown>).status;
    if (typeof val === "number") return val;
  }
  return fallback;
}
