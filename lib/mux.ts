import type { MuxOption, UiFormat } from "./formats";

function videoHeight(f: UiFormat): number {
  const m = f.resolution.match(/(\d+)(?:p|x(\d+))?/i);
  if (!m) return 0;
  return m[2] ? parseInt(m[2]) : parseInt(m[1]);
}

function isMp4Compatible(vcodec: string | null): boolean {
  if (!vcodec) return false;
  return /^(avc1|h264|hev1|hvc1|av01)/i.test(vcodec);
}

function vcodecPriority(vcodec: string | null): number {
  if (!vcodec) return 99;
  if (/^(avc1|h264)/i.test(vcodec)) return 0;
  if (/^(hev1|hvc1)/i.test(vcodec)) return 1;
  if (/^av01/i.test(vcodec)) return 2;
  return 50;
}

function audioIsAacLike(acodec: string | null): boolean {
  if (!acodec) return false;
  return /(mp4a|aac)/i.test(acodec);
}

function audioScore(f: UiFormat): number {
  const abr = f.abr ?? 0;
  const bonus = audioIsAacLike(f.acodec) ? 50 : 0;
  return abr + bonus;
}

export function buildMuxOptions(formats: UiFormat[]): MuxOption[] {
  const videoOnly = formats.filter((f) => f.kind === "video-only");
  const audios = formats.filter((f) => f.kind === "audio");
  if (videoOnly.length === 0 || audios.length === 0) return [];

  const bestAac = [...audios].filter((a) => audioIsAacLike(a.acodec)).sort((a, b) => audioScore(b) - audioScore(a))[0];
  const bestAny = [...audios].sort((a, b) => audioScore(b) - audioScore(a))[0];
  const audioForMp4 = bestAac ?? bestAny;
  const audioForMkv = bestAny;

  const byHeight = new Map<number, UiFormat>();
  for (const v of videoOnly) {
    const h = videoHeight(v);
    if (!h) continue;
    const existing = byHeight.get(h);
    if (!existing) {
      byHeight.set(h, v);
      continue;
    }
    const existingPrio = vcodecPriority(existing.vcodec);
    const candPrio = vcodecPriority(v.vcodec);
    if (candPrio < existingPrio) byHeight.set(h, v);
    else if (candPrio === existingPrio) {
      const ev = existing.vbr ?? existing.filesize ?? 0;
      const cv = v.vbr ?? v.filesize ?? 0;
      if (cv > ev) byHeight.set(h, v);
    }
  }

  const sortedHeights = [...byHeight.keys()].sort((a, b) => b - a).slice(0, 6);

  const out: MuxOption[] = [];
  for (const h of sortedHeights) {
    const v = byHeight.get(h)!;
    const mp4ok = isMp4Compatible(v.vcodec);
    const ext: "mp4" | "mkv" = mp4ok ? "mp4" : "mkv";
    const audio = ext === "mp4" ? audioForMp4 : audioForMkv;
    if (!audio) continue;
    const totalSize =
      v.filesize && audio.filesize ? v.filesize + audio.filesize : null;
    out.push({
      id: `mux-${v.id}-${audio.id}`,
      label: `${h}p ${ext.toUpperCase()}${v.fps && v.fps > 30 ? ` ${v.fps}fps` : ""}`,
      resolution: `${h}p`,
      height: h,
      filesize: totalSize,
      videoUrl: v.url,
      audioUrl: audio.url,
      videoFormatId: v.id,
      audioFormatId: audio.id,
      vcodec: v.vcodec,
      acodec: audio.acodec,
      ext,
      risk: h >= 1080 ? "high" : null,
    });
  }
  return out;
}
