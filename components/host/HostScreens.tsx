"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { HostView, LeaderboardEntry } from "@/lib/types";
import { PEOPLE, personName } from "@/lib/people";
import { isLongFact, pointsLabel, tvFactFontSize } from "@/lib/format";
import { Avatar, Portrait } from "@/components/PersonImage";
import { Confetti } from "@/components/ui";

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------

export function HostLobby({ view }: { view: HostView }) {
  const joined = new Set(view.players.map((p) => p.personId));
  const [origin, setOrigin] = useState("");
  const [qrSvg, setQrSvg] = useState("");

  useEffect(() => {
    const o = window.location.origin;
    const url = `${o}/join?code=${view.code}`;
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0e0c13", light: "#ffffff" },
    })
      .then((svg) => {
        if (alive) {
          setOrigin(o);
          setQrSvg(svg);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view.code]);

  const host = origin.replace(/^https?:\/\//, "");
  const isLocalhost = /^(localhost|127\.0\.0\.1)/.test(host);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-[4vw]">
      <section className="anim-rise flex flex-col items-center gap-[2.2vh] text-center">
        <p className="text-[3.4vh] font-bold text-mute">رمز الدخول</p>
        <div dir="ltr" className="text-[21vh] font-black leading-[0.9] tracking-[0.12em] text-sun tabular-nums">
          {view.code}
        </div>
        <div className="mt-[1vh] flex items-center gap-[1.6vw]">
          <div
            className="size-[19vh] overflow-hidden rounded-[1.6vh] bg-white p-[0.6vh] [&>svg]:size-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="text-start">
            <p className="text-[2.6vh] font-bold text-mute">امسح الكود أو افتح</p>
            <p dir="ltr" className="text-[3.2vh] font-black text-paper">
              {host ? `${host}/join` : "…"}
            </p>
          </div>
        </div>
        {isLocalhost && (
          <p className="max-w-[34vw] rounded-xl bg-rose/15 px-4 py-2 text-[2vh] font-bold text-rose">
            انتبه: فاتح الصفحة على localhost — الجوالات ما بتقدر تدخل. افتحها من عنوان الشبكة (IP) أو من رابط Vercel.
          </p>
        )}
      </section>

      <section className="flex min-h-0 flex-col gap-[2.4vh]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[4.4vh] font-black">مين داخل؟</h2>
          <p className="text-[4.4vh] font-black tabular-nums">
            <span className="text-sun">{joined.size}</span>
            <span className="text-mute"> / {PEOPLE.length}</span> دخلوا
          </p>
        </div>
        <div className="grid grid-cols-3 gap-[1.4vw]">
          {PEOPLE.map((p) => {
            const isIn = joined.has(p.id);
            return (
              <div
                key={p.id}
                className={`relative h-[29vh] overflow-hidden rounded-[2.4vh] border-2 transition-all duration-500 ${
                  isIn ? "border-sun bg-panel-2" : "border-line bg-panel"
                }`}
              >
                <div
                  className={`absolute inset-x-0 bottom-[5.5vh] top-[1.5vh] transition-all duration-700 ${
                    isIn ? "opacity-100" : "opacity-20 blur-[1px]"
                  }`}
                >
                  <Portrait personId={p.id} size="card" eager />
                </div>
                <div
                  className={`absolute inset-x-0 bottom-0 flex h-[5.5vh] items-center justify-between px-[1vw] text-[2.6vh] font-black ${
                    isIn ? "bg-sun text-sun-ink" : "bg-panel-2 text-mute"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span key={String(isIn)} className={isIn ? "anim-pop" : ""}>
                    {isIn ? "✓" : "…"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QUESTION
// ---------------------------------------------------------------------------

export function HostQuestion({ view }: { view: HostView }) {
  const q = view.question!;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3vh]">
      <QuestionPill index={q.index} total={view.totalQuestions} />
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <p
          key={q.index}
          className={`anim-rise no-scrollbar max-h-full max-w-[86vw] overflow-y-auto leading-[1.5] ${
            isLongFact(q.factText) ? "text-start font-bold" : "text-center font-black text-balance"
          }`}
          style={{ fontSize: tvFactFontSize(q.factText) }}
        >
          <span className="text-sun">«</span>
          {q.factText}
          <span className="text-sun">»</span>
        </p>
      </div>
    </div>
  );
}

export function AnswerProgress({ answered, eligible }: { answered: number; eligible: number }) {
  const all = eligible > 0 && answered >= eligible;
  return (
    <div className="flex items-center gap-[1.4vw]">
      <div className="flex gap-[0.6vw]">
        {Array.from({ length: eligible }, (_, i) => (
          <span
            key={i}
            className={`size-[2.6vh] rounded-full transition-all duration-500 ${
              i < answered ? "scale-110 bg-mint" : "bg-panel-2 ring-2 ring-line"
            }`}
          />
        ))}
      </div>
      <p className="text-[4vh] font-black tabular-nums">
        <span className={all ? "text-mint" : "text-paper"}>{answered}</span>
        <span className="text-mute"> / {eligible}</span> جاوبوا
        {all && <span className="anim-pop ms-3 inline-block text-mint">الكل جاوب ✓</span>}
      </p>
    </div>
  );
}

function QuestionPill({ index, total }: { index: number; total: number }) {
  return (
    <div className="flex flex-col items-center gap-[1.2vh]">
      <span className="rounded-full bg-panel-2 px-[1.6vw] py-[0.6vh] text-[2.8vh] font-bold text-mute">
        السؤال {index + 1} من {total}
      </span>
      <div className="flex gap-[0.35vw]">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-[0.8vh] w-[2.2vw] rounded-full ${
              i < index ? "bg-sun/60" : i === index ? "bg-sun" : "bg-panel-2"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// REVEAL
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
    <div
      key={r.index}
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-[3vw]"
    >
      {/* Portrait column */}
      <div className="relative min-h-0 overflow-hidden border-b-[0.6vh] border-sun">
        <div className="absolute inset-x-[4%] bottom-[-14%] aspect-square">
          <div className="anim-disc size-full rounded-full bg-sun" />
        </div>
        <div className="anim-spin-slow pointer-events-none absolute inset-x-0 bottom-[-18%] aspect-square rounded-full border-[0.5vh] border-dashed border-sun/40" />
        <div className="anim-portrait absolute inset-x-0 bottom-0 top-[3%]" style={{ animationDelay: "150ms" }}>
          <Portrait personId={r.ownerPersonId} size="hero" eager />
        </div>
      </div>

      {/* Info column */}
      <div className="flex min-h-0 flex-col justify-center gap-[2.2vh]">
        <div>
          <p className="anim-fade text-[3.6vh] font-bold text-mute">كانت عن</p>
          <h2
            className="anim-pop text-[12vh] font-black leading-[1.05] text-sun"
            style={{ animationDelay: "350ms" }}
          >
            {personName(r.ownerPersonId)}
          </h2>
        </div>
        <p className="line-clamp-3 text-[2.6vh] font-semibold leading-relaxed text-paper/75">
          «{r.factText}»
        </p>
        <div className="anim-rise flex items-baseline gap-[1vw]" style={{ animationDelay: "600ms" }}>
          <p className="text-[5vh] font-black">{verdict}</p>
          {missing > 0 && r.eligibleCount > 0 && (
            <p className="text-[2.4vh] font-bold text-mute">({missing} ما جاوبوا)</p>
          )}
        </div>

        <div className="flex flex-col gap-[1.1vh]">
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
                <Avatar
                  personId={d.personId}
                  className="size-[5.4vh]"
                  ring={correct ? "bg-sun" : "bg-panel-2"}
                />
                <span
                  className={`w-[11vw] truncate text-[2.8vh] font-black ${correct ? "text-sun" : "text-paper"}`}
                >
                  {personName(d.personId)}
                </span>
                <div className="h-[4vh] flex-1 overflow-hidden rounded-full bg-panel">
                  <div
                    className={`anim-bar h-full rounded-full ${correct ? "bg-sun" : "bg-mute/45"}`}
                    style={{ width: `${(d.count / max) * 100}%`, animationDelay: `${850 + i * 110}ms` }}
                  />
                </div>
                <span className={`w-[3vw] text-[3.4vh] font-black tabular-nums ${correct ? "text-sun" : ""}`}>
                  {d.count}
                </span>
              </div>
            );
          })}
        </div>
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
      <div className="text-center">
        <h2 className="anim-pop text-[6vh] font-black leading-tight">الترتيب 🏆</h2>
        <p className="text-[2.6vh] font-bold text-mute">
          بعد السؤال {view.currentIndex + 1} من {view.totalQuestions}
        </p>
      </div>
      <LeaderboardList entries={view.leaderboard} className="w-full max-w-[72vw]" rowHeight="9vh" />
    </div>
  );
}

function LeaderboardList({
  entries,
  className = "",
  rowHeight,
  medals = false,
}: {
  entries: LeaderboardEntry[];
  className?: string;
  rowHeight: string;
  medals?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-[3vh] text-mute">ما فيه لاعبين</p>;
  }
  return (
    <ol className={`flex flex-col gap-[1.2vh] ${className}`}>
      {entries.map((e, i) => {
        const top = e.rank === 1;
        return (
          <li
            key={e.personId}
            className={`anim-rise flex items-center gap-[1.6vw] rounded-[2vh] border-2 px-[1.6vw] ${
              top ? "border-sun bg-sun text-sun-ink" : "border-line bg-panel"
            }`}
            style={{ height: rowHeight, animationDelay: `${i * 90}ms` }}
          >
            <span className="w-[5vh] text-center text-[4.6vh] font-black tabular-nums">
              {medals && e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : e.rank}
            </span>
            <Avatar
              personId={e.personId}
              className="size-[7vh]"
              ring={top ? "bg-sun-deep" : "bg-panel-2"}
            />
            <span className="flex-1 truncate text-[4.2vh] font-black">{personName(e.personId)}</span>
            <span className="text-[5.4vh] font-black tabular-nums">{e.score}</span>
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
  const winners = view.leaderboard.filter((e) => e.rank === 1);
  const tie = winners.length > 1;
  const topScore = winners[0]?.score ?? 0;

  return (
    <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-[3vw]">
      <Confetti />
      <div className="relative flex min-h-0 flex-col items-center">
        <p className="anim-pop text-[4.4vh] font-black text-sun">
          {tie ? "تعادل على المركز الأول! 🤝" : "👑 بطل الشلة"}
        </p>
        <div className="relative flex min-h-0 w-full flex-1 justify-center border-b-[0.6vh] border-sun">
          {winners.slice(0, 3).map((w, i) => (
            <div key={w.personId} className="relative h-full max-w-[32vw] flex-1 overflow-hidden">
              <div className="absolute inset-x-[6%] bottom-[-14%] aspect-square">
                <div className="anim-disc size-full rounded-full bg-sun" style={{ animationDelay: `${i * 150}ms` }} />
              </div>
              <div className="anim-portrait absolute inset-0" style={{ animationDelay: `${200 + i * 150}ms` }}>
                <Portrait personId={w.personId} size="hero" eager />
              </div>
            </div>
          ))}
        </div>
        <h2 className="anim-rise text-center text-[9vh] font-black leading-tight" style={{ animationDelay: "500ms" }}>
          {winners.map((w) => personName(w.personId)).join(" و ")}
        </h2>
        <p className="text-[3.4vh] font-bold text-mute">{pointsLabel(topScore)}</p>
      </div>

      <div className="relative flex min-h-0 flex-col justify-center gap-[2vh]">
        <h3 className="text-[4.4vh] font-black">النتائج النهائية</h3>
        <LeaderboardList entries={view.leaderboard} rowHeight="9.5vh" medals />
      </div>
    </div>
  );
}
