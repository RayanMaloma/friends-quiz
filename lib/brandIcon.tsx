import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/** The square logo mark (browser tab, home-screen icon): «اس» on the yellow chip of the logo. */
export async function brandIcon(px: number, rounded: boolean) {
  const lalezar = await readFile(path.join(process.cwd(), "assets/fonts/Lalezar-Regular.ttf"));
  const ink = "#20163a";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffc72c",
          border: `${Math.round(px * 0.07)}px solid ${ink}`,
          borderRadius: rounded ? px * 0.24 : 0,
          color: ink,
          fontFamily: "Lalezar",
          fontSize: px * 0.62,
          lineHeight: 1,
          paddingTop: px * 0.12,
        }}
      >
        اس
      </div>
    ),
    { width: px, height: px, fonts: [{ name: "Lalezar", data: lalezar, weight: 400, style: "normal" }] },
  );
}
