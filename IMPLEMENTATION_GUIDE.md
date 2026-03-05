# AI-Bridge: Pre-Deployment Fix Implementation Guide

**Estimated Time:** 4-6 hours to complete all critical + high priority fixes

---

## Quick Reference: Files to Modify

| File | Issue Type | Estimated Time |
|------|-----------|---|
| `lib/mongodb.ts` | 🔴 Critical | 15 min |
| `app/api/sync/route.ts` | 🔴 Critical | 30 min |
| `app/share/[id]/route.ts` | 🔴 Critical | 30 min |
| `app/share/[id]/file/route.ts` | 🔴 Critical | 15 min |
| `app/share/[id]/jsonl/route.ts` | 🔴 Critical | 15 min |
| `app/api/sync/project/route.ts` | 🔴 Critical | 30 min |
| `lib/api-guard.ts` | 🔴 Critical | 20 min |
| `lib/env.ts` | 🟠 High | 15 min |
| `app/api/share/auth/route.ts` | 🟠 High | 20 min |
| `lib/hash.ts` | 🟠 High | 10 min |
| All API routes | 🟠 High | 1 hour |
| `vercel.json` | 🟠 High | 10 min |

---

## 🔴 CRITICAL FIX 1: MongoDB Connection Error Handling

### File: `lib/mongodb.ts`

**Why:** If MongoDB fails to connect once, the app becomes permanently unable to recover.

**Replace:**
```typescript
import mongoose from "mongoose";
import { MONGODB_URI } from "./env";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};
const g = globalThis as unknown as { mongooseCache?: MongooseCache };
const cached: MongooseCache = g.mongooseCache || { conn: null, promise: null };

if (!g.mongooseCache) {
  g.mongooseCache = cached;
}

export async function connectMongo() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
```

**With:**
```typescript
import mongoose from "mongoose";
import { MONGODB_URI } from "./env";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};
const g = globalThis as unknown as { mongooseCache?: MongooseCache };
const cached: MongooseCache = g.mongooseCache || { conn: null, promise: null };

if (!g.mongooseCache) {
  g.mongooseCache = cached;
}

export async function connectMongo() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI environment variable");
  }
  
  if (cached.conn) return cached.conn;
  
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        connectTimeoutMS: 5000,         // Timeout after 5 seconds
        serverSelectionTimeoutMS: 5000, // Select server timeout
        socketTimeoutMS: 45000,         // Socket timeout
        retryWrites: true,
        retryReads: true,
        maxPoolSize: 10,                // Connection pool size
      })
      .catch((err) => {
        // Clear promise on error to allow retry next time
        cached.promise = null;
        throw err;
      });
  }
  
  cached.conn = await cached.promise;
  return cached.conn;
}
```

---

## 🔴 CRITICAL FIX 2: Fix Password Hash Inconsistency

### File: `lib/hash.ts`

**Why:** Current implementation is only used in one endpoint; others use sync crypto.

**Current:**
```typescript
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

**Replace with (add bcrypt support):**
```typescript
// You must run: npm install bcryptjs
// npm install -D @types/bcryptjs
import bcrypt from "bcryptjs";

