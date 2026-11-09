import type { Metadata, Viewport } from "next";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nursery", template: "%s · Nursery" },
  description: "Plants, pots and garden supplies",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#215C39" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
