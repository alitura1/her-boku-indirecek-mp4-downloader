import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { create as createYtDlp } from "youtube-dl-exec";
import { normalizeFormats, type ExtractResult } from "@/lib/formats";
import { extractYoutubeId, isYoutubeUrl, pipedExtract } from "@/lib/piped";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binPath = process.env.YOUTUBE_DL_PATH ?? path.join(process.cwd(), "bin", BIN_NAME);
const youtubedl = createYtDlp(binPath);

const TMP_DIR = process.env.VERCEL ? "/tmp" : os.tmpdir();

const BASE_OPTS = {
  dumpSingleJson: true,
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
  noPlaylist: true,
};

const YT_STRATEGIES = [
  { name: "android_vr", args: ["youtube:player_client=android_vr,web"] },
  { name: "tv_embedded", args: ["youtube:player_client=tv_embedded,android"] },
  { name: "ios_mweb", args: ["youtube:player_client=ios,mweb"] },
  { name: "web_safari", args: ["youtube:player_client=web_safari,web"] },
];

function isLikelyUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type Attempt = { strategy: string; error: string };

function shortErr(e: any): string {
  const raw = String(e?.stderr ?? e?.shortMessage ?? e?.message ?? e?.code ?? e);
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > 400 ? cleaned.slice(0, 400) + "…" : cleaned;
}

function toResult(info: any, fallbackUrl: string): ExtractResult {
  return {
    title: info.title ?? "İsimsiz",
    thumbnail: info.thumbnail ?? null,
    duration: info.duration ?? null,
    webpage_url: info.webpage_url ?? fallbackUrl,
    extractor: info.extractor ?? "unknown",
    formats: normalizeFormats(info.formats ?? []),
  };
}

async function runYtdlp(url: string, extraOpts: Record<string, unknown>) {
  return youtubedl(url, { ...BASE_OPTS, ...extraOpts }) as Promise<any>;
}

export async function POST(req: NextRequest) {
  let body: { url?: string; cookies?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url || !isLikelyUrl(url)) {
    return NextResponse.json({ error: "Geçerli bir http(s) URL gerekli" }, { status: 400 });
  }

  const rawCookies = (body.cookies ?? "").trim();
  const cookies = rawCookies.length > 50 && rawCookies.length < 200_000 ? rawCookies : "";
  const attempts: Attempt[] = [];

  let cookieFile: string | null = null;
  if (cookies) {
    cookieFile = path.join(TMP_DIR, `cookies-${randomUUID()}.txt`);
    try {
      await writeFile(cookieFile, cookies, "utf8");
    } catch (e) {
      cookieFile = null;
      attempts.push({ strategy: "cookies-write", error: shortErr(e) });
    }
  }

  try {
    const isYT = isYoutubeUrl(url);

    if (isYT) {
      const strategies = cookieFile
        ? [
            { name: "cookies-web", args: ["youtube:player_client=web,android_vr"] },
            ...YT_STRATEGIES,
          ]
        : YT_STRATEGIES;

      for (const s of strategies) {
        try {
          const info = await runYtdlp(url, {
            extractorArgs: s.args,
            ...(cookieFile ? { cookies: cookieFile } : {}),
          });
          return NextResponse.json(toResult(info, url));
        } catch (e) {
          attempts.push({ strategy: s.name, error: shortErr(e) });
        }
      }

      if (!cookieFile) {
        const videoId = extractYoutubeId(url);
        if (videoId) {
          const piped = await pipedExtract(videoId, url);
          if ("result" in piped) {
            return NextResponse.json({
              ...piped.result,
              extractor: `youtube (via piped: ${piped.instance.replace(/^https?:\/\//, "")})`,
            });
          }
          attempts.push({ strategy: "piped", error: piped.error });
        }
      }

      return NextResponse.json(
        {
          error: "YouTube çıkartılamadı.",
          attempts,
          hint: cookieFile
            ? "Cookies geçersiz veya video erişilemez (bölge/üyelik kısıtı olabilir)."
            : "Çare: 'İleri ayarlar' altına cookies.txt yapıştır.",
        },
        { status: 502 }
      );
    }

    try {
      const info = await runYtdlp(url, cookieFile ? { cookies: cookieFile } : {});
      return NextResponse.json(toResult(info, url));
    } catch (e) {
      attempts.push({ strategy: "default", error: shortErr(e) });
      return NextResponse.json(
        { error: "Bu URL çıkartılamadı.", attempts },
        { status: 502 }
      );
    }
  } finally {
    if (cookieFile) {
      unlink(cookieFile).catch(() => {});
    }
  }
}