/**
 * Hash a password using bcrypt (slow, salted, resistant to attacks)
 * Use for password storage
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10); // 10 rounds = ~100ms
}

/**
 * Verify a password against bcrypt hash
 * Use for password verification
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * SHA256 hash (fast, no salt, for content hashing)
 * Use for file content, not passwords
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time string comparison (prevent timing attacks)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  
  if (aBytes.length !== bBytes.length) return false;
  
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}
```

**Install dependencies:**
```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

---

## 🔴 CRITICAL FIX 3: Fix Password Hash in Auth Endpoint

### File: `app/api/share/auth/route.ts`

**Replace:**
```typescript
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { checkRateLimit, getClientIp, parseJsonWithLimit, errorStatus } from "@/lib/api-guard";
import { logError } from "@/lib/log";
import { sha256Hex } from "@/lib/hash";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit("share-auth", ip, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    await connectMongo();
    const body = await parseJsonWithLimit<{ shareId?: string; password?: string }>(req, 64 * 1024);
    const shareId: string | undefined = body?.shareId;
    const password: string | undefined = body?.password;
    if (!shareId || !password) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const db = mongoose.connection.db;
    if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    const col = db.collection<{ passwordHash?: string }>("shares");
    const doc = await col.findOne({ shareId });
    if (!doc || !doc.passwordHash) {
      return NextResponse.json({ error: "No password set" }, { status: 400 });
    }
    const hash = await sha256Hex(password);
    if (hash !== doc.passwordHash) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(`share_auth_${shareId}`, hash, {
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
    });
    return res;
  } catch (e) {
    logError("api/share/auth POST", e);
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}
```

**With:**
```typescript
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import { checkRateLimit, getClientIp, parseJsonWithLimit, errorStatus } from "@/lib/api-guard";
import { logError } from "@/lib/log";
import { hashPassword, verifyPassword, timingSafeEqual } from "@/lib/hash";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    // Tighter rate limit for auth (5 per minute vs 20)
    if (!checkRateLimit("share-auth", ip, 5, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    
    await connectMongo();
    const body = await parseJsonWithLimit<{ shareId?: string; password?: string }>(req, 64 * 1024);
    const shareId: string | undefined = body?.shareId;
    const password: string | undefined = body?.password;
    
    if (!shareId || !password) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(shareId)) {
      return NextResponse.json({ error: "Invalid shareId format" }, { status: 400 });
    }
    
    const db = mongoose.connection.db;
    if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    
    const col = db.collection<{ passwordHash?: string }>("shares");
    const doc = await col.findOne({ shareId });
    
    if (!doc || !doc.passwordHash) {
      return NextResponse.json({ error: "No password set" }, { status: 400 });
    }
    
    // Use bcrypt verification (timing-safe)
    const isValid = await verifyPassword(password, doc.passwordHash);
    if (!isValid) {
      logError("api/share/auth POST", "Invalid password attempt", { shareId, ip });
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    
    const res = NextResponse.json({ ok: true });
    res.cookies.set(`share_auth_${shareId}`, "authenticated", {
      httpOnly: true,
      secure: true, // HTTPS only in production
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      sameSite: "lax",
    });
    return res;
  } catch (e) {
    logError("api/share/auth POST", e);
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}
```

---

## 🔴 CRITICAL FIX 4: Add Authorization to Write Endpoints

### File: `app/api/sync/route.ts`

**Why:** Currently anyone can modify any share just by knowing the shareId.

**Current sync/POST endpoint needs authorization. For now, we'll use simple API key approach:**

**Add to `lib/api-guard.ts`:**
```typescript
/**
 * Verify API Key for write operations
 * API keys are passed as X-API-Key header
 * For now, we accept the shareId as the key (should be replaced with proper auth)
 */
export function verifyApiKey(req: Request, shareId: string): boolean {
  const apiKey = req.headers.get("x-api-key");
  
  // TEMPORARY: Use shareId as auth token
  // In production, replace with JWT or proper API keys
  if (!apiKey) {
    return false;
  }
  
  // Simple validation: key must match shareId for now
  // TODO: Replace with JWT verification or database API keys
  return apiKey === shareId;
}
```

**Update `app/api/sync/route.ts`:**
```typescript
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import { 
  checkRateLimit, 
  getClientIp, 
  parseJsonWithLimit, 
  errorStatus,
  verifyApiKey 
} from "@/lib/api-guard";
import { logError } from "@/lib/log";
import { hashPassword } from "@/lib/hash";

