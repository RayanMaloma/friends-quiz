import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/brand";

// The link preview (WhatsApp, X, iMessage…): the logo and the tagline, generated at build time.

export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#20163a";
const DOTS: [string, number, number, number][] = [
  // color, left, top, size
  ["#ff4f8b", 70, 60, 70],
  ["#3e82ff", 1080, 70, 54],
  ["#16c47b", 90, 520, 48],
  ["#8a5cff", 1060, 500, 80],
  ["#ff8a3d", 580, 40, 34],
];

export default async function OpengraphImage() {
  const lalezar = await readFile(path.join(process.cwd(), "assets/fonts/Lalezar-Regular.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff4de",
          color: INK,
          fontFamily: "Lalezar",
          position: "relative",
        }}
      >
        {DOTS.map(([color, left, top, d]) => (
          <div
            key={color}
            style={{
              position: "absolute",
              left,
              top,
              width: d,
              height: d,
              borderRadius: d,
              background: color,
              border: `5px solid ${INK}`,
            }}
          />
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 0, fontSize: 120, lineHeight: 1 }}>
          <div style={{ display: "flex", transform: "rotate(2deg)" }}>المقيمين</div>
          <div
            style={{
              display: "flex",
              transform: "rotate(-6deg)",
              background: "#ffc72c",
              border: `8px solid ${INK}`,
              borderRadius: 28,
              boxShadow: `10px 10px 0 ${INK}`,
              padding: "28px 24px 8px",
            }}
          >
            استراحة
          </div>
        </div>
        {/* The renderer lays words out left to right: one box per word, reversed, keeps Arabic order. */}
        <div style={{ display: "flex", flexDirection: "row-reverse", gap: 0, marginTop: 70, fontSize: 52, color: "#6e6585" }}>
          {SITE_DESCRIPTION.split(" ").map((word, i) => (
            <div key={i} style={{ display: "flex" }}>
              {word}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Lalezar", data: lalezar, weight: 400, style: "normal" }] },
  );
}
