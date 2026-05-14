import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/extract": ["./bin/**/*"],
    "/api/merge": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
  serverExternalPackages: ["ffmpeg-static", "youtube-dl-exec", "archiver"],
};

export default nextConfig;
