/** Public URL for a product photo: uploaded files are served from /media, fixtures from /fixtures. */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("/fixtures/")) return path;
  return `/media/${encodeURIComponent(path)}`;
}
