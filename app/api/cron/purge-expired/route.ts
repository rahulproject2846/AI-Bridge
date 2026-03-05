import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) return new Response("Unauthorized", { status: 401 });

  try {
    await connectMongo();
    const db = mongoose.connection.db;
    if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    const col = db.collection("shares");
    const now = new Date();
    const result = await col.deleteMany({ expiresAt: { $lte: now } });
    return NextResponse.json({ ok: true, deleted: result.deletedCount ?? 0 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

