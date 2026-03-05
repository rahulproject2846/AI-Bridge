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
