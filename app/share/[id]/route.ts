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
    if (!db) {
      return new NextResponse("Not Found", { status: 404, headers: headers() });
    }
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
    if (!doc) {
      return new NextResponse("Not Found", { status: 404, headers: headers() });
    }
    if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
      return new NextResponse("Expired", { status: 410, headers: headers() });
    }
    const url = new URL(req.url);
    const providedPassword = url.searchParams.get("password") || undefined;
    if (doc.passwordHash) {
      if (!providedPassword) {
        return new NextResponse("Unauthorized", { status: 401, headers: headers() });
      }
      const hash = crypto.createHash("sha256").update(providedPassword).digest("hex");
      if (hash !== doc.passwordHash) {
        return new NextResponse("Unauthorized", { status: 401, headers: headers() });
      }
    }

    // Apply sane default excludes
    const defaultExcludes = [".env", "node_modules", ".next", "dist", ".git", "*.png", "*.svg", "*.ico", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.pdf", "*.zip", "*.mp3", "*.mp4"];
    const excludeParam = url.searchParams.get("exclude") || "";
    const excludeGlobs = [
      ...defaultExcludes,
      ...excludeParam.split(",").map((s) => s.trim()).filter(Boolean)
    ];
    const globToRegExp = (glob: string) => {
      let s = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      s = s.replace(/\*\*/g, "___GLOBSTAR___");
      s = s.replace(/\*/g, "[^/]*");
      s = s.replace(/___GLOBSTAR___/g, ".*");
      return new RegExp("^" + s + "$", "i");
    };
    const excludeRegexes = excludeGlobs.map(globToRegExp);
    const notExcluded = (p: string) => !excludeRegexes.some((re) => re.test(p));
    const files = (doc.files || []).filter((f: { path: string }) => notExcluded(f.path));
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

    // Build tree from filtered list
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
    const treeText = lines.join("\n");

    const extToFence = (path: string) => {
      const lower = path.toLowerCase();
      const map: Record<string, string> = {
        ".ts": "typescript",
        ".tsx": "tsx",
        ".js": "javascript",
        ".jsx": "jsx",
        ".json": "json",
        ".css": "css",
        ".scss": "scss",
        ".md": "markdown",
        ".py": "python",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
        ".kt": "kotlin",
        ".swift": "swift",
        ".rb": "ruby",
        ".php": "php",
        ".sh": "bash",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".toml": "toml",
        ".xml": "xml",
        ".sql": "sql",
        ".c": "c",
        ".cpp": "cpp",
        ".h": "c",
        ".hpp": "cpp",
      };
      const idx = lower.lastIndexOf(".");
      return idx >= 0 ? map[lower.slice(idx)] || "" : "";
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const write = (s: string) => controller.enqueue(enc.encode(s));
        const TIMEOUT_MS = 12000;
        const startTime = Date.now();
        
        write(`# Project: ${doc.projectName}\n\n`);
        write("## File Structure\n\n");
        write((treeText || "(no files)") + "\n\n");
        write("## Table of Contents\n\n");
        
        // Stream files one by one to avoid memory buildup
        for (let i = 0; i < sorted.length; i++) {
          if (Date.now() - startTime > TIMEOUT_MS) {
            write("\n--- STREAM TIMEOUT (Vercel Limit Reached) ---\n");
            controller.close();
            return;
          }
          const f = sorted[i];
          const size = new TextEncoder().encode(f.content).length;
          write(`- ${f.path} (${size} bytes)\n`);
          
          // Force garbage collection every 10 files
          if (i % 10 === 0) {
            if (global.gc) global.gc();
          }
        }
        write("\n");
        
        for (let i = 0; i < sorted.length; i++) {
          if (Date.now() - startTime > TIMEOUT_MS) {
            write("\n--- STREAM TIMEOUT (Vercel Limit Reached) ---\n");
            controller.close();
            return;
          }
          const f = sorted[i];
          const fence = extToFence(f.path);
          write(`### File: ${f.path}\n`);
          write("```" + fence + "\n");
          write(f.content + "\n");
          write("```\n\n");
          
          // Force garbage collection every 5 files
          if (i % 5 === 0) {
            if (global.gc) global.gc();
          }
        }
        
        controller.close();
      },
    });

    return new NextResponse(stream, { status: 200, headers: headers() });
  } catch {
    return new NextResponse("Server error", { status: 500, headers: headers() });
  }
}
