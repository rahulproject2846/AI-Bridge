import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shareId = searchParams.get("shareId");
  if (!shareId) {
    return NextResponse.json({ error: "Missing shareId" }, { status: 400 });
  }
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  }
  const doc = await db
    .collection<{ shareId: string; projectName: string; files?: { path: string; content: string }[] }>("shares")
    .findOne({ shareId });
  if (!doc) {
    return NextResponse.json(null, { status: 404 });
  }
  return NextResponse.json({
    shareId: doc.shareId,
    projectName: doc.projectName,
    files: doc.files ?? [],
  });
}
