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

export async function POST(req: NextRequest) {
  let body: { videoUrl?: string; audioUrl?: string; filename?: string; container?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Geçersiz JSON" }), { status: 400 });
  }
  const videoUrl = body.videoUrl ?? "";
  const audioUrl = body.audioUrl ?? "";
  const container = body.container === "mkv" ? "mkv" : "mp4";
  if (!isValidHttpUrl(videoUrl) || !isValidHttpUrl(audioUrl)) {
    return new Response(JSON.stringify({ error: "Geçerli videoUrl ve audioUrl gerekli" }), { status: 400 });
  }
  const filename = sanitizeFilename(body.filename ?? `video.${container}`);

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

  const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    if (stderrBuf.length < 4000) stderrBuf += d.toString();
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      child.stdout.on("end", () => controller.close());
      child.stdout.on("error", (err) => controller.error(err));
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
