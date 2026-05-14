import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ffmpegPath: string = (ffmpegStatic as unknown as string) || "ffmpeg";

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

const FIRST_CHUNK_TIMEOUT_MS = 25_000;

export async function POST(req: NextRequest) {
  let body: { videoUrl?: string; audioUrl?: string; filename?: string; container?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Geçersiz JSON");
  }
  const videoUrl = body.videoUrl ?? "";
  const audioUrl = body.audioUrl ?? "";
  const container = body.container === "mkv" ? "mkv" : "mp4";
  if (!isValidHttpUrl(videoUrl) || !isValidHttpUrl(audioUrl)) {
    return jsonError(400, "Geçerli videoUrl ve audioUrl gerekli");
  }
  const filename = sanitizeFilename(body.filename ?? `video.${container}`);

  if (!ffmpegPath) {
    return jsonError(500, "ffmpeg binary path resolve edilemedi", { ffmpegPath: String(ffmpegStatic) });
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
    child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    return jsonError(500, "ffmpeg spawn başarısız", { detail: String(e?.message ?? e), ffmpegPath });
  }

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    if (stderrBuf.length < 8000) stderrBuf += d.toString();
  });

  // İlk stdout chunk'a kadar bekle — önce gelen sinyale göre 200 stream ya da JSON hata döndür
  const startResult = await new Promise<
    | { type: "data"; chunk: Buffer }
    | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
    | { type: "spawnError"; err: any }
    | { type: "timeout" }
  >((resolve) => {
    let settled = false;
    const onData = (chunk: Buffer) => {
      if (settled) return;
      settled = true;
      child.stdout.off("data", onData);
      resolve({ type: "data", chunk });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      child.stdout.off("data", onData);
      resolve({ type: "exit", code, signal });
    };
    const onError = (err: any) => {
      if (settled) return;
      settled = true;
      child.stdout.off("data", onData);
      resolve({ type: "spawnError", err });
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
    child.on("error", onError);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.stdout.off("data", onData);
      resolve({ type: "timeout" });
    }, FIRST_CHUNK_TIMEOUT_MS);
  });

  if (startResult.type === "spawnError") {
    return jsonError(500, "ffmpeg başlatılamadı", {
      detail: String(startResult.err?.message ?? startResult.err),
      ffmpegPath,
    });
  }
  if (startResult.type === "exit") {
    try {
      child.kill("SIGKILL");
    } catch {}
    return jsonError(502, "ffmpeg ilk byte üretmeden çıktı", {
      code: startResult.code,
      signal: startResult.signal,
      stderr: stderrBuf.slice(0, 4000),
      hint: hintFromStderr(stderrBuf),
    });
  }
  if (startResult.type === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {}
    return jsonError(504, `ffmpeg ${FIRST_CHUNK_TIMEOUT_MS / 1000}s içinde veri üretemedi`, {
      stderr: stderrBuf.slice(0, 4000),
      hint: "URL expire olmuş veya upstream çok yavaş olabilir — yeniden analiz et.",
    });
  }

  const firstChunk = startResult.chunk;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(firstChunk));
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      child.stdout.on("end", () => controller.close());
      child.stdout.on("error", (err) => {
        try {
          controller.error(err);
        } catch {}
      });
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          try {
            controller.error(new Error(`ffmpeg exit ${code}: ${stderrBuf.slice(0, 500)}`));
          } catch {}
        }
      });
    },
    cancel() {
      try {
        child.kill("SIGKILL");
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": container === "mkv" ? "video/x-matroska" : "video/mp4",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function hintFromStderr(s: string): string | null {
  if (!s) return null;
  if (/403|Forbidden/i.test(s)) return "Upstream 403 — URL muhtemelen expire olmuş, sayfayı yeniden analiz et.";
  if (/404|Not Found/i.test(s)) return "Upstream 404 — kaynak silinmiş veya URL geçersiz.";
  if (/timed out|timeout/i.test(s)) return "Upstream timeout — daha düşük kalite veya daha kısa video dene.";
  if (/Invalid data found|moov atom not found/i.test(s)) return "Codec/container uyumsuzluğu — başka bir muxOption dene.";
  if (/Could not write header|Could not find codec parameters/i.test(s)) return "Codec mp4 container'a sığmıyor — mkv container kullan veya başka format seç.";
  return null;
}
