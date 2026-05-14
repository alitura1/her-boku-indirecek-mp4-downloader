"use client";

import { useState } from "react";
import type { ExtractResult, UiFormat } from "@/lib/formats";
import { humanDuration, humanSize } from "@/lib/formats";

type Tab = "video" | "video-only" | "audio";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractResult | null>(null);
  const [tab, setTab] = useState<Tab>("video");

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Bilinmeyen hata");
      } else {
        setData(json);
        if (!json.formats.some((f: UiFormat) => f.kind === "video")) {
          setTab(json.formats.some((f: UiFormat) => f.kind === "video-only") ? "video-only" : "audio");
        }
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }

  const filtered = data?.formats.filter((f) => f.kind === tab) ?? [];
  const counts = {
    video: data?.formats.filter((f) => f.kind === "video").length ?? 0,
    "video-only": data?.formats.filter((f) => f.kind === "video-only").length ?? 0,
    audio: data?.formats.filter((f) => f.kind === "audio").length ?? 0,
  };

  return (
    <main className="min-h-screen px-4 py-10 md:py-16 max-w-4xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          her boku indirecek <span className="text-accent">mp4 downloader</span>
        </h1>
        <p className="mt-3 text-sm md:text-base text-white/60">
          YouTube · TikTok · X · Instagram · Reddit · Facebook · Twitch · Vimeo · 1000+ site. yt-dlp tabanlı, açık kaynak.
        </p>
      </header>

      <form onSubmit={analyze} className="flex flex-col md:flex-row gap-3 mb-8">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
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

      {error && (
        <div className="border border-red-500/40 bg-red-500/10 text-red-200 rounded-lg p-4 mb-6">
          <div className="font-semibold mb-1">Hata</div>
          <div className="text-sm">{error}</div>
          <div className="text-xs text-white/50 mt-2">
            YouTube hatası mı aldın? Vercel'in datacenter IP'leri YouTube tarafından bloklanıyor.{" "}
            <a
              className="underline text-accent"
              href="https://github.com/alitura1/her-boku-indirecek-mp4-downloader#self-host"
              target="_blank"
              rel="noreferrer"
            >
              Self-host rehberi
            </a>
            .
          </div>
        </div>
      )}

      {data && (
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
                <span>{data.formats.length} format</span>
              </div>
            </div>
          </div>

          <div className="flex gap-1 border-b border-white/10 mb-4 text-sm">
            {(["video", "video-only", "audio"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 -mb-px border-b-2 transition ${
                  tab === t
                    ? "border-accent text-white"
                    : "border-transparent text-white/50 hover:text-white/80"
                }`}
              >
                {t === "video" ? "Video+Ses" : t === "video-only" ? "Sadece video" : "Sadece ses"}{" "}
                <span className="text-white/30">({counts[t]})</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
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
            İpucu: bazı kaynaklar dosyayı tarayıcıda açabilir. Açıldıysa videoya sağ tık → "Video farklı kaydet".
          </p>
        </section>
      )}

      <footer className="mt-16 pt-6 border-t border-white/10 text-xs text-white/40 flex flex-col md:flex-row justify-between gap-3">
        <div>
          MIT lisansı · yt-dlp tabanlı · sadece kişisel kullanım. Telif hakkı ihlali yapmayın.
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
