import { NextResponse, NextRequest } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { ShareDoc } from "@/models/Share";
import { filterTextFiles } from "@/lib/vault";
import path from "node:path";

export const dynamic = "force-dynamic";

function headers() {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
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
    const col = db.collection<ShareDoc>("shares");
    const doc = await col.findOne({ shareId });
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

    // Filter out binary files and log size
    const filteredFiles = filterTextFiles(doc.files || []);
    const totalSize = new TextEncoder().encode(JSON.stringify(filteredFiles)).length;
    
    // Log size warning if over 4MB
    if (totalSize > 4 * 1024 * 1024) {
      console.warn(`CRITICAL_SIZE_WARNING: Generated markdown is ${totalSize} bytes, exceeds 4MB limit`);
    }

    // Generate file tree
    const sorted = filteredFiles.sort((a, b) => a.path.localeCompare(b.path));
    type Node = { name: string; children: Map<string, Node>; isFile?: boolean };
    const root: Node = { name: "", children: new Map() };
    for (const f of sorted) {
      if (excludeRegexes.some(regex => regex.test(f.path))) continue;
      const parts = f.path.split("/").filter(Boolean);
      let cur = root;
      for (const part of parts) {
        if (!cur.children.has(part)) cur.children.set(part, { name: part, children: new Map() });
        cur = cur.children.get(part)!;
      }
      cur.isFile = true;
    }
    const walk = (node: Node, prefix: string = ""): string[] => {
      const entries = Array.from(node.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const lines: string[] = [];
      entries.forEach(([name, child], idx) => {
        const isLast = idx === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        lines.push(prefix + connector + name + (child.isFile ? "" : "/"));
        if (child.children.size > 0) {
          lines.push(...walk(child, prefix + (isLast ? "    " : "│   ")));
        }
      });
      return lines;
    };
    const treeText = walk(root).join("\n");

    // Build complete markdown string for AI crawlers (buffered response)
    let markdown = `---
AI_INSTRUCTIONS: You are a senior software architect. Analyze this entire codebase. It is a VS Vault Pro project. Focus on the file paths provided.
---

# Project: ${doc.projectName}

## File Structure

${treeText || "(no files)"}

## Table of Contents

`;
    
    for (const f of filteredFiles) {
      const size = new TextEncoder().encode(f.content).length;
      markdown += `- ${f.path} (${size} bytes)\n`;
    }
    markdown += "\n";
    
    for (const f of filteredFiles) {
      const fence = extToFence(f.path);
      markdown += `### File: ${f.path}\n`;
      markdown += "```" + fence + "\n";
      markdown += f.content + "\n";
      markdown += "```\n\n";
    }

    return new NextResponse(markdown, { status: 200, headers: headers() });
  } catch {
    return new NextResponse("Server error", { status: 500, headers: headers() });
  }
}

function extToFence(path: string) {
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
}
