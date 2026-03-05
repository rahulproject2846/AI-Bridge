import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }
    const target = `http://localhost:3000/share/${encodeURIComponent(id)}`;
    const res = await fetch(target, { cache: "no-store" });
    const text = await res.text();
    return NextResponse.json({
      ok: res.ok,
      startsWithProject: text.startsWith("# Project:"),
      length: text.length,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

