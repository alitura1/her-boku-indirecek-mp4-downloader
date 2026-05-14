import type { ExtractResult, GalleryItem } from "./formats";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "tiff", "heic"];

export function looksLikeImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    return IMAGE_EXTS.some((e) => path.endsWith(`.${e}`));
  } catch {
    return false;
  }
}

export function filenameFromUrl(url: string, fallbackExt = "jpg"): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
    if (last) return `${decodeURIComponent(last)}.${fallbackExt}`;
    return `image.${fallbackExt}`;
  } catch {
    return `image.${fallbackExt}`;
  }
}

export function extFromContentType(ct: string | null): string {
  if (!ct) return "jpg";
  const m = ct.match(/image\/([a-z0-9+.-]+)/i);
  if (!m) return "jpg";
  const e = m[1].toLowerCase();
  if (e === "jpeg") return "jpg";
  if (e === "svg+xml") return "svg";
  return e;
}

export async function probeImage(url: string, timeoutMs = 5000): Promise<{ contentType: string | null; size: number | null } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctl.signal,
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    const len = res.headers.get("content-length");
    return { contentType: ct, size: len ? parseInt(len) : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function tryDirectImage(url: string): Promise<ExtractResult | null> {
  if (!looksLikeImageUrl(url)) {
    const probe = await probeImage(url);
    if (!probe || !probe.contentType?.startsWith("image/")) return null;
    return makeImageResult(url, probe.contentType, probe.size);
  }
  const probe = await probeImage(url);
  const ct = probe?.contentType ?? null;
  return makeImageResult(url, ct, probe?.size ?? null);
}

function makeImageResult(url: string, contentType: string | null, size: number | null): ExtractResult {
  const ext = extFromContentType(contentType);
  const filename = filenameFromUrl(url, ext);
  const item: GalleryItem = {
    url,
    thumbnail: url,
    filename,
    ext,
  };
  return {
    kind: "image",
    title: filename,
    thumbnail: url,
    duration: null,
    webpage_url: url,
    extractor: "direct image",
    formats: [],
    gallery: [item],
  };
}

function pickImageThumb(thumbs: any[] | undefined): string | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  const sorted = [...thumbs]
    .filter((t) => t.url)
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return sorted[0]?.url ?? null;
}

function entryHasOnlyImageFormats(entry: any): boolean {
  const fmts = entry?.formats ?? [];
  if (fmts.length === 0) {
    return !!(entry?.thumbnails || entry?.thumbnail || entry?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i));
  }
  return fmts.every((f: any) => /image|jpeg|png|webp|gif/i.test(f.ext ?? "") || (f.vcodec === "none" && f.acodec === "none"));
}

export function detectGalleryFromYtdlp(info: any): GalleryItem[] | null {
  if (!info) return null;
  const entries: any[] = info.entries ?? [];
  if (info._type !== "playlist" && info._type !== "multi_video" && entries.length === 0) {
    if (info._type === undefined && (info.formats?.length ?? 0) === 0 && info.thumbnail) {
      const ext = info.thumbnail.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "jpg";
      return [
        {
          url: info.thumbnail,
          thumbnail: info.thumbnail,
          filename: `${(info.title ?? "image").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100)}.${ext}`,
          ext,
        },
      ];
    }
    return null;
  }
  const items: GalleryItem[] = [];
  for (const [i, e] of entries.entries()) {
    if (!entryHasOnlyImageFormats(e)) continue;
    const imgUrl: string | null =
      e.url && /^https?:\/\//.test(e.url) ? e.url : pickImageThumb(e.thumbnails) ?? e.thumbnail ?? null;
    if (!imgUrl) continue;
    const ext = imgUrl.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "jpg";
    items.push({
      url: imgUrl,
      thumbnail: pickImageThumb(e.thumbnails) ?? imgUrl,
      filename: `${(e.title ?? `image-${i + 1}`).replace(/[/\\?%*:|"<>]/g, "_").slice(0, 80)}.${ext}`,
      width: e.width,
      height: e.height,
      ext,
    });
  }
  return items.length > 0 ? items : null;
}
