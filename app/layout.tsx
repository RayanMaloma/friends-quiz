import type { Metadata, Viewport } from "next";
import { Cairo, Lalezar } from "next/font/google";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/brand";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
});

// Chunky display face for titles, names, codes and buttons.
const lalezar = Lalezar({
  variable: "--font-lalezar",
  subsets: ["arabic", "latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { title: SITE_NAME, description: SITE_DESCRIPTION, siteName: SITE_NAME, locale: "ar_SA", type: "website" },
  twitter: { card: "summary", title: SITE_NAME, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#fff4de",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${lalezar.variable} h-full antialiased`}>
      <body className="stage-bg min-h-full">{children}</body>
    </html>
  );
}
