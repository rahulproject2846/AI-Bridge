import { NextResponse, NextRequest } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { sha256Hex } from "@/lib/hash";

export const dynamic = "force-dynamic";

function headers() {
  return {
    "Content-Type": "application/json; charset=utf-8",
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
    if (!db) return new NextResponse(JSON.stringify({ error: "not_found" }), { status: 404, headers: headers() });
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
    if (!doc) return new NextResponse(JSON.stringify({ error: "not_found" }), { status: 404, headers: headers() });
    if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
      return new NextResponse(JSON.stringify({ error: "expired" }), { status: 410, headers: headers() });
    }
    const url = new URL(req.url);
    const providedPassword = url.searchParams.get("password") || undefined;
    if (doc.passwordHash) {
      if (!providedPassword) return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: headers() });
      const hash = await sha256Hex(providedPassword);
      if (hash !== doc.passwordHash) return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: headers() });
    }
    const files = (doc.files || []).filter(
      (f) => !/\.(png|svg|ico)$/i.test(f.path)
    );
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    // Build compact tree lines
    type Node = { name: string; children: Map<string, Node>; isFile?: boolean };
    const root: Node = { name: "", children: new Map() };
    for (const f of sorted) {
      const parts = f.path.split("/").filter(Boolean);
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (!cur.children.has(part)) {
          cur.children.set(part, { name: part, children: new Map() });
        }
        const child = cur.children.get(part)!;
        if (i === parts.length - 1) child.isFile = true;
        cur = child;
      }
    }
    const lines: string[] = [];
    const walk = (node: Node, prefix: string) => {
      const entries = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
      entries.forEach((child, idx) => {
        const isLast = idx === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        lines.push(prefix + connector + child.name + (child.isFile ? "" : "/"));
        if (child.children.size > 0) {
          const nextPrefix = prefix + (isLast ? "    " : "│   ");
          walk(child, nextPrefix);
        }
      });
    };
    walk(root, "");
    const tree = lines;
    const payload = {
      project: doc.projectName,
      tree,
      files: sorted.map(({ path, content }) => ({ path, content })),
    };
    return new NextResponse(JSON.stringify(payload), { status: 200, headers: headers() });
  } catch {
    return new NextResponse(JSON.stringify({ error: "server_error" }), { status: 500, headers: headers() });
  }
}
