import { NextRequest } from "next/server";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ffmpegStatic from "ffmpeg-static";
import { create as createYtDlp } from "youtube-dl-exec";
import { contentDispositionAttachment } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FFMPEG_PATH: string = (typeof ffmpegStatic === "string" && ffmpegStatic) || process.env.FFMPEG_PATH || "ffmpeg";

const YTDLP_BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH = process.env.YOUTUBE_DL_PATH ?? path.join(process.cwd(), "bin", YTDLP_BIN_NAME);

const FIRST_CHUNK_TIMEOUT_MS = 25_000;

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  let safeBody: string;
  try {
    safeBody = JSON.stringify({ error, ...extra });
  } catch {
    safeBody = JSON.stringify({ error, _note: "extra serialization failed" });
  }
  return new Response(safeBody, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function isValidHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeFilename(name: string, fallback = "video"): string {
  const cleaned = (name || fallback).replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 200);
  return cleaned || fallback;
}

function hintFromStderr(s: string): string | null {
  if (!s) return null;
  if (/403|Forbidden/i.test(s)) return "Upstream 403 — URL muhtemelen expire olmuş, sayfayı yeniden analiz et veya yine dene (lazy refresh aktif).";
  if (/404|Not Found/i.test(s)) return "Upstream 404 — kaynak silinmiş veya URL geçersiz.";
  if (/timed out|timeout/i.test(s)) return "Upstream timeout — daha düşük kalite veya daha kısa video dene.";
  if (/Invalid data found|moov atom not found/i.test(s)) return "Codec/container uyumsuzluğu — başka bir muxOption dene.";
  if (/Could not write header|Could not find codec parameters/i.test(s)) return "Codec mp4 container'a sığmıyor — mkv container dene.";
  return null;
}

// --- GET /api/merge?diag=1 — ffmpeg/yt-dlp ortam teşhisi ---
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("diag") !== "1") {
    return jsonError(400, "Use ?diag=1");
  }
  const out: Record<string, unknown> = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd: process.cwd(),
    tmpdir: os.tmpdir(),
    memoryRss: process.memoryUsage().rss,
    ffmpegStaticRaw: typeof ffmpegStatic === "string" ? ffmpegStatic : `(${typeof ffmpegStatic})`,
    ffmpegPath: FFMPEG_PATH,
    ytdlpPath: YTDLP_PATH,
  };
  try {
    const st = fs.statSync(FFMPEG_PATH);
    out.ffmpegExists = true;
    out.ffmpegSize = st.size;
    out.ffmpegMode = st.mode.toString(8);
  } catch (e: any) {
    out.ffmpegExists = false;
    out.ffmpegStatError = String(e?.message ?? e);
  }
  try {
    const v = spawnSync(FFMPEG_PATH, ["-version"], { timeout: 5000, encoding: "utf8" });
    out.ffmpegVersionExitCode = v.status;
    out.ffmpegVersionStdout = (v.stdout ?? "").slice(0, 300);
    out.ffmpegVersionStderr = (v.stderr ?? "").slice(0, 300);
  } catch (e: any) {
    out.ffmpegVersionError = String(e?.message ?? e);
  }
  try {
    const st = fs.statSync(YTDLP_PATH);
    out.ytdlpExists = true;
    out.ytdlpSize = st.size;
  } catch (e: any) {
    out.ytdlpExists = false;
    out.ytdlpStatError = String(e?.message ?? e);
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// --- yt-dlp ile fresh URL refresh ---
async function refreshUrlsFromYtdlp(
  pageUrl: string,
  videoFormatId: string,
  audioFormatId: string
): Promise<{ videoUrl: string; audioUrl: string } | { error: string }> {
  const ytdlp = createYtDlp(YTDLP_PATH);
  const strategies = [
    ["youtube:player_client=android_vr,web"],
    ["youtube:player_client=tv_embedded,android"],
    ["youtube:player_client=ios,mweb"],
    ["youtube:player_client=web_safari,web"],
  ];
  for (const args of strategies) {
    try {
      const info: any = await ytdlp(pageUrl, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        extractorArgs: args,
      } as any);
      const fmts: any[] = info?.formats ?? [];
      const v = fmts.find((f) => String(f.format_id) === videoFormatId);
      const a = fmts.find((f) => String(f.format_id) === audioFormatId);
      if (v?.url && a?.url) return { videoUrl: v.url, audioUrl: a.url };
    } catch {}
  }
  return { error: "fresh extract format_id eşleşmesi bulunamadı" };
}

