// Builds-time fetcher: indirir Linux/Windows/macOS yt-dlp binary'sini bin/ klasörüne
// outputFileTracingIncludes bunu Vercel function bundle'ına dahil eder.
import { mkdir, chmod, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "bin");

const VERSION = process.env.YTDLP_VERSION || "latest";
const base =
  VERSION === "latest"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
    : `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}`;
const platform = process.platform;

const targets = {
  linux: { name: "yt-dlp", url: `${base}/yt-dlp_linux` },
  darwin: { name: "yt-dlp_macos", url: `${base}/yt-dlp_macos` },
  win32: { name: "yt-dlp.exe", url: `${base}/yt-dlp.exe` },
};

// Vercel her zaman Linux, dolayısıyla deploy ortamında Linux binary'sini de garanti et.
// Local dev için de host platform binary'si.
const toFetch = new Set([targets.linux]);
if (targets[platform]) toFetch.add(targets[platform]);

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(url, dest) {
  console.log(`[fetch-ytdlp] ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  try { await chmod(dest, 0o755); } catch {}
  console.log(`[fetch-ytdlp] -> ${dest}`);
}

await mkdir(binDir, { recursive: true });

for (const t of toFetch) {
  const dest = path.join(binDir, t.name);
  if (await exists(dest)) {
    console.log(`[fetch-ytdlp] cached: ${dest}`);
    continue;
  }
  await download(t.url, dest);
}

console.log("[fetch-ytdlp] done");
