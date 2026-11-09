import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/server/uploads";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Serves uploaded product photos. Only server-generated names (uuid.ext) are accepted. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^([0-9a-f-]{36})\.(jpg|png|webp)$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), file));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": TYPES[m[2]], "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
