import type { Viewport } from "next";
import localFont from "next/font/local";
import "./mafia.css";

/** Mafia screens (TV + phones). The noir look and the Thmanyah font are scoped to this route; the rest of the site keeps its theme. */

// Thmanyah Serif Display (ثمانية): Arabic, Latin and both digit sets in one family.
// Bundled unmodified through the build (hashed, preloaded); see the font's license before redistributing.
const thmanyah = localFont({
  variable: "--mf-thmanyah",
  src: [
    { path: "./fonts/thmanyahserifdisplay-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/thmanyahserifdisplay-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahserifdisplay-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/thmanyahserifdisplay-Black.otf", weight: "900", style: "normal" },
  ],
  display: "swap",
  fallback: ["Tahoma", "serif"],
});

export const viewport: Viewport = {
  themeColor: "#08090B",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function MafiaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${thmanyah.variable} mf-fonts`}>{children}</div>;
}
