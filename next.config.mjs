import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/extract": ["./node_modules/youtube-dl-exec/bin/**/*"],
  },
};

export default nextConfig;