export const maxDuration = 60;
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export async function POST(req: Request) {
  const ip = getClientIp(req);
  
  try {
    if (!checkRateLimit("sync", ip, 20, 60_000)) {
      return NextResponse.json(
        { error: "Too many requests" }, 
        { status: 429 }
      );
    }

    await connectMongo();
    const body = await parseJsonWithLimit<{
      shareId?: string;
      projectName?: string;
      files?: { path: string; content: string }[];
      expiresAt?: string;
      password?: string;
    }>(req, 4 * 1024 * 1024);

    const shareId: string | undefined = body?.shareId;
    const projectName: string | undefined = body?.projectName;
    const files: Array<{ path: string; content: string }> = Array.isArray(body?.files)
      ? body.files
      : [];
    const expiresAt: string | undefined = body?.expiresAt;
    const password: string | undefined = body?.password;

    // Validate inputs
    if (!shareId || !projectName) {
      return NextResponse.json(
        { error: "Invalid payload: missing shareId or projectName" }, 
        { status: 400 }
      );
    }

    // Validate shareId format
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(shareId)) {
      return NextResponse.json(
        { error: "Invalid shareId format" }, 
        { status: 400 }
      );
    }

    // Verify API key (authorization)
    if (!verifyApiKey(req, shareId)) {
      logError("api/sync POST", "Unauthorized access attempt", { shareId, ip });
      return NextResponse.json(
        { error: "Unauthorized" }, 
        { status: 401 }
      );
    }

    // Validate files array
    if (!Array.isArray(files)) {
      return NextResponse.json(
        { error: "Invalid files array" }, 
        { status: 400 }
      );
    }

    // Validate individual files
    for (const file of files) {
      if (!file.path || typeof file.path !== "string") {
        return NextResponse.json(
          { error: "Invalid file path" }, 
          { status: 400 }
        );
      }
      if (typeof file.content !== "string") {
        return NextResponse.json(
          { error: "Invalid file content" }, 
          { status: 400 }
        );
      }
      if (file.path.length > 512) {
        return NextResponse.json(
          { error: "File path too long" }, 
          { status: 400 }
        );
      }
    }

    const now = new Date();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json(
        { error: "DB unavailable" }, 
        { status: 500 }
      );
    }

    type ShareRecord = {
      shareId: string;
      projectName: string;
      files: { path: string; content: string }[];
      updatedAt: Date;
      expiresAt?: Date;
      passwordHash?: string;
    };

    const col = db.collection<ShareRecord>("shares");
    const existing = await col.findOne({ shareId });

    // Hash password if provided
    const passwordHash = password && password.length > 0
      ? await hashPassword(password) // Use bcrypt now
      : existing?.passwordHash || undefined;

    // Parse expiry date
    const expiryDate = expiresAt 
      ? new Date(expiresAt) 
      : existing?.expiresAt || undefined;

    // Validate expiry date is in future
    if (expiryDate && expiryDate <= now) {
      return NextResponse.json(
        { error: "Expiry date must be in the future" }, 
        { status: 400 }
      );
    }

    if (!existing) {
      // Create new share
      const result = await col.insertOne({
        shareId,
        projectName,
        files,
        updatedAt: now,
        expiresAt: expiryDate,
        passwordHash,
      });

      if (!result.insertedId) {
        throw new Error("Failed to insert share");
      }

      return NextResponse.json(
        { ok: true, shareId },
        { status: 201 }
      );
    } else {
      // Update existing share - merge files
      const map = new Map(
        existing.files?.map((f) => [f.path, f.content]) || []
      );
      for (const f of files) {
        map.set(f.path, f.content);
      }
      const merged = Array.from(map.entries()).map(([path, content]) => ({
        path,
        content,
      }));

      const updateOps: Record<string, unknown> = {
        projectName,
        files: merged,
        updatedAt: now,
      };

      if (expiryDate) {
        updateOps.expiresAt = expiryDate;
      }
      if (passwordHash) {
        updateOps.passwordHash = passwordHash;
      }

      const result = await col.updateOne({ shareId }, { $set: updateOps });

      if (result.matchedCount === 0) {
        return NextResponse.json(
          { error: "Share not found" }, 
          { status: 404 }
        );
      }

      if (result.modifiedCount === 0) {
        logError("api/sync POST", "No changes made to share", { shareId });
      }

      return NextResponse.json(
        { ok: true, shareId },
        { status: 200 }
      );
    }
  } catch (e) {
    logError("api/sync POST", e, { ip });
    const status = errorStatus(e, 500);
    return NextResponse.json(
      { error: "Server error" }, 
      { status }
    );
  }
}
```

---

## 🔴 CRITICAL FIX 5: Fix Share Read Endpoints (Crypto Hash Consistency)

### File: `app/share/[id]/route.ts`

Find this section (around line 62):
```typescript
const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
if (hash !== doc.passwordHash) {
  return new NextResponse("Unauthorized", { status: 401, headers: headers() });
}
```

**Replace with:**
```typescript
import { verifyPassword } from "@/lib/hash";

