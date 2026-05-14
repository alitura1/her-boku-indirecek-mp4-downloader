import { NextRequest } from "next/server";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ZipItem = { url: string; filename?: string };

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitize(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 180);
  return cleaned || fallback;
}

export async function POST(req: NextRequest) {
  let body: { items?: ZipItem[]; filename?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Geçersiz JSON" }), { status: 400 });
  }
  const items = (body.items ?? []).filter((it) => isValidHttpUrl(it?.url ?? "")).slice(0, 200);
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "items[] boş" }), { status: 400 });
  }
  const zipName = sanitize(body.filename ?? "gallery.zip", "gallery.zip");

  const { ZipArchive } = await import("archiver");
  const archive: any = new (ZipArchive as any)({ store: true });
  archive.on("warning", () => {});
  archive.on("error", () => {});

  const nodeStream = archive as unknown as Readable;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
  });

  (async () => {
    for (const [i, it] of items.entries()) {
      try {
        const res = await fetch(it.url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
        if (!res.ok || !res.body) continue;
        const ext = (it.url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
        const name = sanitize(it.filename ?? `image-${String(i + 1).padStart(3, "0")}.${ext}`, `image-${i + 1}.${ext}`);
        const nodeBody = Readable.fromWeb(res.body as any);
        archive.append(nodeBody, { name });
        await new Promise<void>((resolve) => nodeBody.on("end", () => resolve()));
      } catch {}
    }
    archive.finalize().catch(() => {});
  })();

  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${zipName}"`,
      "cache-control": "no-store",
    },
  });
}
