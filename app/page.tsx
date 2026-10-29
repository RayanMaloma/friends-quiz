import Link from "next/link";
import people from "@/data/people.json";
import { Brand } from "@/components/ui";
import { CrewLineup } from "@/components/home/CrewLineup";

/**
 * Host landing: pick a game → a room with a QR opens on the TV. Players never
 * come here — the QR takes them straight to /join?code=…, which also still
 * works for typing a code by hand.
 */
export default function Home() {
  return (
    <main className="home">
      <div aria-hidden className="home-rays" />

      <header className="home-top">
        <Brand chip="bg-card" className="anim-pop text-[clamp(1.6rem,3.2vw+0.6rem,3.2rem)]" />
        <Link href="/admin" aria-label="لوحة التحكم" title="لوحة التحكم" className="home-gear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </header>

      <section className="home-hero">
        <h1 className="home-title anim-rise">مين بيفوز الليلة؟</h1>
        <div className="anim-rise" style={{ animationDelay: "120ms" }}>
          <Link href="/host" className="btn home-cta">
            اختر لعبة
            <span aria-hidden className="home-cta-arrow">←</span>
          </Link>
        </div>
      </section>

      <CrewLineup people={people} />
    </main>
  );
}
