import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { create as createYtDlp } from "youtube-dl-exec";
import { normalizeFormats, type ExtractResult } from "@/lib/formats";

const BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binPath =
  process.env.YOUTUBE_DL_PATH ??
  path.join(process.cwd(), "bin", BIN_NAME);

const youtubedl = createYtDlp(binPath);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isLikelyUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url || !isLikelyUrl(url)) {
    return NextResponse.json({ error: "Geçerli bir http(s) URL gerekli" }, { status: 400 });
  }

  try {
    const info: any = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noPlaylist: true,
      addHeader: [
        "referer:youtube.com",
        "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ],
    });

    const result: ExtractResult = {
      title: info.title ?? "İsimsiz",
      thumbnail: info.thumbnail ?? null,
      duration: info.duration ?? null,
      webpage_url: info.webpage_url ?? url,
      extractor: info.extractor ?? "unknown",
      formats: normalizeFormats(info.formats ?? []),
    };

    return NextResponse.json(result);
  } catch (e: any) {
    const detail =
      [e?.stderr, e?.stdout, e?.shortMessage, e?.message, e?.code]
        .filter(Boolean)
        .map(String)
        .join(" | ") || String(e);
    const isYoutube = /youtu/i.test(url);
    return NextResponse.json(
      {
        error: isYoutube
          ? "YouTube çıkartılamadı. Vercel datacenter IP'leri YouTube tarafından bloklanıyor — self-host (Docker) önerilir."
          : "Bu URL çıkartılamadı.",
        detail,
      },
      { status: 502 }
    );
  }
}
