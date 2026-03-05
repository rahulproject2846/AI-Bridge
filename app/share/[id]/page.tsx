import { connectMongo } from "@/lib/mongodb";
import mongoose from "mongoose";
import Link from "next/link";
import { cookies } from "next/headers";

type Params = { id: string };

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Params }) {
  const { id } = await Promise.resolve(params);
  await connectMongo();
  const db = mongoose.connection.db;
  const doc =
    db &&
    (await db
      .collection<{ shareId: string; projectName: string; files?: { path: string; content: string }[] }>(
        "shares"
      )
      .findOne({ shareId: id }));

  // expiration gate
  const expiresAt = (doc as unknown as { expiresAt?: Date })?.expiresAt;
  if (doc && expiresAt && new Date(expiresAt) <= new Date()) {
    return (
      <main style={{ margin: 0, background: "#fff", color: "#000", padding: "24px 16px", maxWidth: 1200, marginInline: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: 36, margin: "0 0 8px 0" }}>This link has expired</h1>
            <Link href="/" style={{ textDecoration: "underline", color: "#000" }}>Go Home</Link>
          </div>
        </div>
      </main>
    );
  }
  // password gate
  const passwordHash = (doc as unknown as { passwordHash?: string })?.passwordHash;
  if (doc && passwordHash) {
    const c = await cookies();
    const auth = c.get?.(`share_auth_${id}`)?.value;
    if (!auth || auth !== passwordHash) {
      return (
        <main style={{ margin: 0, background: "#fff", color: "#000", padding: "24px 16px", maxWidth: 600, marginInline: "auto" }}>
          <h1 style={{ fontSize: 28, margin: "0 0 16px 0" }}>{doc.projectName}</h1>
          <form method="POST" action="/api/share/auth" style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="shareId" value={id} />
            <input
              type="password"
              name="password"
              placeholder="Enter password"
              style={{ flex: 1, padding: 8, border: "1px solid #000", color: "#000", background: "#fff" }}
            />
            <button type="submit" style={{ padding: "8px 14px", border: "1px solid #000", background: "#fff", color: "#000" }}>
              Unlock
            </button>
          </form>
          <p style={{ marginTop: 8, fontSize: 12, color: "#555" }}>Password required to view files.</p>
        </main>
      );
    }
  }
  const files = doc?.files ?? [];
  const totalCount = files.length;
  const sortedPaths = files.map((f) => f.path).sort((a, b) => a.localeCompare(b));
  const treeText = (() => {
    type Node = { name: string; children: Map<string, Node>; isFile?: boolean };
    const root: Node = { name: "", children: new Map() };
    for (const p of sortedPaths) {
      const parts = p.split("/").filter(Boolean);
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
      const entries = Array.from(node.children.values());
      entries.forEach((child, idx) => {
        const connector = idx === entries.length - 1 ? "\\-- " : "+-- ";
        lines.push(`${prefix}${connector}${child.name}`);
        const nextPrefix = `${prefix}${idx === entries.length - 1 ? "    " : "|   "}`;
        if (child.children.size > 0) walk(child, nextPrefix);
      });
    };
    walk(root, "");
    return lines.join("\n");
  })();
  const techStack = (() => {
    const pkg = files.find((f) => f.path === "package.json");
    if (!pkg) return "Unknown";
    try {
      const json = JSON.parse(pkg.content);
      const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      const keys = Object.keys(deps);
      const hits: string[] = [];
      const check = (name: string, label?: string) =>
        keys.includes(name) && hits.push(label || name);
      check("next", "Next.js");
      check("react", "React");
      check("typescript", "TypeScript");
      check("antd", "Ant Design");
      check("dexie", "Dexie");
      check("mongoose", "Mongoose");
      check("tailwindcss", "TailwindCSS");
      return hits.length ? hits.join(", ") : "Unknown";
    } catch {
      return "Unknown";
    }
  })();
  const fullContent = files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}\n`)
    .join("\n");
  const idFromPath = (p: string) => p.replace(/[^a-zA-Z0-9_-]+/g, "-");

  // page metadata-like header title text is handled via content, but we can also set document.title through Metadata export
  return (
    <main
      style={{
        margin: 0,
        background: "#ffffff",
        color: "#000000",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.5,
        maxWidth: 1200,
        padding: "24px 16px",
        marginInline: "auto",
      }}
    >
      {!doc ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: 36, margin: "0 0 8px 0" }}>404 — Invalid Link</h1>
            <p style={{ margin: "0 0 16px 0" }}>This share link is invalid or has been removed.</p>
            <Link
              href="/"
              style={{
                display: "inline-block",
                padding: "8px 14px",
                border: "1px solid #000",
                color: "#000",
                textDecoration: "none",
                borderRadius: 6,
              }}
            >
              Go Home
            </Link>
          </div>
        </div>
      ) : (doc.files?.length ?? 0) === 0 ? (
        <>
          <h1 style={{ fontSize: 28, margin: "0 0 16px 0" }}>{doc.projectName}</h1>
          <div>No files available for this share.</div>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 28, margin: "0 0 16px 0" }}>{doc.projectName}</h1>
          <section style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Total File Count:</strong> {totalCount}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Technology Stack:</strong> {techStack}
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong>Project Tree:</strong>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#fff",
                color: "#000",
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                overflowX: "auto",
                whiteSpace: "pre",
              }}
            >
              <code>{treeText || "(no files)"}</code>
            </pre>
            <div style={{ marginTop: 12 }}>
              <button
                id="copy-all"
                style={{
                  border: "1px solid #000",
                  background: "#fff",
                  color: "#000",
                  padding: "6px 10px",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
              >
                Copy Full Content
              </button>
            </div>
          </section>
          {/* Hidden buffer for copying */}
          <pre id="copy-buffer" style={{ display: "none" }}>{fullContent}</pre>
          {/* Tiny inline script to copy buffer */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
              (function(){
                var btn = document.getElementById('copy-all');
                if(btn){
                  btn.addEventListener('click', async function(){
                    try{
                      var text = document.getElementById('copy-buffer')?.innerText || '';
                      await navigator.clipboard.writeText(text);
                      btn.innerText = 'Copied!';
                      setTimeout(function(){ btn.innerText = 'Copy Full Content'; }, 1500);
                    }catch(e){
                      btn.innerText = 'Copy failed';
                      setTimeout(function(){ btn.innerText = 'Copy Full Content'; }, 1500);
                    }
                  });
                }
              })();
            `,
            }}
          />
          <div>
            {doc.files?.map((f, i) => (
              <section key={`${f.path}-${i}`} style={{ marginBottom: 24 }}>
                <h2 id={idFromPath(f.path)} style={{ fontWeight: 600, margin: "0 0 8px 0" }}>
                  --- FILE: {f.path} ---
                </h2>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    background: "#fff",
                    color: "#000",
                    border: "1px solid #e5e5e5",
                    borderRadius: 6,
                    overflowX: "auto",
                    whiteSpace: "pre",
                  }}
                >
                  <code>{f.content}</code>
                </pre>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

export async function generateMetadata({ params }: { params: Params }) {
  await connectMongo();
  const db = mongoose.connection.db;
  const doc =
    db &&
    (await db
      .collection<{ shareId: string; projectName: string }>("shares")
      .findOne({ shareId: params.id }));
  const title = doc?.projectName ? `AI-Bridge Share — ${doc.projectName}` : "AI-Bridge Share";
  return {
    title,
    description: "Shared code bundle for AI consumption",
  };
}
