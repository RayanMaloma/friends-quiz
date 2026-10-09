"use client";

import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import type { ChoiceOption, HostView, LeaderboardEntry, Person, RevealSummary, RoundQuestion } from "@/lib/types";
import { optionStyle, SWATCHES } from "@/lib/colors";
import { isLongFact, pointsLabel, questionsLabel, tvFactFontSize } from "@/lib/format";
import { Img, Portrait } from "@/components/Media";
import { Confetti, NameBadge } from "@/components/ui";

function peopleMap(view: HostView): Map<string, Person> {
  return new Map(view.config.people.map((p) => [p.id, p]));
}

// ---------------------------------------------------------------------------
// LOBBY — room code, big QR right under it, live list of player names.
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
        <div className="chunk-tv mt-[1vh] aspect-square h-[38vh] rotate-1 bg-white p-[1.4vh]">
          <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        </div>
        <p className="font-display text-[3vh] text-mute">امسح الكود بالجوال 📱</p>
        {isLocalhost && (
          <p className="chunk-sm max-w-[34vw] bg-pink px-4 py-2 text-[1.8vh] font-bold text-white">
            انتبه: الصفحة مفتوحة على localhost — الجوالات ما بتقدر تدخل. افتحها من عنوان الشبكة (IP) أو رابط الموقع.
          </p>
        )}
      </section>

      {/* Game + players */}
      <section className="flex min-h-0 flex-col gap-[2.4vh] pt-[1vh]">
        <div className="anim-rise chunk-tv -rotate-1 self-start bg-card px-[2vw] py-[2vh]">
          <h1 className="font-display text-[7vh] leading-[1.1]">
            {view.config.emoji} {view.config.title}
          </h1>
          {view.config.tagline && (
            <p className="mt-[0.6vh] text-[2.6vh] font-bold text-mute">{view.config.tagline}</p>
          )}
          <p className="mt-[0.8vh] text-[2.2vh] font-extrabold text-mute">
            {questionsLabel(view.totalQuestions)}
          </p>
        </div>
        <div className="flex items-center gap-[1.4vw]">
          <h2 className="font-display text-[5.4vh] leading-none">مين داخل؟</h2>
          <span
            key={n}
            className="chunk-tv anim-pop grid h-[7.4vh] min-w-[7.4vh] place-items-center bg-sun px-[1.4vh] font-display text-[5vh] leading-none"
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

/** Options are shown on the TV for custom choices (not for "pick a person"). */
function showsOptionsOnTv(q: RoundQuestion) {
  return !q.peopleOptions && q.options.length > 0;
}

export function HostQuestion({ view, remaining }: { view: HostView; remaining: number | null }) {
  const { question: q, index, timer } = view.question!;
  const withOptions = showsOptionsOnTv(q);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-[2.4vh]">
      <div className="flex w-full items-start justify-between">
        <span className="w-[10vh]" />
        <QuestionPill index={index} total={view.totalQuestions} type={q.type} />
        {timer && remaining !== null ? <TimerBadge remaining={remaining} limit={timer.limit} /> : <span className="w-[10vh]" />}
      </div>
      <QuestionStage key={index} q={q} compact={withOptions} />
      {withOptions && <OptionTiles options={q.options} />}
    </div>
  );
}

function QuestionStage({ q, compact }: { q: RoundQuestion; compact: boolean }) {
  const prompt = q.prompt.trim();
  if (q.image) {
    return (
      <div className="anim-pop flex min-h-0 w-full flex-1 flex-col items-center gap-[1.6vh]">
        {prompt && (
          <p
            className="max-w-[88vw] text-center font-display leading-[1.3] text-balance"
            style={{ fontSize: prompt.length > 80 ? "min(2.6vw, 4.4vh)" : "min(3.6vw, 6vh)" }}
          >
            {prompt}
          </p>
        )}
        <div className="chunk-tv relative min-h-0 w-full max-w-[86vw] flex-1 overflow-hidden bg-ink">
          <Img src={q.image} alt="" sizes="86vw" priority className="object-contain" />
        </div>
      </div>
    );
  }
  const long = isLongFact(prompt);
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center pb-[1vh] pt-[2vh]">
      <div
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
          style={{ fontSize: compact ? `calc(${tvFactFontSize(prompt)} * 0.8)` : tvFactFontSize(prompt) }}
        >
          {prompt}
        </p>
      </div>
    </div>
  );
}

