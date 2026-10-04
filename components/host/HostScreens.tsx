"use client";

import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import type { HostView, LeaderboardEntry } from "@/lib/types";
import { personName } from "@/lib/people";
import { SWATCHES } from "@/lib/colors";
import { isLongFact, pointsLabel, tvFactFontSize } from "@/lib/format";
import { Portrait } from "@/components/PersonImage";
import { Confetti, NameBadge } from "@/components/ui";

// ---------------------------------------------------------------------------
// LOBBY — room code, big QR right under it, live list of player names.
// No portraits here: nobody gets a preview of the fact owners.
// ---------------------------------------------------------------------------

export function HostLobby({ view }: { view: HostView }) {
  const [qrSvg, setQrSvg] = useState("");
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    const url = `${window.location.origin}/join?code=${view.code}`;
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#20163a", light: "#ffffff" },
    })
      .then((svg) => {
        if (!alive) return;
        setQrSvg(svg);
        setIsLocalhost(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view.code]);

  const players = view.players;
  const n = players.length;
  const chipSize =
    n <= 12 ? "h-[8.5vh] text-[3.6vh]" : n <= 20 ? "h-[6.6vh] text-[2.8vh]" : "h-[5.2vh] text-[2.2vh]";
  const badgeSize =
    n <= 12 ? "size-[6vh] text-[3.2vh]" : n <= 20 ? "size-[4.6vh] text-[2.4vh]" : "size-[3.6vh] text-[1.9vh]";

  return (
    <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] gap-[4vw]">
      {/* Code + QR */}
      <section className="anim-rise flex min-h-0 flex-col items-center justify-center gap-[2vh]">
        <p className="font-display text-[4.4vh] leading-none">رمز الدخول</p>
        <div dir="ltr" className="flex gap-[1vw]">
          {view.code.split("").map((d, i) => {
            const sw = SWATCHES[i % SWATCHES.length];
            return (
              <span
                key={i}
                className={`chunk-tv anim-pop grid h-[15vh] w-[11vh] place-items-center font-display text-[11vh] leading-none ${sw.bg} ${sw.fg}`}
                style={{ animationDelay: `${i * 90}ms`, rotate: `${[-4, 3, -2, 4][i % 4]}deg` }}
              >
                <span className="pt-[1.6vh]">{d}</span>
              </span>
            );
          })}
        </div>
        <div className="chunk-tv mt-[1vh] aspect-square h-[44vh] rotate-1 bg-white p-[1.4vh]">
          <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </div>
        <p className="font-display text-[3vh] text-mute">امسح الكود بالجوال 📱</p>
        {isLocalhost && (
          <p className="chunk-sm max-w-[34vw] bg-pink px-4 py-2 text-[1.8vh] font-bold text-white">
            انتبه: الصفحة مفتوحة على localhost — الجوالات ما بتقدر تدخل. افتحها من عنوان الشبكة (IP) أو رابط Vercel.
          </p>
        )}
      </section>

      {/* Players */}
      <section className="flex min-h-0 flex-col gap-[2.4vh] pt-[2vh]">
        <div className="flex items-center gap-[1.4vw]">
          <h2 className="font-display text-[6vh] leading-none">مين داخل؟</h2>
          <span
            key={n}
            className="chunk-tv anim-pop grid h-[8vh] min-w-[8vh] place-items-center bg-sun px-[1.4vh] font-display text-[5.4vh] leading-none"
          >
            <span className="pt-[1vh]">{n}</span>
          </span>
        </div>
        {n === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="anim-wiggle font-display text-[5vh] text-mute">مستنين أول واحد يدخل… 👀</p>
          </div>
        ) : (
          <ul className="no-scrollbar flex min-h-0 flex-wrap content-start gap-[1.4vh] overflow-y-auto px-[0.5vw] pb-[1.5vh] pt-[0.5vh]">
            {players.map((p, i) => (
              <li
                key={p.playerId}
                className={`chunk-sm anim-pop flex items-center gap-[0.8vw] bg-card pe-[1.4vw] ps-[0.6vh] ${chipSize} ${
                  p.active ? "" : "opacity-50"
                }`}
                style={{ rotate: `${[-1.5, 1, -0.5, 1.5][i % 4]}deg` }}
              >
                <NameBadge playerId={p.playerId} name={p.name} className={badgeSize} />
                <span className="max-w-[22vw] truncate pt-[0.6vh] font-display leading-none">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QUESTION
// ---------------------------------------------------------------------------

export function HostQuestion({ view }: { view: HostView }) {
  const q = view.question!;
  const long = isLongFact(q.factText);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-[3vh]">
      <QuestionPill index={q.index} total={view.totalQuestions} />
      <div className="flex min-h-0 w-full flex-1 items-center justify-center pb-[1vh] pt-[2vh]">
        <div
          key={q.index}
          className={`chunk-tv anim-pop relative flex max-h-full max-w-[88vw] bg-card px-[4vw] py-[4vh] ${
            long ? "" : "-rotate-1"
          }`}
        >
          <span className="chunk-sm absolute -top-[3.4vh] start-[3vw] grid size-[6.8vh] rotate-6 place-items-center bg-pink font-display text-[5vh] text-white">
            <span className="pt-[1vh]">؟</span>
          </span>
          <p
            className={`no-scrollbar max-h-full overflow-y-auto ${
              long ? "text-start font-bold leading-[1.6]" : "text-center font-display leading-[1.35] text-balance"
            }`}
            style={{ fontSize: tvFactFontSize(q.factText) }}
          >
            {q.factText}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AnswerProgress({ answered, eligible }: { answered: number; eligible: number }) {
  const all = eligible > 0 && answered >= eligible;
  const pct = eligible > 0 ? Math.min(100, (answered / eligible) * 100) : 0;
  return (
    <div className="flex items-center gap-[1.4vw]">
      <div className="chunk-sm h-[4.4vh] w-[22vw] overflow-hidden bg-card p-[0.5vh]">
        <div className="h-full rounded-[0.8vh] bg-mint transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="pt-[0.8vh] font-display text-[4.6vh] leading-none tabular-nums">
        <span className={all ? "text-mint" : ""}>{answered}</span>
        <span className="text-mute"> / {eligible}</span> جاوبوا
      </p>
      {all && (
        <span className="chunk-sm anim-pop bg-mint px-[1vw] pb-[0.4vh] pt-[1vh] font-display text-[3vh] leading-none">
          الكل جاوب ✓
        </span>
      )}
    </div>
  );
}

function QuestionPill({ index, total }: { index: number; total: number }) {
  return (
    <div className="flex flex-col items-center gap-[1.4vh]">
      <span className="chunk-sm bg-sun px-[2vw] pb-[0.4vh] pt-[1.2vh] font-display text-[3.4vh] leading-none">
        السؤال {index + 1} من {total}
      </span>
      <div className="flex gap-[0.4vw]">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-[1.2vh] w-[2.4vw] rounded-full border-2 border-ink ${
              i < index ? "bg-ink" : i === index ? "bg-pink" : "bg-card"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// REVEAL — the big moment: the owner's portrait appears.
// ---------------------------------------------------------------------------

export function HostReveal({ view }: { view: HostView }) {
  const r = view.reveal!;
  const max = Math.max(1, ...r.distribution.map((d) => d.count));
  const missing = Math.max(0, r.eligibleCount - r.answeredCount);

  let verdict: string;
  if (r.eligibleCount === 0) verdict = "ما كان فيه أحد يجاوب";
  else if (r.correctCount === 0) verdict = "ولا أحد عرفها 😮";
  else if (r.correctCount === r.eligibleCount) verdict = "الكل عرفها 🔥";
  else verdict = `${r.correctCount} من ${r.eligibleCount} عرفوها`;

  return (
    <div key={r.index} className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-[3vw]">
      <PortraitStage personId={r.ownerPersonId} />

      <div className="flex min-h-0 flex-col justify-center gap-[2.2vh]">
        <div>
          <span className="chunk-sm anim-fade inline-block -rotate-2 bg-card px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3.4vh] leading-none">
            كانت عن…
          </span>
          <h2
            className="anim-pop mt-[1.4vh] font-display text-[13vh] leading-[1.05] [text-shadow:0_0.8vh_0_var(--color-sun)]"
            style={{ animationDelay: "350ms" }}
          >
            {personName(r.ownerPersonId)}
          </h2>
        </div>
        <p className="line-clamp-2 text-[2.5vh] font-bold leading-relaxed text-mute">«{r.factText}»</p>
        <div className="anim-rise flex items-center gap-[1vw]" style={{ animationDelay: "600ms" }}>
          <span className="chunk-tv bg-mint px-[1.4vw] pb-[0.4vh] pt-[1.4vh] font-display text-[4.6vh] leading-none">
            {verdict}
          </span>
          {missing > 0 && r.eligibleCount > 0 && (
            <span className="text-[2.4vh] font-bold text-mute">({missing} ما جاوبوا)</span>
          )}
        </div>

        <div className="flex flex-col gap-[1.2vh]">
          {r.distribution.length === 0 && (
            <p className="text-[2.6vh] font-bold text-mute">ما أحد جاوب على هذي</p>
          )}
          {r.distribution.map((d, i) => {
            const correct = d.personId === r.ownerPersonId;
            return (
              <div
                key={d.personId}
                className="anim-rise flex items-center gap-[1vw]"
                style={{ animationDelay: `${750 + i * 110}ms` }}
              >
                <span className="w-[12vw] truncate pt-[0.6vh] font-display text-[3.2vh] leading-none">
                  {correct && "✓ "}
                  {personName(d.personId)}
                </span>
                <div className="chunk-sm h-[4.4vh] flex-1 overflow-hidden bg-card p-[0.4vh]">
                  <div
                    className={`anim-bar h-full rounded-[0.7vh] ${correct ? "bg-sun" : "bg-pink/70"}`}
                    style={{ width: `${(d.count / max) * 100}%`, animationDelay: `${850 + i * 110}ms` }}
                  />
                </div>
                <span className="w-[3vw] pt-[0.6vh] font-display text-[4vh] leading-none tabular-nums">{d.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PortraitStage({ personId, delay = 0 }: { personId: string; delay?: number }) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden border-b-[0.7vh] border-ink">
      <div className="absolute inset-x-[5%] bottom-[-16%] aspect-square">
        <div
          className="anim-disc size-full rounded-full border-[0.6vh] border-ink bg-sun"
          style={{ animationDelay: `${delay}ms` }}
        />
      </div>
      <div className="anim-spin-slow pointer-events-none absolute inset-x-0 bottom-[-21%] aspect-square rounded-full border-[0.5vh] border-dashed border-ink/30" />
      <div className="anim-portrait absolute inset-x-0 bottom-0 top-[3%]" style={{ animationDelay: `${150 + delay}ms` }}>
        <Portrait personId={personId} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LEADERBOARD
// ---------------------------------------------------------------------------

export function HostLeaderboard({ view }: { view: HostView }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-[2.4vh]">
      <div className="flex flex-col items-center gap-[1vh]">
        <h2 className="chunk-tv anim-pop -rotate-2 bg-sun px-[2.4vw] pb-[0.5vh] pt-[1.6vh] font-display text-[6vh] leading-none">
          الترتيب 🏆
        </h2>
        <p className="text-[2.4vh] font-bold text-mute">
          بعد السؤال {view.currentIndex + 1} من {view.totalQuestions}
        </p>
      </div>
      <LeaderboardList entries={view.leaderboard} className="w-full max-w-[86vw]" availableVh={62} wide />
    </div>
  );
}

const RANK_STYLES = ["bg-sun", "bg-[#dfe3ee]", "bg-[#f3b47d]"];

function LeaderboardList({
  entries,
  className = "",
  availableVh,
  medals = false,
  wide = false,
}: {
  entries: LeaderboardEntry[];
  className?: string;
  availableVh: number;
  medals?: boolean;
  /** Allow two columns when there are many players. */
  wide?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="font-display text-[3.4vh] text-mute">ما فيه لاعبين</p>;
  }
  const cols = wide && entries.length > 7 ? 2 : 1;
  const rows = Math.ceil(entries.length / cols);
  const rowVh = Math.min(9.5, (availableVh - (rows - 1) * 1.2) / rows);
  const fontVh = Math.max(1.8, rowVh * 0.42);

  return (
    <ol
      className={`grid grid-flow-col gap-x-[2vw] gap-y-[1.2vh] ${className}`}
      style={{
        gridTemplateRows: `repeat(${rows}, ${rowVh}vh)`,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {entries.map((e, i) => {
        const top = e.rank === 1;
        const style: CSSProperties = { animationDelay: `${i * 70}ms`, fontSize: `${fontVh}vh` };
        return (
          <li
            key={e.playerId}
            className={`chunk-sm anim-rise flex min-w-0 items-center gap-[0.8vw] px-[0.8vw] ${top ? "bg-sun" : "bg-card"}`}
            style={style}
          >
            <span
              className={`grid aspect-square h-[76%] shrink-0 place-items-center rounded-full border-[3px] border-ink font-display leading-none ${
                RANK_STYLES[e.rank - 1] ?? "bg-cream"
              }`}
            >
              <span className="pt-[0.25em]">{medals && e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : e.rank}</span>
            </span>
            <NameBadge playerId={e.playerId} name={e.name} className="aspect-square h-[76%] text-[0.9em]" />
            <span className="min-w-0 flex-1 truncate pt-[0.3em] font-display leading-none">{e.name}</span>
            <span className="pt-[0.25em] font-display text-[1.25em] leading-none tabular-nums">{e.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// FINISHED
// ---------------------------------------------------------------------------

export function HostFinished({ view }: { view: HostView }) {
  const winners = view.leaderboard.filter((e) => e.rank === 1).slice(0, 3);
  const tie = winners.length > 1;
  const topScore = winners[0]?.score ?? 0;

  return (
    <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-[3vw]">
      <Confetti />
      <div className="relative flex min-h-0 flex-col items-center gap-[1.5vh]">
        <p className="chunk-sm anim-pop -rotate-2 bg-pink px-[1.6vw] pb-[0.3vh] pt-[1.2vh] font-display text-[4vh] leading-none text-white">
          {tie ? "تعادل على المركز الأول! 🤝" : "👑 بطل الشلة"}
        </p>
        <div className="relative flex min-h-0 w-full flex-1 items-end justify-center gap-[1.5vw]">
          {winners.map((w, i) =>
            w.personId ? (
              <div key={w.playerId} className="relative h-full max-w-[30vw] flex-1">
                <PortraitStage personId={w.personId} delay={i * 150} />
              </div>
            ) : (
              <div key={w.playerId} className="flex h-full flex-1 items-center justify-center">
                <NameBadge
                  playerId={w.playerId}
                  name={w.name}
                  className={`anim-pop aspect-square shadow-[0_1vh_0_var(--color-ink)] ${
                    winners.length > 1 ? "h-[24vh] text-[12vh]" : "h-[36vh] text-[18vh]"
                  }`}
                />
              </div>
            ),
          )}
        </div>
        <h2
          className="anim-rise text-center font-display text-[9vh] leading-tight [text-shadow:0_0.7vh_0_var(--color-sun)]"
          style={{ animationDelay: "500ms" }}
        >
          {winners.map((w) => w.name).join(" و ")}
        </h2>
        <p className="chunk-sm bg-card px-[1.4vw] pb-[0.2vh] pt-[1vh] font-display text-[3.4vh] leading-none">
          {pointsLabel(topScore)}
        </p>
      </div>

      <div className="relative flex min-h-0 flex-col justify-center gap-[2vh]">
        <h3 className="font-display text-[5vh] leading-none">النتائج النهائية</h3>
        <LeaderboardList entries={view.leaderboard} availableVh={66} medals wide={view.leaderboard.length > 12} />
      </div>
    </div>
  );
}
