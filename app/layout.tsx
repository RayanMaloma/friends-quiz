import type { Metadata, Viewport } from "next";
import { Cairo, Lalezar } from "next/font/google";
import "./globals.css";

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
  title: "عن مين؟",
  description: "لعبة الشلة: خمّن المعلومة عن مين",
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
