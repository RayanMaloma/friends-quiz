import type { Viewport } from "next";
import localFont from "next/font/local";
import "./invent.css";

/** «اخترع إجابتك» screens (host + phones). The dark look is scoped to this route; display type is Thmanyah, like Mafia. */

// Same Thmanyah Serif Display files as the Mafia screens (bundled unmodified through the build).
const thmanyah = localFont({
  variable: "--iv-thmanyah",
  src: [
    { path: "../mafia/fonts/thmanyahserifdisplay-Medium.otf", weight: "500", style: "normal" },
    { path: "../mafia/fonts/thmanyahserifdisplay-Bold.otf", weight: "700", style: "normal" },
    { path: "../mafia/fonts/thmanyahserifdisplay-Black.otf", weight: "900", style: "normal" },
  ],
  display: "swap",
  fallback: ["Tahoma", "serif"],
});

export const viewport: Viewport = {
  themeColor: "#0e0f13",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function InventLayout({ children }: { children: React.ReactNode }) {
  return <div className={thmanyah.variable}>{children}</div>;
}
