/**
 * The living background: sky per mood (cross-faded), moon, a distant city,
 * drifting fog, rain, a slow light beam, dust, vignette and film grain.
 * Pure CSS layers animated with transform/opacity only; frozen under
 * prefers-reduced-motion. `lite` drops the heavier layers on phones.
 */
import React from "react";

export type Mood = "lobby" | "dusk" | "night" | "blood" | "dawn" | "day" | "crimson" | "gold";

const MOODS: Mood[] = ["lobby", "dusk", "night", "blood", "dawn", "day", "crimson", "gold"];

// A fixed skyline: [x, width, height] of each building, and which windows glow.
const BUILDINGS: [number, number, number][] = [
  [0, 70, 150], [62, 46, 210], [104, 80, 120], [176, 38, 260], [210, 90, 170], [292, 54, 300], [338, 70, 140],
  [402, 40, 230], [436, 100, 180], [530, 48, 340], [574, 76, 200], [644, 58, 150], [696, 44, 270], [734, 92, 190],
  [820, 52, 240], [866, 80, 130], [940, 40, 290], [974, 96, 175], [1064, 60, 220], [1118, 82, 150], [1194, 48, 260],
  [1236, 100, 185], [1330, 56, 230], [1380, 80, 145], [1452, 48, 205], [1494, 106, 170],
];

function Skyline() {
  const windows: React.ReactElement[] = [];
  BUILDINGS.forEach(([x, w, h], b) => {
    for (let row = 0; row < Math.floor(h / 26); row++) {
      for (let col = 0; col < Math.floor(w / 18); col++) {
        // Deterministic sprinkle of lit windows.
        if ((b * 7 + row * 13 + col * 5) % 11 !== 0) continue;
        windows.push(<rect key={`${b}-${row}-${col}`} x={x + 6 + col * 18} y={400 - h + 12 + row * 26} width={7} height={11} />);
      }
    }
  });
  return (
    <svg className="mf-city" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <g className="mf-city-far">
        {BUILDINGS.map(([x, w, h], i) => (
          <rect key={i} x={x + 30} y={400 - h * 0.7 - 30} width={w} height={h * 0.7 + 30} />
        ))}
      </g>
      <g className="mf-city-near">
        {BUILDINGS.map(([x, w, h], i) => (
          <rect key={i} x={x} y={400 - h} width={w} height={h} />
        ))}
        <rect x={548} y={400 - 380} width={6} height={44} />
        <rect x={312} y={400 - 330} width={4} height={34} />
      </g>
      <g className="mf-city-windows">{windows}</g>
    </svg>
  );
}

export function Scene({ mood, lite = false }: { mood: Mood; lite?: boolean }) {
  return (
    <div className={`mf-scene ${lite ? "is-lite" : ""}`} data-mood={mood} aria-hidden>
      {MOODS.map((m) => (
        <div key={m} className={`mf-sky mf-sky-${m}`} />
      ))}
      <div className="mf-moon" />
      {!lite && <div className="mf-beam" />}
      <Skyline />
      <div className="mf-fog mf-fog-1" />
      {!lite && <div className="mf-fog mf-fog-2" />}
      {!lite && <div className="mf-rain" />}
      {!lite && <div className="mf-dust" />}
      <div className="mf-vignette" />
      <div className="mf-grain" />
    </div>
  );
}
