export function contentDispositionAttachment(filename: string): string {
  const ascii =
    filename
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\\r\n]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "download";
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
