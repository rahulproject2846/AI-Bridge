import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { checkRateLimit, getClientIp, parseJsonWithLimit, errorStatus } from "@/lib/api-guard";
import { logError } from "@/lib/log";
import { sha256Hex } from "@/lib/hash";

export const maxDuration = 60;
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit("sync", ip, 30, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
    if (!shareId || !projectName) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const now = new Date();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
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
    const passwordHash =
      password && password.length > 0
        ? await sha256Hex(password)
        : existing?.passwordHash || undefined;
    const expiryDate = expiresAt ? new Date(expiresAt) : existing?.expiresAt || undefined;
    if (!existing) {
      await col.insertOne({ shareId, projectName, files, updatedAt: now, expiresAt: expiryDate, passwordHash });
    } else {
      const map = new Map(existing.files?.map((f) => [f.path, f.content]) || []);
      for (const f of files) {
        map.set(f.path, f.content);
      }
      const merged = Array.from(map.entries()).map(([path, content]) => ({ path, content }));
      await col.updateOne(
        { shareId },
        { $set: { projectName, files: merged, updatedAt: now, ...(expiryDate ? { expiresAt: expiryDate } : {}), ...(passwordHash ? { passwordHash } : {}) } }
      );
    }
    return NextResponse.json({ ok: true, shareId }, { status: 200 });
  } catch (e) {
    logError("api/sync POST", e);
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}
