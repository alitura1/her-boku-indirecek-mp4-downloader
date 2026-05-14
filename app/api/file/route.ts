import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitize(name: string, fallback = "file"): string {
  const cleaned = (name || fallback).replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 200);
  return cleaned || fallback;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const url = sp.get("url") ?? "";
  const filename = sanitize(sp.get("filename") ?? "download", "download");
  if (!isValidHttpUrl(url)) {
    return new Response("Geçersiz URL", { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0", referer: new URL(url).origin },
    });
  } catch (e: any) {
    return new Response("Upstream fetch failed: " + String(e?.message ?? e), { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream HTTP " + upstream.status, { status: 502 });
  }
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { headers });
}
