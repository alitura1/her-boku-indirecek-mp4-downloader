export type UiFormat = {
  id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  url: string;
  vcodec: string | null;
  acodec: string | null;
  note: string | null;
  kind: "video" | "audio" | "video-only";
  abr: number | null;
  vbr: number | null;
  fps: number | null;
};

export type MuxOption = {
  id: string;
  label: string;
  resolution: string;
  height: number | null;
  filesize: number | null;
  videoUrl: string;
  audioUrl: string;
  videoFormatId: string;
  audioFormatId: string;
  vcodec: string | null;
  acodec: string | null;
  ext: "mp4" | "mkv";
  risk: "high" | null;
};

export type GalleryItem = {
  url: string;
  thumbnail?: string;
  filename: string;
  width?: number;
  height?: number;
  ext: string;
};

export type ResultKind = "media" | "image" | "gallery";

export type ExtractResult = {
  kind: ResultKind;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  webpage_url: string;
  extractor: string;
  formats: UiFormat[];
  muxOptions?: MuxOption[];
  gallery?: GalleryItem[];
};

export function humanSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function humanDuration(sec: number | null | undefined): string {
  if (!sec) return "?";
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function classifyFormat(f: any): UiFormat["kind"] {
  const v = (f.vcodec ?? "none") !== "none";
  const a = (f.acodec ?? "none") !== "none";
  if (v && a) return "video";
  if (v && !a) return "video-only";
  return "audio";
}

export function normalizeFormats(raw: any[]): UiFormat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f.url)
    .map((f): UiFormat => ({
      id: String(f.format_id),
      ext: f.ext ?? "?",
      resolution: f.resolution ?? (f.height ? `${f.height}p` : f.abr ? `${Math.round(f.abr)}kbps` : "?"),
      filesize: f.filesize ?? f.filesize_approx ?? null,
      url: f.url,
      vcodec: f.vcodec ?? null,
      acodec: f.acodec ?? null,
      note: f.format_note ?? null,
      kind: classifyFormat(f),
      abr: f.abr ?? null,
      vbr: f.vbr ?? null,
      fps: f.fps ?? null,
    }))
    .sort((a, b) => {
      const order = { video: 0, "video-only": 1, audio: 2 } as const;
      if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
      const ah = parseInt(a.resolution) || 0;
      const bh = parseInt(b.resolution) || 0;
      return bh - ah;
    });
}
