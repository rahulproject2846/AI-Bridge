import { NextResponse, NextRequest } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

function headers() {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "Allow": "GET, OPTIONS",
    "User-Agent": "*",
    "X-Robots-Tag": "noindex, nofollow",
  } as Record<string, string>;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: headers() });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await connectMongo();
    const { id: shareId } = await ctx.params;
    const url = new URL(req.url);
    const filePath = url.searchParams.get("path");
    if (!filePath) return new NextResponse("Missing path", { status: 400, headers: headers() });
    if (/\.(png|svg|ico|jpg|jpeg|gif|webp|pdf|zip|mp3|mp4)$/i.test(filePath)) {
      return new NextResponse("Unsupported binary file", { status: 415, headers: headers() });
    }
    const db = mongoose.connection.db;
    if (!db) return new NextResponse("Not Found", { status: 404, headers: headers() });
    const col = db.collection<{
      shareId: string;
      projectName: string;
      files: { path: string; content: string }[];
      updatedAt: Date;
      expiresAt?: Date;
      passwordHash?: string;
    }>("shares");
    const doc = await col.findOne(
      { shareId },
      {
        projection: {
          _id: 0,
          "files.path": 1,
          "files.content": 1,
          expiresAt: 1,
          passwordHash: 1,
        },
      }
    );
    if (!doc) return new NextResponse("Not Found", { status: 404, headers: headers() });
    if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
      return new NextResponse("Expired", { status: 410, headers: headers() });
    }
    const providedPassword = url.searchParams.get("password") || undefined;
    if (doc.passwordHash) {
      if (!providedPassword) return new NextResponse("Unauthorized", { status: 401, headers: headers() });
      const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
      if (hash !== doc.passwordHash) return new NextResponse("Unauthorized", { status: 401, headers: headers() });
    }
    const file = (doc.files || []).find((f) => f.path === filePath);
    if (!file) return new NextResponse("Not Found", { status: 404, headers: headers() });
    return new NextResponse(file.content, { status: 200, headers: headers() });
  } catch {
    return new NextResponse("Server error", { status: 500, headers: headers() });
  }
}

