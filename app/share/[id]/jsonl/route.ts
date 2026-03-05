import { NextResponse, NextRequest } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

function headers() {
  return {
    "Content-Type": "application/x-ndjson; charset=utf-8",
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
    const db = mongoose.connection.db;
    if (!db) return new NextResponse("not_found\n", { status: 404, headers: headers() });
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
          projectName: 1,
          "files.path": 1,
          "files.content": 1,
          expiresAt: 1,
          passwordHash: 1,
        },
      }
    );
    if (!doc) return new NextResponse("not_found\n", { status: 404, headers: headers() });
    if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
      return new NextResponse("expired\n", { status: 410, headers: headers() });
    }
    const url = new URL(req.url);
    const providedPassword = url.searchParams.get("password") || undefined;
    if (doc.passwordHash) {
      if (!providedPassword) return new NextResponse("unauthorized\n", { status: 401, headers: headers() });
      const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
      if (hash !== doc.passwordHash) return new NextResponse("unauthorized\n", { status: 401, headers: headers() });
    }
    const files = (doc.files || []).filter((f) => !/\.(png|svg|ico|jpg|jpeg|gif|webp|pdf|zip|mp3|mp4)$/i.test(f.path));
    const excludeParam = url.searchParams.get("exclude") || "";
    const excludeGlobs = excludeParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const globToRegExp = (glob: string) => {
      let s = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      s = s.replace(/\*\*/g, "___GLOBSTAR___");
      s = s.replace(/\*/g, "[^/]*");
      s = s.replace(/___GLOBSTAR___/g, ".*");
      return new RegExp("^" + s + "$", "i");
    };
    const excludeRegexes = excludeGlobs.map(globToRegExp);
    const notExcluded = (p: string) => !excludeRegexes.some((re) => re.test(p));
    const filtered = files.filter((f) => notExcluded(f.path));
    const sorted = [...filtered].sort((a, b) => a.path.localeCompare(b.path));

    let emitList = sorted;
    const chunkStr = url.searchParams.get("chunk");
    const ofStr = url.searchParams.get("of");
    const chunkNum = chunkStr ? Number(chunkStr) : NaN;
    const ofNum = ofStr ? Number(ofStr) : NaN;
    if (Number.isInteger(chunkNum) && Number.isInteger(ofNum) && chunkNum >= 1 && ofNum >= 1 && chunkNum <= ofNum) {
      const per = Math.ceil(sorted.length / ofNum);
      const start = (chunkNum - 1) * per;
      const end = Math.min(sorted.length, start + per);
      emitList = sorted.slice(start, end);
    }
    const resumeAfter = url.searchParams.get("resume_after");
    if (resumeAfter) {
      const idx = emitList.findIndex((f) => f.path === resumeAfter);
      if (idx >= 0) emitList = emitList.slice(idx + 1);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const writeLine = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
        const toc = emitList.map((f) => ({ path: f.path, size: new TextEncoder().encode(f.content).length }));
        writeLine({ type: "header", project: doc.projectName, total: sorted.length, chunk: chunkStr ? Number(chunkStr) : undefined, of: ofStr ? Number(ofStr) : undefined, toc });
        for (const f of emitList) {
          writeLine({ type: "file", path: f.path, content: f.content });
        }
        controller.close();
      },
    });
    return new NextResponse(stream, { status: 200, headers: headers() });
  } catch {
    return new NextResponse("server_error\n", { status: 500, headers: headers() });
  }
}
