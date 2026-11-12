import type { Viewport } from "next";
import "./court.css";

/** «المحكمة» screens (host + phones). The courtroom look is scoped to this route. */

export const viewport: Viewport = {
  themeColor: "#2a160e",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function CourtLayout({ children }: { children: React.ReactNode }) {
  return children;
}