// ... later in the code ...

const providedPassword = url.searchParams.get("password") || undefined;
if (doc.passwordHash) {
  if (!providedPassword) {
    return new NextResponse("Unauthorized", { status: 401, headers: headers() });
  }
  const isValid = await verifyPassword(providedPassword, doc.passwordHash);
  if (!isValid) {
    return new NextResponse("Unauthorized", { status: 401, headers: headers() });
  }
}
```

### File: `app/share/[id]/file/route.ts`

Find (around line 33):
```typescript
const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
if (hash !== doc.passwordHash) return new NextResponse("Unauthorized", { status: 401, headers: headers() });
```

**Replace with:**
```typescript
import { verifyPassword } from "@/lib/hash";

// ... later ...
if (doc.passwordHash) {
  if (!providedPassword) return new NextResponse("Unauthorized", { status: 401, headers: headers() });
  const isValid = await verifyPassword(providedPassword, doc.passwordHash);
  if (!isValid) return new NextResponse("Unauthorized", { status: 401, headers: headers() });
}
```

### File: `app/share/[id]/jsonl/route.ts`

Find (around line 44):
```typescript
const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
if (hash !== doc.passwordHash) return new NextResponse("unauthorized\n", { status: 401, headers: headers() });
```

**Replace with the same pattern above.**

---

## 🔴 CRITICAL FIX 6: Add Authorization and Rate Limits to Project Endpoints

### File: `app/api/sync/project/route.ts`

**Replace entire file:**
```typescript
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import {
  checkRateLimit,
  getClientIp,
  parseJsonWithLimit,
  errorStatus,
  verifyApiKey,
} from "@/lib/api-guard";
import { logError } from "@/lib/log";

