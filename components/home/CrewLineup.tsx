import type { CSSProperties } from "react";
import { Img } from "@/components/Media";

type Member = { id: string; name: string; image: string };

/**
 * The whole group standing together on the home screen.
 *
 * One set of portraits, three arrangements picked by CSS (no duplicate images):
 * a 3-row pyramid on phones, two staggered rows on tablets, and one arched row
 * on laptops / TVs / landscape phones. Every slot is computed here as % of the
 * lineup box, so the layout scales fluidly and nothing shifts while images load.
 */

/** Left → right on screen. Each person faces / looks toward the middle; Khalid points at you from the centre. */
const ORDER = [
  "qadibi",
  "abu-qasim",
  "yazid",
  "fahad-aldaham",
  "khalid",
  "fahad-alnahid",
  "ibrahim-altamimi",
  "rayan",
  "chinese",
];

/** Portrait box is 5 wide × 6 tall; images are contained and sit on its bottom edge. */
const BOX_RATIO = 6 / 5;

type Layout = {
  /** Number of rows (front row is the widest; each row behind has one fewer). */
  rows: number;
  /** Portrait width relative to its slot (>1 = neighbours overlap). */
  spread: number;
  /** How far each back row is raised, as a fraction of a portrait's height. */
  step: number;
  /** Biggest scale in the middle of the front row (1 = flat row). */
  arc: number;
};

const LAYOUTS = {
  p: { rows: 3, spread: 1.3, step: 0.56, arc: 1 },
  t: { rows: 2, spread: 1.3, step: 0.52, arc: 1 },
  d: { rows: 1, spread: 1.52, step: 0, arc: 1.14 },
} satisfies Record<string, Layout>;

type Slot = { x: number; row: number };

const pct = (n: number) => `${+(n * 100).toFixed(3)}%`;

/** Row sizes for a pyramid of `rows` rows holding `n` people (front row first). */
function rowSizes(n: number, rows: number) {
  const front = Math.ceil((n + (rows * (rows - 1)) / 2) / rows);
  const sizes = Array.from({ length: rows }, (_, r) => Math.max(0, front - r));
  let extra = sizes.reduce((a, b) => a + b, 0) - n;
  for (let r = rows - 1; extra > 0 && r >= 0; r--) {
    const take = Math.min(extra, sizes[r]);
    sizes[r] -= take;
    extra -= take;
  }
  return sizes;
}

/**
 * Places `n` people. Returns the box's height/width ratio and, per person (in
 * ORDER, i.e. left → right), the CSS custom properties for that layout.
 */
function place(n: number, key: string, l: Layout) {
  const sizes = rowSizes(n, l.rows);
  const front = sizes[0];
  const unit = 1 / (2 * front); // slots are 2 units wide; back rows sit half a slot in
  const w = 2 * unit * l.spread;
  const h = w * BOX_RATIO; // in widths of the whole lineup
  const height = h * (l.arc + l.step * (l.rows - 1));

  // Every slot, sorted left → right so people keep their side in every layout.
  const slots: Slot[] = sizes
    .flatMap((k, row) => Array.from({ length: k }, (_, i) => ({ x: (front - k + 2 * i + 1) * unit, row })))
    .sort((a, b) => a.x - b.x || b.row - a.row);

  const items = slots.map(({ x, row }) => {
    const off = Math.abs(x - 0.5) / 0.5; // 0 centre … 1 edge
    const scale = l.arc === 1 ? 1 : l.arc - (l.arc - 0.9) * off ** 1.4;
    return {
      [`--${key}-l`]: pct(x - w / 2),
      [`--${key}-b`]: pct((row * l.step * h) / height),
      [`--${key}-w`]: pct(w),
      [`--${key}-s`]: +scale.toFixed(3),
      [`--${key}-z`]: (l.rows - row) * 20 + Math.round(10 - off * 10),
      off,
    };
  });
  return { ratio: 1 / height, items };
}

export function CrewLineup({ people }: { people: Member[] }) {
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  const crew = people.filter((p) => p.image).sort((a, b) => rank(a.id) - rank(b.id));
  if (crew.length === 0) return null;

  const layouts = Object.entries(LAYOUTS).map(([key, l]) => ({ key, ...place(crew.length, key, l) }));
  const boxStyle = Object.fromEntries(layouts.map(({ key, ratio }) => [`--${key}-ratio`, +ratio.toFixed(4)])) as CSSProperties;

  return (
    <div className="crew-stage">
      <div aria-hidden className="crew-ground" />
      <ul className="crew" style={boxStyle} aria-label="الشلّة">
        {crew.map((person, i) => {
          const vars = Object.assign({}, ...layouts.map((l) => l.items[i]));
          const { off, ...style } = vars;
          return (
            <li key={person.id} className="crew-item" style={style as CSSProperties}>
              <div className="crew-fig anim-portrait" style={{ animationDelay: `${150 + Math.round(off * 450)}ms` }}>
                <Img
                  src={person.image}
                  alt={person.name}
                  sizes="(min-width: 1024px) 18vw, (min-width: 600px) 30vw, 34vw"
                  priority
                  className="object-contain object-bottom"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
