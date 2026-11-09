import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // Lets e2e tests build into a separate folder without disturbing `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["pg", "bwip-js", "pdf-lib", "@pdf-lib/fontkit"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages may not be framed by other sites; label PDFs may be framed by our own preview.
      { source: "/((?!api/labels).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      { source: "/api/labels/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
    ];
  },
};
export default config;