export async function DELETE(req: Request) {
  const ip = getClientIp(req);
  
  try {
    // Rate limit project deletion
    if (!checkRateLimit("project-delete", ip, 5, 60_000)) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }

    await connectMongo();
    const body = await parseJsonWithLimit<{ shareId?: string }>(req, 64 * 1024);
    const shareId: string | undefined = body?.shareId;

    if (!shareId) {
      return NextResponse.json(
        { error: "Invalid payload: missing shareId" },
        { status: 400 }
      );
    }

    // Validate shareId format
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(shareId)) {
      return NextResponse.json(
        { error: "Invalid shareId format" },
        { status: 400 }
      );
    }

    // Verify authorization
    if (!verifyApiKey(req, shareId)) {
      logError("api/sync/project DELETE", "Unauthorized deletion attempt", {
        shareId,
        ip,
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json(
        { error: "DB unavailable" },
        { status: 500 }
      );
    }

    const col = db.collection("shares");
    const result = await col.deleteOne({ shareId });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    logError("api/sync/project DELETE", e, { ip });
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}

export async function PATCH(req: Request) {
  const ip = getClientIp(req);
  
  try {
    // Rate limit project updates
    if (!checkRateLimit("project-patch", ip, 10, 60_000)) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
    }

    await connectMongo();
    const body = await parseJsonWithLimit<{
      shareId?: string;
      projectName?: string;
    }>(req, 64 * 1024);
    const shareId: string | undefined = body?.shareId;
    const projectName: string | undefined = body?.projectName;

    if (!shareId || !projectName) {
      return NextResponse.json(
        { error: "Invalid payload: missing shareId or projectName" },
        { status: 400 }
      );
    }

    // Validate shareId format
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(shareId)) {
      return NextResponse.json(
        { error: "Invalid shareId format" },
        { status: 400 }
      );
    }

    // Validate projectName
    if (typeof projectName !== "string" || projectName.length === 0 || projectName.length > 256) {
      return NextResponse.json(
        { error: "Invalid projectName" },
        { status: 400 }
      );
    }

    // Verify authorization
    if (!verifyApiKey(req, shareId)) {
      logError("api/sync/project PATCH", "Unauthorized update attempt", {
        shareId,
        ip,
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json(
        { error: "DB unavailable" },
        { status: 500 }
      );
    }

    const col = db.collection("shares");
    const result = await col.updateOne(
      { shareId },
      { $set: { projectName, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    logError("api/sync/project PATCH", e, { ip });
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}
```

---

## 🔴 CRITICAL FIX 7: Fix IP Spoofing in Rate Limiter

### File: `lib/api-guard.ts`

**Replace getClientIp function:**

```typescript
export function getClientIp(req: Request): string {
  // In production (Vercel), x-forwarded-for is set by the edge network
  // In local development, use localhost
  
  // Get the leftmost IP from x-forwarded-for (most recent proxy)
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) {
    // Take the first IP (client's IP)
    const firstIp = xfwd.split(",")[0]?.trim();
    if (firstIp && isValidIp(firstIp)) {
      return firstIp;
    }
  }

  // Fallback to x-real-ip
  const realIp = req.headers.get("x-real-ip");
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // Default for local development
  return "127.0.0.1";
}

/**
 * Basic IP validation
 */
function isValidIp(ip: string): boolean {
  // IPv4 validation
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(ip)) {
    const parts = ip.split(".").map((x) => parseInt(x, 10));
    return parts.every((x) => x >= 0 && x <= 255);
  }

  // IPv6 validation (basic)
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6.test(ip);
}
```

---

## 🟠 HIGH FIX 8: Protect Cron Endpoint

### File: `app/api/cron/purge-expired/route.ts`

**Add secret protection:**

```typescript
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import { logError, logInfo } from "@/lib/log";

export async function POST(req: Request) {
  try {
    // Verify Cron Secret
    const authHeader = req.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      logError("api/cron/purge-expired POST", "CRON_SECRET not configured");
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    const expectedAuth = `Bearer ${expectedSecret}`;
    if (authHeader !== expectedAuth) {
      logError("api/cron/purge-expired POST", "Unauthorized cron attempt", {
        ip: req.headers.get("x-forwarded-for") || "unknown",
      });
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json(
        { error: "DB unavailable" },
        { status: 500 }
      );
    }

    const col = db.collection("shares");
    const now = new Date();

    const result = await col.deleteMany({ expiresAt: { $lte: now } });
    const deletedCount = result.deletedCount ?? 0;

    logInfo("api/cron/purge-expired", "Purge completed", {
      deletedCount,
    });

    return NextResponse.json({
      ok: true,
      deleted: deletedCount,
      timestamp: now.toISOString(),
    });
  } catch (e) {
    logError("api/cron/purge-expired POST", e);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
```

---

## 🟠 HIGH FIX 9: Improve Environment Variables

### File: `lib/env.ts`

**Replace:**
```typescript
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "v1.0.0";
export const MONGODB_URI = process.env.MONGODB_URI;
```

**With:**
```typescript
/**
 * Validate and export environment variables
 * Throws error if required variables are missing
 */

function getEnv(key: string, required: boolean = false): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Required variables (will error if missing at startup)
export const MONGODB_URI = getEnv("MONGODB_URI", true) || "";
export const CRON_SECRET = getEnv("CRON_SECRET", false);

// Optional variables with defaults
export const APP_VERSION = getEnv("NEXT_PUBLIC_APP_VERSION") || "v1.0.0";
export const APP_ENVIRONMENT = (getEnv("APP_ENVIRONMENT") || "development") as
  | "development"
  | "staging"
  | "production";
export const LOG_LEVEL = (
  getEnv("LOG_LEVEL") || "info"
) as "debug" | "info" | "warn" | "error";

// Feature flags
export const RATE_LIMITING_ENABLED = getEnv("RATE_LIMITING_ENABLED") !== "false";
export const REQUIRE_AUTH_FOR_SYNC = getEnv("REQUIRE_AUTH_FOR_SYNC") === "true";

// Limits
export const MAX_SYNC_BATCH_SIZE = parseInt(
  getEnv("MAX_SYNC_BATCH_SIZE") || "4194304", // 4MB
  10
);
export const MAX_FILES_PER_SHARE = parseInt(
  getEnv("MAX_FILES_PER_SHARE") || "10000",
  10
);
export const SHARE_DAILY_QUOTA_MB = parseInt(
  getEnv("SHARE_DAILY_QUOTA_MB") || "100",
  10
);

// Validate environment at startup
if (typeof window === "undefined") {
  // Server-side validation only
  try {
    MONGODB_URI; // Access to trigger validation
  } catch (e) {
    console.error("Environment validation failed:", e);
    process.exit(1);
  }
}
```

---

## 📋 Additional Configuration Files

### File: Create `.env.example`

```
# MongoDB Connection
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/dbname

# App Configuration
NEXT_PUBLIC_APP_VERSION=v1.0.0
APP_ENVIRONMENT=production
LOG_LEVEL=info

# Security
CRON_SECRET=your-secret-cron-key-here-minimum-32-characters

# Feature Flags
RATE_LIMITING_ENABLED=true
REQUIRE_AUTH_FOR_SYNC=true

# Limits
MAX_SYNC_BATCH_SIZE=4194304
MAX_FILES_PER_SHARE=10000
SHARE_DAILY_QUOTA_MB=100
```

### File: Update `vercel.json`

```json
{
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
        },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    },
    {
      "source": "/share/(.*)",
      "headers": [
        { "key": "Content-Type", "value": "text/plain; charset=utf-8" },
        { "key": "Cache-Control", "value": "no-store, must-revalidate" },
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, OPTIONS"
        },
        { "key": "X-Robots-Tag", "value": "noindex, nofollow" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

---

## Enhanced Logging

### File: Update `lib/log.ts`

```typescript
import { APP_ENVIRONMENT, LOG_LEVEL } from "./env";

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogLevel = keyof typeof LEVELS;

const currentLevel = LEVELS[LOG_LEVEL] || LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= currentLevel;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

export function logDebug(context: string, msg: string, data?: Record<string, unknown>) {
  if (shouldLog("debug")) {
    console.debug(
      JSON.stringify({
        level: "debug",
        timestamp: formatTimestamp(),
        context,
        msg,
        ...(data || {}),
      })
    );
  }
}

export function logInfo(context: string, msg: string, data?: Record<string, unknown>) {
  if (shouldLog("info")) {
    console.log(
      JSON.stringify({
        level: "info",
        timestamp: formatTimestamp(),
        context,
        msg,
        ...(data || {}),
      })
    );
  }
}

export function logWarn(context: string, msg: string, data?: Record<string, unknown>) {
  if (shouldLog("warn")) {
    console.warn(
      JSON.stringify({
        level: "warn",
        timestamp: formatTimestamp(),
        context,
        msg,
        ...(data || {}),
      })
    );
  }
}

export function logError(
  context: string,
  error: unknown,
  meta?: Record<string, unknown>
) {
  if (shouldLog("error")) {
    const payload = {
      level: "error",
      timestamp: formatTimestamp(),
      context,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      environment: APP_ENVIRONMENT,
      ...(meta || {}),
    };
    console.error(JSON.stringify(payload));
  }
}
```

---

## Installation: Install Dependencies

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
npm install zod       # For validation (optional but recommended)
```

---

## Testing Checklist

### Before Deployment

- [ ] Install bcryptjs: `npm install bcryptjs @types/bcryptjs`
- [ ] Set CRON_SECRET in environment: `CRON_SECRET=your-random-key`
- [ ] Update all API routes imports to use new hash functions
- [ ] Test MongoDB connection handling with timeouts
- [ ] Test rate limiting doesn't crash with many requests
- [ ] Test password verification with bcrypt
- [ ] Test shareId validation rejects invalid formats
- [ ] Test authorization on write endpoints (retry with wrong API key)
- [ ] Test cron endpoint requires secret header
- [ ] Run `npm run build` successfully

### Quick Security Test Script

```bash
# Test 1: Rate limiting
for i in {1..50}; do
  curl -X POST http://localhost:3000/api/sync/project \
    -H "Content-Type: application/json" \
    -d '{"shareId":"test","projectName":"test"}' \
    -H "X-API-Key: test" &
done

# Test 2: Invalid ShareId format
curl -X POST http://localhost:3000/api/sync \
  -H "X-API-Key: test123" \
  -H "Content-Type: application/json" \
  -d '{"shareId":"../../../etc/passwd","projectName":"test","files":[]}'
# Should get 400 error

# Test 3: Cron protection
curl -X POST http://localhost:3000/api/cron/purge-expired
# Should get 401 Unauthorized

curl -X POST http://localhost:3000/api/cron/purge-expired \
  -H "Authorization: Bearer wrong-secret"
# Should get 401 Unauthorized
```

---

## Fixed Files Summary

| File | Changes | Lines Changed |
|------|---------|---|
| `lib/mongodb.ts` | Add timeout config, error recovery | ~20 |
| `lib/hash.ts` | Add bcrypt functions | ~30 |
| `lib/api-guard.ts` | Fix IP spoofing, add verifyApiKey | ~20 |
| `lib/env.ts` | Add validation, exports | ~30 |
| `lib/log.ts` | Add log levels, timestamps | ~40 |
| `app/api/share/auth/route.ts` | Use bcrypt verify | ~15 |
| `app/api/sync/route.ts` | Add validation, authorization | ~50 |
| `app/api/sync/project/route.ts` | Add authorization, validation | ~80 |
| `app/share/[id]/route.ts` | Fix crypto hash, use bcrypt | ~25 |
| `app/share/[id]/file/route.ts` | Fix crypto hash, use bcrypt | ~15 |
| `app/share/[id]/jsonl/route.ts` | Fix crypto hash, use bcrypt | ~15 |
| `.env.example` | New file | N/A |
| `vercel.json` | Update security headers | ~20 |

**Total Estimated Changes:** ~360 lines of code modification/addition

---

## Next Steps

1. **Backup current code:**
   ```bash
   git add .
   git commit -m "Pre-audit backup"
   ```

2. **Apply fixes incrementally:**
   - Start with lib files (env, hash, api-guard)
   - Then MongoDB fix
   - Then endpoint fixes one by one
   - Test after each change

3. **Test locally:**
   ```bash
   npm install bcryptjs @types/bcryptjs
   npm run dev
   # Test each endpoint manually
   ```

4. **Run verification:**
   ```bash
   npm run build
   npm run lint
   ```

5. **Deploy to staging first** before production

---

**Time Estimate for All Fixes:** 4-6 hours of careful implementation and testing

