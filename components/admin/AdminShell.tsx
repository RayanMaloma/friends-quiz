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
        <div className="chunk bg-card p-6">
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

export function AdminShell({ children, warnings }: { children: React.ReactNode; warnings: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b-[3px] border-ink bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/admin" className="shrink-0">
            <Brand className="text-3xl" />
          </Link>
          <nav className="flex flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`chunk-sm shrink-0 px-3 pb-0.5 pt-1.5 font-display text-lg leading-tight ${
                  n.match(pathname) ? "bg-sun" : "bg-card"
                }`}
              >
                {n.label}
              </Link>
            ))}
            <Link href="/host" className="chunk-sm shrink-0 bg-card px-3 pb-0.5 pt-1.5 font-display text-lg leading-tight">
              📺 تشغيل
            </Link>
          </nav>
          <button
            onClick={async () => {
              await api("/api/admin", { action: "logout" });
              router.refresh();
            }}
            className="shrink-0 text-sm font-bold text-mute underline underline-offset-4"
          >
            خروج
          </button>
        </div>
      </header>
      {warnings.length > 0 && (
        <div className="mx-auto mt-3 flex w-full max-w-6xl flex-col gap-2 px-4">
          {warnings.map((w) => (
            <p key={w} className="chunk-sm bg-[#fff1c4] px-3 py-2 text-sm font-bold">
              ⚠️ {w}
            </p>
          ))}
        </div>
      )}
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-5">{children}</div>
    </div>
  );
}
