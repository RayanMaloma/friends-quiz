import type { Metadata, Viewport } from "next";
import "./outage.css";

/** «انقطاع الاتصال» screens (TV + phones). The control-room look is scoped to this route. */

export const metadata: Metadata = { title: "انقطاع الاتصال" };

export const viewport: Viewport = {
  themeColor: "#05080f",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function OutageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