function OptionTiles({ options }: { options: ChoiceOption[] }) {
  const hasImages = options.some((o) => o.image);
  return (
    <div className="grid w-full max-w-[90vw] shrink-0 grid-cols-2 gap-[1.6vh]">
      {options.map((o, i) => {
        const st = optionStyle(i);
        return (
          <div
            key={o.id}
            className={`chunk-tv anim-rise flex items-center gap-[1.2vw] px-[1.4vw] ${st.bg} ${st.fg} ${
              hasImages ? "h-[14vh]" : "h-[9vh]"
            }`}
            style={{ animationDelay: `${150 + i * 70}ms` }}
          >
            <span className="text-[4vh] leading-none">{st.shape}</span>
            {o.image && (
              <span className="relative aspect-square h-[80%] shrink-0 overflow-hidden rounded-[1.4vh] border-[0.35vh] border-ink bg-card">
                <Img src={o.image} alt="" sizes="15vw" className="object-cover" />
              </span>
            )}
            <span className="line-clamp-2 pt-[0.6vh] font-display text-[3.8vh] leading-[1.15]">{o.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const TYPE_LABELS: Record<RoundQuestion["type"], string> = {
  who: "مين؟",
  choice: "اختار",
  truefalse: "صح أو خطأ",
  poll: "تصويت",
  text: "اكتب",
  number: "خمّن الرقم",
};

function QuestionPill({ index, total, type }: { index: number; total: number; type: RoundQuestion["type"] }) {
  return (
    <div className="flex flex-col items-center gap-[1.2vh]">
      <span className="flex items-center gap-[0.8vw]">
        <span className="chunk-sm bg-sun px-[2vw] pb-[0.4vh] pt-[1.2vh] font-display text-[3.4vh] leading-none">
          السؤال {index + 1} من {total}
        </span>
        <span className="chunk-sm bg-card px-[1vw] pb-[0.4vh] pt-[1.2vh] font-display text-[2.6vh] leading-none">
          {TYPE_LABELS[type]}
        </span>
      </span>
      {total <= 40 && (
        <div className="flex gap-[0.4vw]">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-[1.2vh] rounded-full border-2 border-ink ${total > 20 ? "w-[1.2vw]" : "w-[2.4vw]"} ${
                i < index ? "bg-ink" : i === index ? "bg-pink" : "bg-card"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TimerBadge({ remaining, limit }: { remaining: number; limit: number }) {
  const secs = Math.ceil(remaining);
  const pct = limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;
  const urgent = secs <= 5;
  return (
    <div
      className={`chunk-tv relative grid size-[10vh] shrink-0 place-items-center rounded-full ${urgent ? "anim-nudge" : ""}`}
      style={{
        background: `conic-gradient(${urgent ? "var(--color-pink)" : "var(--color-mint)"} ${pct * 360}deg, var(--color-card) 0deg)`,
        borderRadius: "999px",
      }}
    >
      <span className="grid size-[7vh] place-items-center rounded-full border-[0.35vh] border-ink bg-card font-display text-[4.2vh] leading-none tabular-nums">
        <span className="pt-[0.7vh]">{secs}</span>
      </span>
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

// ---------------------------------------------------------------------------
// REVEAL
// ---------------------------------------------------------------------------

function verdictText(r: RevealSummary): string {
  if (r.eligibleCount === 0) return "ما كان فيه أحد يجاوب";
  if (!r.scored) return `${r.answeredCount} من ${r.eligibleCount} صوّتوا`;
  if (r.correctCount === 0) return r.question.type === "number" ? "ولا أحد قرّب 😮" : "ولا أحد عرفها 😮";
  if (r.correctCount === r.eligibleCount) return "الكل عرفها 🔥";
  if (r.question.type === "poll") return `${r.correctCount} صوّتوا مع الأغلبية`;
  if (r.question.type === "number") return r.correctCount === 1 ? "واحد بس كان الأقرب" : `${r.correctCount} كانوا الأقرب`;
  return `${r.correctCount} من ${r.eligibleCount} عرفوها`;
}

export function HostReveal({ view }: { view: HostView }) {
  const r = view.reveal!;
  const q = r.question;
  if (q.peopleOptions) return <PersonReveal view={view} r={r} />;
  if (q.type === "text") return <TextReveal view={view} r={r} />;
  if (q.type === "number") return <NumberReveal view={view} r={r} />;
  return <OptionsReveal view={view} r={r} />;
}

function Verdict({ r, delay = 600 }: { r: RevealSummary; delay?: number }) {
  const missing = Math.max(0, r.eligibleCount - r.answeredCount);
  return (
    <div className="anim-rise flex flex-wrap items-center gap-[1vw]" style={{ animationDelay: `${delay}ms` }}>
      <span className="chunk-tv bg-mint px-[1.4vw] pb-[0.4vh] pt-[1.4vh] font-display text-[4.2vh] leading-none">
        {verdictText(r)}
      </span>
      {missing > 0 && r.eligibleCount > 0 && (
        <span className="text-[2.4vh] font-bold text-mute">({missing} ما جاوبوا)</span>
      )}
    </div>
  );
}

function Note({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="chunk-sm anim-rise bg-card px-[1.2vw] py-[1vh] text-[2.4vh] font-bold leading-relaxed" style={{ animationDelay: "900ms" }}>
      💬 {text}
    </p>
  );
}

function QuestionRecap({ q }: { q: RoundQuestion }) {
  return (
    <div className="flex min-w-0 items-center gap-[1vw]">
      {q.image && (
        <span className="chunk-sm relative aspect-[4/3] h-[11vh] shrink-0 overflow-hidden bg-ink">
          <Img src={q.image} alt="" sizes="20vw" className="object-cover" />
        </span>
      )}
      {q.prompt && <p className="line-clamp-2 min-w-0 text-[2.5vh] font-bold leading-relaxed text-mute">«{q.prompt}»</p>}
    </div>
  );
}

/** "Who" questions and polls about people: the answer's portrait takes the stage. */
function PersonReveal({ view, r }: { view: HostView; r: RevealSummary }) {
  const people = peopleMap(view);
  const winners = r.winningOptionIds.map((id) => people.get(id)).filter((p): p is Person => !!p);
  const hero = winners[0] ?? null;
  const showVotes = view.config.settings.showVotes;
  const max = Math.max(1, ...r.votes.map((v) => v.count));
  const isPoll = r.question.type === "poll";
  const voted = r.votes.filter((v) => v.count > 0).sort((a, b) => b.count - a.count);

  return (
    <div key={r.index} className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-[3vw]">
      {hero ? (
        <PortraitStage person={hero} />
      ) : (
        <div className="flex items-center justify-center font-display text-[6vh] text-mute">🤷</div>
      )}

      <div className="flex min-h-0 flex-col justify-center gap-[2vh]">
        <div>
          <span className="chunk-sm anim-fade inline-block -rotate-2 bg-card px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3.4vh] leading-none">
            {isPoll ? (winners.length > 1 ? "تعادل بين…" : "الأغلبية اختارت…") : "الإجابة…"}
          </span>
          <h2
            className="anim-pop mt-[1.4vh] font-display text-[12vh] leading-[1.05] [text-shadow:0_0.8vh_0_var(--color-sun)]"
            style={{ animationDelay: "350ms" }}
          >
            {winners.length ? winners.map((w) => w.name).join(" و ") : "ما أحد صوّت"}
          </h2>
        </div>
        <QuestionRecap q={r.question} />
        <Verdict r={r} />
        <Note text={r.question.note} />

        {showVotes && (
          <div className="flex min-h-0 flex-col gap-[1.1vh] overflow-hidden">
            {voted.length === 0 && <p className="text-[2.6vh] font-bold text-mute">ما أحد جاوب على هذي</p>}
            {voted.slice(0, 7).map((v, i) => {
              const win = r.winningOptionIds.includes(v.optionId);
              return (
                <div key={v.optionId} className="anim-rise flex items-center gap-[1vw]" style={{ animationDelay: `${750 + i * 110}ms` }}>
                  <span className="w-[12vw] truncate pt-[0.6vh] font-display text-[3.1vh] leading-none">
                    {win && "✓ "}
                    {people.get(v.optionId)?.name ?? "؟"}
                  </span>
                  <div className="chunk-sm h-[4.2vh] flex-1 overflow-hidden bg-card p-[0.4vh]">
                    <div
                      className={`anim-bar h-full rounded-[0.7vh] ${win ? "bg-sun" : "bg-pink/70"}`}
                      style={{ width: `${(v.count / max) * 100}%`, animationDelay: `${850 + i * 110}ms` }}
                    />
                  </div>
                  <span className="w-[3vw] pt-[0.6vh] font-display text-[3.8vh] leading-none tabular-nums">{v.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionsReveal({ view, r }: { view: HostView; r: RevealSummary }) {
  const q = r.question;
  const showVotes = view.config.settings.showVotes;
  const max = Math.max(1, ...r.votes.map((v) => v.count));
  const counts = new Map(r.votes.map((v) => [v.optionId, v.count]));
  const hasImages = q.options.some((o) => o.image);

  return (
    <div key={r.index} className="flex min-h-0 flex-1 flex-col gap-[2.2vh]">
      <div className="flex items-start justify-between gap-[2vw]">
        <QuestionRecap q={q} />
        <Verdict r={r} delay={300} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-[1.8vh]">
        {q.options.map((o, i) => {
          const st = optionStyle(i);
          const win = r.winningOptionIds.includes(o.id);
          const count = counts.get(o.id) ?? 0;
          return (
            <div
              key={o.id}
              className={`chunk-tv anim-rise relative flex items-center gap-[1.2vw] overflow-hidden px-[1.4vw] ${
                hasImages ? "h-[17vh]" : "h-[12vh]"
              } ${win ? `${st.bg} ${st.fg}` : "bg-card text-ink opacity-55"} ${win ? "scale-[1.02]" : ""}`}
              style={{ animationDelay: `${200 + i * 90}ms` }}
            >
              {showVotes && (
                <div
                  className="anim-bar absolute inset-y-0 start-0 bg-ink/12"
                  style={{ width: `${(count / max) * 100}%`, animationDelay: `${500 + i * 90}ms` }}
                />
              )}
              <span className="relative text-[4vh] leading-none">{win ? "✓" : st.shape}</span>
              {o.image && (
                <span className="relative aspect-square h-[80%] shrink-0 overflow-hidden rounded-[1.4vh] border-[0.35vh] border-ink bg-card">
                  <Img src={o.image} alt="" sizes="15vw" className="object-cover" />
                </span>
              )}
              <span className="relative line-clamp-2 flex-1 pt-[0.6vh] font-display text-[4vh] leading-[1.15]">{o.label}</span>
              {showVotes && (
                <span className="relative pt-[0.6vh] font-display text-[5vh] leading-none tabular-nums">{count}</span>
              )}
            </div>
          );
        })}
      </div>
      <Note text={q.note} />
    </div>
  );
}

function TextReveal({ view, r }: { view: HostView; r: RevealSummary }) {
  const showVotes = view.config.settings.showVotes;
  return (
    <div key={r.index} className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2.6vh] text-center">
      <QuestionRecap q={r.question} />
      <span className="chunk-sm anim-fade -rotate-2 bg-card px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3.4vh] leading-none">
        الإجابة
      </span>
      <h2
        className="anim-pop font-display text-[11vh] leading-[1.05] [text-shadow:0_0.8vh_0_var(--color-sun)]"
        style={{ animationDelay: "250ms" }}
      >
        {r.accepted[0]}
      </h2>
      {r.accepted.length > 1 && (
        <p className="text-[2.6vh] font-bold text-mute">ومقبول بعد: {r.accepted.slice(1).join("، ")}</p>
      )}
      <Verdict r={r} />
      {showVotes && r.topTexts.length > 0 && (
        <div className="flex max-w-[80vw] flex-wrap justify-center gap-[1.2vh]">
          {r.topTexts.map((t, i) => (
            <span
              key={t.text}
              className={`chunk-sm anim-rise px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3vh] leading-none ${
                t.correct ? "bg-mint" : "bg-card"
              }`}
              style={{ animationDelay: `${800 + i * 90}ms` }}
            >
              {t.correct && "✓ "}
              {t.text}
              <span className="ms-[0.6vw] text-mute">×{t.count}</span>
            </span>
          ))}
        </div>
      )}
      <Note text={r.question.note} />
    </div>
  );
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function NumberReveal({ view, r }: { view: HostView; r: RevealSummary }) {
  const showVotes = view.config.settings.showVotes;
  return (
    <div key={r.index} className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2.6vh] text-center">
      <QuestionRecap q={r.question} />
      <span className="chunk-sm anim-fade -rotate-2 bg-card px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3.4vh] leading-none">
        الرقم الصحيح
      </span>
      <h2
        dir="ltr"
        className="anim-pop font-display text-[16vh] leading-none tabular-nums [text-shadow:0_0.9vh_0_var(--color-sun)]"
        style={{ animationDelay: "250ms" }}
      >
        {r.numberAnswer !== null ? formatNumber(r.numberAnswer) : "؟"}
      </h2>
      <Verdict r={r} />
      {r.closest.length > 0 && (
        <div className="flex flex-wrap justify-center gap-[1.2vh]">
          {r.closest.slice(0, 6).map((c, i) => (
            <span
              key={c.playerId}
              className="chunk-sm anim-rise flex items-center gap-[0.8vw] bg-sun px-[1.2vw] pb-[0.3vh] pt-[1vh] font-display text-[3.2vh] leading-none"
              style={{ animationDelay: `${800 + i * 90}ms` }}
            >
              🎯 {c.name} <span dir="ltr" className="text-mute">{formatNumber(c.value)}</span>
            </span>
          ))}
        </div>
      )}
      {showVotes && r.numberAverage !== null && (
        <p className="text-[2.6vh] font-bold text-mute">
          متوسط التخمينات: <span dir="ltr">{formatNumber(Math.round(r.numberAverage * 100) / 100)}</span>
        </p>
      )}
      <Note text={r.question.note} />
    </div>
  );
}

function PortraitStage({ person, delay = 0 }: { person: Person; delay?: number }) {
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
        <Portrait person={person} />
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
      <LeaderboardList entries={view.leaderboard} className="w-full max-w-[86vw]" availableVh={62} wide showGained />
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
  showGained = false,
}: {
  entries: LeaderboardEntry[];
  className?: string;
  availableVh: number;
  medals?: boolean;
  /** Allow two columns when there are many players. */
  wide?: boolean;
  showGained?: boolean;
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
            {showGained && e.gained > 0 && (
              <span
                dir="ltr"
                className="anim-pop pt-[0.3em] font-display text-[0.85em] leading-none text-mint"
                style={{ animationDelay: `${400 + i * 70}ms` }}
              >
                +{e.gained}
              </span>
            )}
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
  const people = peopleMap(view);
  const winners = view.leaderboard.filter((e) => e.rank === 1).slice(0, 3);
  const tie = winners.length > 1;
  const topScore = winners[0]?.score ?? 0;

  if (winners.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[2vh]">
        <p className="font-display text-[8vh]">خلصت اللعبة 🎉</p>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-[3vw]">
      <Confetti />
      <div className="relative flex min-h-0 flex-col items-center gap-[1.5vh]">
        <p className="chunk-sm anim-pop -rotate-2 bg-pink px-[1.6vw] pb-[0.3vh] pt-[1.2vh] font-display text-[4vh] leading-none text-white">
          {tie ? "تعادل على المركز الأول! 🤝" : "👑 البطل"}
        </p>
        <div className="relative flex min-h-0 w-full flex-1 items-end justify-center gap-[1.5vw]">
          {winners.map((w, i) => {
            const person = w.personId ? people.get(w.personId) : undefined;
            return person?.image ? (
              <div key={w.playerId} className="relative h-full max-w-[30vw] flex-1">
                <PortraitStage person={person} delay={i * 150} />
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
            );
          })}
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
