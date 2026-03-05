import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import { checkRateLimit, getClientIp, parseJsonWithLimit, errorStatus } from "@/lib/api-guard";
import { logError } from "@/lib/log";

export async function DELETE(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit("bulk-delete", ip, 30, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    await connectMongo();
    const body = await parseJsonWithLimit<{ shareId?: string; filePaths?: string[] }>(req, 256 * 1024);
    const shareId: string | undefined = body?.shareId;
    const filePaths: string[] | undefined = body?.filePaths;
    if (!shareId || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const db = mongoose.connection.db;
    if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    const col = db.collection("shares");
    const now = new Date();
    await col.updateOne(
      { shareId },
      { $pull: { files: { path: { $in: filePaths } } }, $set: { updatedAt: now } } as Record<string, unknown>
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("api/sync/bulk-delete DELETE", e);
    const status = errorStatus(e, 500);
    return NextResponse.json({ error: "Server error" }, { status });
  }
}
