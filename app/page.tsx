import Link from "next/link";
import { Brand } from "@/components/ui";
import { Portrait } from "@/components/PersonImage";
import { PEOPLE } from "@/lib/people";

export default function Home() {
  return (
    <main className="safe-pad relative flex min-h-dvh flex-col items-center overflow-hidden">
      <div className="z-10 flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 pt-6 text-center">
        <Brand className="anim-pop text-6xl sm:text-7xl" />
        <p className="anim-rise text-lg font-bold text-mute sm:text-xl">
          معلومات عن الشلة… خمّن كل وحدة عن مين
        </p>
        <div className="anim-rise flex w-full flex-col gap-4" style={{ animationDelay: "120ms" }}>
          <Link href="/join" className="btn btn-primary h-16 w-full text-2xl">
            دخول لعبة
          </Link>
          <Link href="/host" className="btn btn-ghost h-14 w-full text-xl">
            إنشاء لعبة
          </Link>
        </div>
        <p className="text-sm text-mute">الشاشة الكبيرة تنشئ اللعبة، والجوالات تدخل</p>
      </div>

      {/* Decorative line-up of the gang */}
      <div aria-hidden className="pointer-events-none relative -mb-4 flex h-[30vh] w-full max-w-4xl justify-center">
        {PEOPLE.map((p, i) => (
          <div
            key={p.id}
            className="anim-rise relative -mx-[2%] h-full w-1/5 opacity-80"
            style={{ animationDelay: `${200 + i * 80}ms`, zIndex: i % 2 ? 1 : 2 }}
          >
            <Portrait personId={p.id} size="card" eager />
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink to-transparent" />
      </div>
    </main>
  );
}
