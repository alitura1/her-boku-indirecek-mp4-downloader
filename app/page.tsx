"use client";

import { useState } from "react";
import type { ExtractResult, MuxOption, UiFormat } from "@/lib/formats";
import { humanDuration, humanSize } from "@/lib/formats";

type Tab = "video" | "video-only" | "audio" | "mux";

export default function Home() {
  const [url, setUrl] = useState("");
  const [cookies, setCookies] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{ strategy: string; error: string }[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [data, setData] = useState<ExtractResult | null>(null);
  const [tab, setTab] = useState<Tab>("mux");
  const [muxing, setMuxing] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<{
    msg: string;
    stderr?: string;
    hint?: string;
    code?: number | null;
  } | null>(null);
  const [zipping, setZipping] = useState(false);

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setAttempts([]);
    setHint(null);
    setData(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), cookies: cookies.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Bilinmeyen hata");
        if (Array.isArray(json.attempts)) setAttempts(json.attempts);
        if (json.hint) setHint(json.hint);
      } else {
        setData(json);
        if (json.kind === "media") {
          const hasMuxed = (json.formats ?? []).some((f: UiFormat) => f.kind === "video");
          const hasMuxOpts = (json.muxOptions?.length ?? 0) > 0;
          if (hasMuxed) setTab("video");
          else if (hasMuxOpts) setTab("mux");
          else if ((json.formats ?? []).some((f: UiFormat) => f.kind === "video-only")) setTab("video-only");
          else setTab("audio");
        }
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  async function downloadMuxed(opt: MuxOption) {
    if (!data) return;
    setMuxing(opt.id);
    setMergeError(null);
    try {
      const safeTitle = (data.title || "video").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100);
      const filename = `${safeTitle}-${opt.resolution}.${opt.ext}`;
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          videoUrl: opt.videoUrl,
          audioUrl: opt.audioUrl,
          filename,
          container: opt.ext,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMergeError({
          msg: j.error || `HTTP ${res.status}`,
          stderr: j.stderr,
          hint: j.hint,
          code: j.code,
        });
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e: any) {
      setMergeError({ msg: "Network/Browser hatası: " + String(e?.message ?? e) });
    } finally {
      setMuxing(null);
    }
  }

  async function downloadGalleryZip() {
    if (!data?.gallery?.length) return;
    setZipping(true);
    try {
      const safeTitle = (data.title || "gallery").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 100);
      const filename = `${safeTitle}.zip`;
      const res = await fetch("/api/zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename,
          items: data.gallery.map((g) => ({ url: g.url, filename: g.filename })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e: any) {
      alert("ZIP başarısız: " + String(e?.message ?? e));
    } finally {
      setZipping(false);
    }
  }

  function fileProxyHref(itemUrl: string, filename: string) {
    return `/api/file?url=${encodeURIComponent(itemUrl)}&filename=${encodeURIComponent(filename)}`;
  }

  const formats = data?.formats ?? [];
  const muxOptions = data?.muxOptions ?? [];
  const counts = {
    video: formats.filter((f) => f.kind === "video").length,
    "video-only": formats.filter((f) => f.kind === "video-only").length,
    audio: formats.filter((f) => f.kind === "audio").length,
    mux: muxOptions.length,
  };
  const filtered = tab === "mux" ? [] : formats.filter((f) => f.kind === tab);

  return (
    <main className="min-h-screen px-4 py-10 md:py-16 max-w-4xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          her boku indirecek <span className="text-accent">mp4 downloader</span>
        </h1>
        <p className="mt-3 text-sm md:text-base text-white/60">
          Video · Ses · Görsel · Galeri. YouTube/TikTok/X/Instagram/Reddit/Pinterest + 1000 site. yt-dlp tabanlı, açık kaynak.
        </p>
      </header>

      <form onSubmit={analyze} className="flex flex-col md:flex-row gap-3 mb-8">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Video, ses veya görsel URL'si yapıştır..."
          required
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-accent transition placeholder:text-white/30 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-lg px-6 py-3 transition"
        >
          {loading ? "Analiz ediliyor..." : "Analiz et"}
        </button>
      </form>

      <details className="mb-8 border border-white/10 rounded-lg bg-white/[0.02] open:bg-white/[0.03]">
        <summary className="cursor-pointer px-4 py-3 text-sm text-white/70 select-none hover:text-white">
          İleri ayarlar (YouTube bot kontrolüne takılıyorsa)
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-2">
          <textarea
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder="cookies.txt içeriği (Netscape format). Chrome/Firefox için 'Get cookies.txt LOCALLY' eklentisinden youtube.com cookies'ini export edip buraya yapıştır."
            rows={4}
            className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-xs font-mono outline-none focus:border-accent placeholder:text-white/30"
          />
          <p className="text-xs text-white/40">
            Cookies sadece bu istek için kullanılır, sunucuda saklanmaz.
          </p>
        </div>
      </details>

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded-lg p-4 mb-6">
          <div className="font-semibold mb-1">Hata</div>
          <div className="text-sm">{error}</div>
          {hint && <div className="text-xs text-white/60 mt-2">{hint}</div>}
          {attempts.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-white/50 cursor-pointer select-none hover:text-white/70">
                Denemeler ({attempts.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs font-mono text-white/50">
                {attempts.map((a, i) => (
                  <li key={i} className="break-all">
                    <span className="text-accent/80">{a.strategy}</span>: {a.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {data && (data.kind === "image" || data.kind === "gallery") && (
        <section className="border border-white/10 rounded-xl p-5 bg-white/[0.02]">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold break-words">{data.title}</h2>
              <div className="text-xs text-white/50 mt-1">
                {data.extractor} · {data.gallery?.length ?? 0} {data.kind === "image" ? "görsel" : "görsel"}
              </div>
            </div>
            {data.gallery && data.gallery.length > 1 && (
              <button
                onClick={downloadGalleryZip}
                disabled={zipping}
                className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-black font-semibold rounded-lg px-4 py-2 text-sm transition whitespace-nowrap"
              >
                {zipping ? "ZIP hazırlanıyor..." : "Hepsini ZIP indir"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(data.gallery ?? []).map((g, i) => (
              <div key={i} className="border border-white/10 rounded-lg overflow-hidden bg-black/20">
                <img
                  src={g.thumbnail ?? g.url}
                  alt={g.filename}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />
                <a
                  href={fileProxyHref(g.url, g.filename)}
                  className="block text-center text-xs bg-accent text-black font-semibold py-2 hover:bg-accent/90 transition"
                  download={g.filename}
                >
                  İndir
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && data.kind === "media" && (
        <section className="border border-white/10 rounded-xl p-5 bg-white/[0.02]">
          <div className="flex flex-col md:flex-row gap-5 mb-5">
            {data.thumbnail && (
              <img
                src={data.thumbnail}
                alt=""
                className="w-full md:w-48 h-auto rounded-lg border border-white/10 object-cover"
              />
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg md:text-xl font-semibold break-words">{data.title}</h2>
              <div className="text-xs text-white/50 mt-2 space-x-3">
                <span>{data.extractor}</span>
                <span>{humanDuration(data.duration)}</span>
                <span>{formats.length} format</span>
              </div>
            </div>
          </div>

          <div className="flex gap-1 border-b border-white/10 mb-4 text-sm overflow-x-auto">
            {(["mux", "video", "video-only", "audio"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 -mb-px border-b-2 transition whitespace-nowrap ${
                  tab === t
                    ? "border-accent text-white"
                    : "border-transparent text-white/50 hover:text-white/80"
                }`}
              >
                {t === "mux"
                  ? "Video+Ses (birleştir)"
                  : t === "video"
                  ? "Video+Ses (hazır)"
                  : t === "video-only"
                  ? "Sadece video"
                  : "Sadece ses"}{" "}
                <span className="text-white/30">({counts[t]})</span>
              </button>
            ))}
          </div>

          {tab === "mux" && mergeError && (
            <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded-lg p-4 mb-4">
              <div className="font-semibold mb-1">Birleştirme başarısız</div>
              <div className="text-sm">{mergeError.msg}</div>
              {mergeError.code !== undefined && mergeError.code !== null && (
                <div className="text-xs text-white/50 mt-1">ffmpeg exit code: {mergeError.code}</div>
              )}
              {mergeError.hint && <div className="text-xs text-white/70 mt-2">{mergeError.hint}</div>}
              {mergeError.stderr && (
                <details className="mt-3">
                  <summary className="text-xs text-white/50 cursor-pointer select-none hover:text-white/70">
                    ffmpeg stderr
                  </summary>
                  <pre className="mt-2 text-xs font-mono text-white/60 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {mergeError.stderr}
                  </pre>
                </details>
              )}
            </div>
          )}

          {tab === "mux" ? (
            muxOptions.length === 0 ? (
              <div className="text-sm text-white/40 py-6 text-center">
                Birleştirilecek video-only + audio kombinasyonu bulunamadı.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-white/40 text-xs uppercase">
                    <tr>
                      <th className="py-2 pr-3">Kalite</th>
                      <th className="py-2 pr-3">Konteyner</th>
                      <th className="py-2 pr-3">Codec</th>
                      <th className="py-2 pr-3">Boyut</th>
                      <th className="py-2 pr-3 text-right">İndir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {muxOptions.map((m) => (
                      <tr key={m.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 pr-3 font-mono">{m.label}</td>
                        <td className="py-2 pr-3 uppercase font-mono text-white/70">{m.ext}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-white/50">
                          {[m.vcodec, m.acodec].filter((c) => c && c !== "none").join(" / ") || "—"}
                        </td>
                        <td className="py-2 pr-3 font-mono text-white/60">{humanSize(m.filesize)}</td>
                        <td className="py-2 pr-3 text-right">
                          <button
                            onClick={() => downloadMuxed(m)}
                            disabled={muxing !== null}
                            className="inline-block bg-accent text-black font-semibold rounded px-3 py-1 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {muxing === m.id ? "Birleştiriliyor..." : "Birleştir & İndir"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-white/40 mt-3">
                  Sunucu video+ses stream'lerini ffmpeg ile remux ederek tek dosya halinde indirir. Uzun videolarda 60s timeout'a takılabilir; o durumda daha düşük kalite seç.
                </p>
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="text-sm text-white/40 py-6 text-center">Bu kategoride format yok.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-white/40 text-xs uppercase">
                  <tr>
                    <th className="py-2 pr-3">Kalite</th>
                    <th className="py-2 pr-3">Format</th>
                    <th className="py-2 pr-3">Codec</th>
                    <th className="py-2 pr-3">Boyut</th>
                    <th className="py-2 pr-3 text-right">İndir</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-3 font-mono">
                        {f.resolution}
                        {f.fps ? ` ${f.fps}fps` : ""}
                        {f.note ? <span className="text-white/40"> · {f.note}</span> : ""}
                      </td>
                      <td className="py-2 pr-3 uppercase font-mono text-white/70">{f.ext}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-white/50">
                        {[f.vcodec, f.acodec].filter((c) => c && c !== "none").join(" / ") || "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-white/60">{humanSize(f.filesize)}</td>
                      <td className="py-2 pr-3 text-right">
                        <a
                          href={f.url}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block bg-accent text-black font-semibold rounded px-3 py-1 hover:bg-accent/90 transition"
                        >
                          İndir
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-white/40 mt-4">
            İpucu: URL'ler dakikalar/saatler içinde expire olur. İndirmeyi geciktirme. Tarayıcıda açılırsa videoya sağ tık → "Video farklı kaydet".
          </p>
        </section>
      )}

      <footer className="mt-16 pt-6 border-t border-white/10 text-xs text-white/40 flex flex-col md:flex-row justify-between gap-3">
        <div>
          MIT lisansı · yt-dlp + ffmpeg tabanlı · sadece kişisel kullanım. Telif hakkı ihlali yapmayın.
        </div>
        <a
          href="https://github.com/alitura1/her-boku-indirecek-mp4-downloader"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white underline"
        >
          GitHub
        </a>
      </footer>
    </main>
  );
}
