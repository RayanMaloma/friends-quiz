"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Brand } from "@/components/ui";
import { LoginForm } from "@/components/admin/LoginForm";

export function AdminGate({ configured }: { configured: boolean }) {
  const router = useRouter();
  if (!configured) {
    return (
      <main className="safe-pad mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 text-center">
        <Brand className="text-6xl" />
        <div className="panel p-6">
          <p className="font-display text-2xl">لوحة التحكم مقفلة 🔒</p>
          <p className="mt-2 font-bold text-mute">
            أضف متغير البيئة <code dir="ltr">ADMIN_PASSWORD</code> في إعدادات السيرفر (Vercel) ثم أعد النشر.
          </p>
        </div>
      </main>
    );
  }
  return <LoginForm onSuccess={() => router.refresh()} />;
}

const NAV = [
  { href: "/admin", label: "الألعاب", match: (p: string) => p === "/admin" || p.startsWith("/admin/games") },
  { href: "/admin/sessions", label: "الجلسات", match: (p: string) => p.startsWith("/admin/sessions") },
];

export interface AdminWarning {
  /** Blocking problems are always shown; setup tips fold away. */
  level: "blocking" | "tip";
  text: string;
}

export function AdminShell({ children, warnings }: { children: React.ReactNode; warnings: AdminWarning[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const blocking = warnings.filter((w) => w.level === "blocking");
  const tips = warnings.filter((w) => w.level === "tip");
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
          <Link href="/admin" className="shrink-0 sm:me-2" aria-label="الرئيسية">
            <Brand className="text-xl sm:text-2xl" />
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`abtn abtn-sm ${n.match(pathname) ? "abtn-primary" : "abtn-quiet"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <Link href="/host" className="abtn abtn-sm" title="افتح غرفة على التلفزيون">
              📺 <span className="hidden sm:inline">تشغيل على التلفزيون</span>
            </Link>
            <button
              onClick={async () => {
                await api("/api/admin", { action: "logout" });
                router.refresh();
              }}
              className="abtn abtn-quiet abtn-sm text-mute"
              title="تسجيل خروج"
            >
              <span className="sm:hidden" aria-hidden>
                🚪
              </span>
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </div>
      </header>

      {(blocking.length > 0 || tips.length > 0) && (
        <div className="mx-auto mt-4 flex w-full max-w-6xl flex-col gap-2 px-4">
          {blocking.map((w) => (
            <p key={w.text} className="panel-sm bg-[#ffe1ec] px-4 py-2.5 text-sm font-bold">
              ⛔ {w.text}
            </p>
          ))}
          {tips.length > 0 && (
            <details className="panel-sm group bg-[#fff6d8] px-4 py-2 text-sm font-bold">
              <summary className="cursor-pointer list-none select-none">
                ⚠️ ملاحظات الإعداد ({tips.length})
                <span className="ms-2 text-xs text-mute group-open:hidden">اضغط للتفاصيل</span>
              </summary>
              <ul className="mt-2 flex flex-col gap-1 font-semibold">
                {tips.map((w) => (
                  <li key={w.text}>• {w.text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5">{children}</div>
    </div>
  );
}
