import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "her boku indirecek mp4 downloader",
  description: "YouTube, TikTok, X, Instagram, Reddit, Facebook ve daha fazlasından video / ses indir. Açık kaynak, yt-dlp tabanlı.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
