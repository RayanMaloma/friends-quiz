import Link from "next/link";
import { Brand, Decor } from "@/components/ui";

export default function Home() {
  return (
    <main className="safe-pad relative flex min-h-dvh flex-col items-center justify-center overflow-hidden">
      <Decor />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8 text-center">
        <Brand className="anim-pop text-7xl" />
        <p className="chunk-sm anim-rise -rotate-1 bg-card px-5 py-2 text-lg font-extrabold">
          التلفزيون يعرض السؤال… وكل واحد يجاوب من جواله 📱
        </p>
        <div className="anim-rise flex w-full flex-col gap-5" style={{ animationDelay: "120ms" }}>
          <Link href="/join" className="btn btn-primary h-20 w-full text-4xl">
            دخول لعبة
          </Link>
          <Link href="/host" className="btn btn-ghost h-16 w-full text-2xl">
            تشغيل لعبة على التلفزيون 📺
          </Link>
        </div>
        <Link href="/admin" className="text-base font-bold text-mute underline underline-offset-4">
          لوحة التحكم ⚙️
        </Link>
      </div>
    </main>
  );
}
