import type { ExtractResult, UiFormat } from "./formats";

const STATIC_PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://api-piped.mha.fi",
];

const INSTANCE_TIMEOUT_MS = 6000;
const LIST_TIMEOUT_MS = 4000;
const LIST_TTL_MS = 5 * 60 * 1000;

let cachedList: { at: number; instances: string[] } | null = null;

async function fetchLiveInstances(): Promise<string[]> {
  const now = Date.now();
  if (cachedList && now - cachedList.at < LIST_TTL_MS) return cachedList.instances;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch("https://piped-instances.kavin.rocks/", { signal: ctl.signal });
    if (!res.ok) throw new Error("list http " + res.status);
    const json = (await res.json()) as Array<{ api_url?: string; uptime_24h?: number }>;
    const urls = json
      .filter((x) => x.api_url && (x.uptime_24h ?? 0) > 90)
      .map((x) => x.api_url!.replace(/\/$/, ""));
    if (urls.length === 0) throw new Error("empty list");
    cachedList = { at: now, instances: urls };
    return urls;
  } catch {
    return STATIC_PIPED_INSTANCES;
  } finally {
    clearTimeout(timer);
  }
}

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (!/(^|\.)youtube\.com$/.test(host) && host !== "m.youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const shortsMatch = u.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = u.pathname.match(/^\/embed\/([^/?#]+)/);
    if (embedMatch) return embedMatch[1];
    return null;
  } catch {
    return null;
  }
}

export function isYoutubeUrl(url: string): boolean {
  return extractYoutubeId(url) !== null;
}

type PipedStream = {
  url: string;
  format?: string;
  quality?: string;
  mimeType?: string;
  codec?: string;
  videoOnly?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  contentLength?: number;
};

type PipedResponse = {
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  videoStreams?: PipedStream[];
  audioStreams?: PipedStream[];
  error?: string;
  message?: string;
};

async function fetchInstance(base: string, videoId: string): Promise<PipedResponse | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), INSTANCE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/streams/${videoId}`, {
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as PipedResponse;
    if (json.error || (!json.videoStreams && !json.audioStreams)) return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function streamToUiFormat(s: PipedStream, idx: number): UiFormat {
  const ext = (s.format ?? s.mimeType?.split("/")[1] ?? "?").toLowerCase().replace(/^webm.*/, "webm");
  const hasVideo = !!(s.width || s.height) || /video/i.test(s.mimeType ?? "");
  const hasAudio = !s.videoOnly && (/audio/i.test(s.mimeType ?? "") || (!hasVideo));
  let kind: UiFormat["kind"];
  if (hasVideo && hasAudio) kind = "video";
  else if (hasVideo) kind = "video-only";
  else kind = "audio";
  const resolution = s.height
    ? `${s.width ?? "?"}x${s.height}`
    : s.quality ?? (s.bitrate ? `${Math.round(s.bitrate / 1000)}kbps` : "?");
  return {
    id: `piped-${idx}-${s.quality ?? s.height ?? s.bitrate ?? "x"}`,
    ext,
    resolution,
    filesize: s.contentLength ?? null,
    url: s.url,
    vcodec: hasVideo ? (s.codec ?? null) : null,
    acodec: hasAudio ? (s.codec ?? null) : null,
    note: s.quality ?? null,
    kind,
    abr: !hasVideo && s.bitrate ? Math.round(s.bitrate / 1000) : null,
    vbr: hasVideo && s.bitrate ? Math.round(s.bitrate / 1000) : null,
    fps: s.fps ?? null,
  };
}

export async function pipedExtract(
  videoId: string,
  webpageUrl: string
): Promise<{ result: ExtractResult; instance: string } | { error: string }> {
  const errors: string[] = [];
  const live = await fetchLiveInstances();
  const order = [...live].sort(() => Math.random() - 0.5).slice(0, 5);
  for (const base of order) {
    const data = await fetchInstance(base, videoId);
    if (!data) {
      errors.push(`${base}: down/no-data`);
      continue;
    }
    const videoFmts = (data.videoStreams ?? []).map((s, i) => streamToUiFormat(s, i));
    const audioFmts = (data.audioStreams ?? []).map((s, i) =>
      streamToUiFormat({ ...s, videoOnly: false }, 1000 + i)
    );
    const formats = [...videoFmts, ...audioFmts].sort((a, b) => {
      const order = { video: 0, "video-only": 1, audio: 2 } as const;
      if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
      const ah = parseInt(a.resolution) || 0;
      const bh = parseInt(b.resolution) || 0;
      return bh - ah;
    });
    if (formats.length === 0) {
      errors.push(`${base}: empty formats`);
      continue;
    }
    return {
      instance: base,
      result: {
        kind: "media",
        title: data.title ?? "İsimsiz",
        thumbnail: data.thumbnailUrl ?? null,
        duration: data.duration ?? null,
        webpage_url: webpageUrl,
        extractor: "youtube (via piped)",
        formats,
      },
    };
  }
  return { error: `Tüm Piped instance'ları başarısız: ${errors.join("; ")}` };
}
