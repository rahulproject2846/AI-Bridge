import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function POST() {
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

