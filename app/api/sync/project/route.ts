import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function DELETE(req: Request) {
  try {
    await connectMongo();
    const body = await req.json();
    const shareId: string | undefined = body?.shareId;
    if (!shareId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    }
    const col = db.collection("shares");
    await col.deleteOne({ shareId });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await connectMongo();
    const body = await req.json();
    const shareId: string | undefined = body?.shareId;
    const projectName: string | undefined = body?.projectName;
    if (!shareId || !projectName) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
    }
    const col = db.collection("shares");
    await col.updateOne({ shareId }, { $set: { projectName } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

