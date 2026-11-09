import "server-only";

export function fileResponse(f: { name: string; type: string; body: Buffer }) {
  return new Response(new Uint8Array(f.body), {
    headers: {
      "Content-Type": f.type,
      "Content-Disposition": `attachment; filename="${f.name.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
