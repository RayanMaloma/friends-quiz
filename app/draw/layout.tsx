import type { Viewport } from "next";
import "./draw.css";

/** «وزارة المقيمين للفنون والرسم» screens (host + phones). The official look is scoped to this route. */

export const viewport: Viewport = {
  themeColor: "#0b3d2e",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // The keyboard shrinks the page instead of covering the guess box.
  interactiveWidget: "resizes-content",
};

export default function DrawLayout({ children }: { children: React.ReactNode }) {
  return children;
}