export async function POST(req: NextRequest) {
  try {
    let body: {
      videoUrl?: string;
      audioUrl?: string;
      filename?: string;
      container?: string;
      pageUrl?: string;
      videoFormatId?: string;
      audioFormatId?: string;
    };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Geçersiz JSON");
    }

    let videoUrl = body.videoUrl ?? "";
    let audioUrl = body.audioUrl ?? "";
    const container = body.container === "mkv" ? "mkv" : "mp4";
    const filename = sanitizeFilename(body.filename ?? `video.${container}`);

    // Lazy mode: pageUrl + formatId'ler verildiyse fresh URL al
    let refreshAttempted = false;
    let refreshError: string | null = null;
    if (body.pageUrl && body.videoFormatId && body.audioFormatId) {
      refreshAttempted = true;
      const refreshed = await refreshUrlsFromYtdlp(body.pageUrl, body.videoFormatId, body.audioFormatId);
      if ("videoUrl" in refreshed) {
        videoUrl = refreshed.videoUrl;
        audioUrl = refreshed.audioUrl;
      } else {
        refreshError = refreshed.error;
        // fresh fail oldu — cached URL'lere düş (eski videoUrl/audioUrl)
      }
    }

    if (!isValidHttpUrl(videoUrl) || !isValidHttpUrl(audioUrl)) {
      return jsonError(400, "Geçerli videoUrl ve audioUrl gerekli", { refreshAttempted, refreshError });
    }

    if (!FFMPEG_PATH) {
      return jsonError(500, "ffmpeg path resolve edilemedi", { ffmpegStaticType: typeof ffmpegStatic });
    }

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoUrl,
      "-i",
      audioUrl,
      "-c",
      "copy",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-f",
      container === "mkv" ? "matroska" : "mp4",
      ...(container === "mp4" ? ["-movflags", "+frag_keyframe+empty_moov+default_base_moof"] : []),
      "pipe:1",
    ];

    let child;
    try {
      child = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      console.error("[merge] spawn failed:", e);
      return jsonError(500, "ffmpeg spawn başarısız", {
        detail: String(e?.message ?? e),
        ffmpegPath: FFMPEG_PATH,
      });
    }

    let stderrBuf = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderrBuf.length < 8000) {
        try {
          stderrBuf += d.toString("utf8");
        } catch {}
      }
    });
    child.on("error", (err) => {
      console.error("[merge] child error:", err);
    });

    // İlk stdout chunk'a kadar bekle
    const startResult = await new Promise<
      | { type: "data"; chunk: Buffer }
      | { type: "exit"; code: number | null; signal: string | null }
      | { type: "spawnError"; err: any }
      | { type: "timeout" }
    >((resolve) => {
      let settled = false;
      const onData = (chunk: Buffer) => {
        if (settled) return;
        settled = true;
        try { child.stdout.off("data", onData); } catch {}
        resolve({ type: "data", chunk });
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        try { child.stdout.off("data", onData); } catch {}
        resolve({ type: "exit", code, signal: signal ? String(signal) : null });
      };
      const onError = (err: any) => {
        if (settled) return;
        settled = true;
        try { child.stdout.off("data", onData); } catch {}
        resolve({ type: "spawnError", err });
      };
      child.stdout.on("data", onData);
      child.on("exit", onExit);
      child.on("error", onError);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.stdout.off("data", onData); } catch {}
        resolve({ type: "timeout" });
      }, FIRST_CHUNK_TIMEOUT_MS);
    });

    if (startResult.type === "spawnError") {
      return jsonError(500, "ffmpeg başlatılamadı", {
        detail: String(startResult.err?.message ?? startResult.err),
        ffmpegPath: FFMPEG_PATH,
        refreshAttempted,
      });
    }
    if (startResult.type === "exit") {
      try { child.kill("SIGKILL"); } catch {}
      return jsonError(502, "ffmpeg ilk byte üretmeden çıktı", {
        code: startResult.code,
        signal: startResult.signal,
        stderr: stderrBuf.slice(0, 4000),
        hint: hintFromStderr(stderrBuf),
        refreshAttempted,
        refreshError,
      });
    }
    if (startResult.type === "timeout") {
      try { child.kill("SIGKILL"); } catch {}
      return jsonError(504, `ffmpeg ${FIRST_CHUNK_TIMEOUT_MS / 1000}s içinde veri üretemedi`, {
        stderr: stderrBuf.slice(0, 4000),
        hint: "URL expire olmuş veya upstream çok yavaş olabilir.",
        refreshAttempted,
        refreshError,
      });
    }

    const firstChunk = startResult.chunk;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(firstChunk);
        } catch (e) {
          console.error("[merge] enqueue first chunk error:", e);
        }
        child.stdout.on("data", (chunk: Buffer) => {
          try {
            controller.enqueue(chunk);
          } catch (e) {
            console.error("[merge] enqueue error:", e);
          }
        });
        child.stdout.on("end", () => {
          try { controller.close(); } catch {}
        });
        child.stdout.on("error", (err) => {
          console.error("[merge] stdout stream error:", err);
          try { controller.error(err); } catch {}
        });
        child.on("exit", (code) => {
          if (code !== 0 && code !== null) {
            console.error(`[merge] ffmpeg exit ${code}:`, stderrBuf.slice(0, 500));
            try { controller.error(new Error(`ffmpeg exit ${code}`)); } catch {}
          }
        });
      },
      cancel() {
        try { child.kill("SIGKILL"); } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": container === "mkv" ? "video/x-matroska" : "video/mp4",
        "content-disposition": contentDispositionAttachment(filename),
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[merge] uncaught:", e);
    return jsonError(500, "Internal: " + String(e?.message ?? e), {
      name: String(e?.name ?? ""),
      stack: String(e?.stack ?? "").split("\n").slice(0, 8).join("\n"),
    });
  }
}
