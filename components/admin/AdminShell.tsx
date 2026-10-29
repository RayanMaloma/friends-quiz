"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import type { Me } from "@/lib/auth";
import { Brand, Spinner } from "@/components/ui";
import { AuthForm, AuthStage } from "@/components/auth/AuthForms";
import { LoginForm } from "@/components/admin/LoginForm";

/**
 * Not signed in as the super admin. An expired session is renewed first
 * (/api/auth "me" refreshes the cookies), then the dashboard reloads.
 * Otherwise: the account sign-in, or the shared dashboard password (GM).
 */
export function AdminGate({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [password, setPassword] = useState(false);

  useEffect(() => {
    void api<Me>("/api/auth", { action: "me" }).then((res) => {
      if (!res.ok) return setMe({ user: null, gm: false });
      if (res.user?.role === "super_admin" || res.gm) router.refresh();
      else setMe({ user: res.user, gm: res.gm });
    });
  }, [router]);

  if (!me) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner className="size-8 text-ink" />
      </main>
    );
  }
  if (me.user) {
    // A regular account: the dashboard isn't theirs.
    return (
      <AuthStage>
        <div className="chunk flex flex-col items-center gap-4 bg-card p-8 text-center">
          <span className="text-6xl">🔒</span>
          <Link href="/games" className="btn btn-primary h-14 px-8 text-2xl">
            الألعاب
          </Link>
        </div>
      </AuthStage>
    );
  }
  if (password && configured) return <LoginForm onSuccess={() => router.refresh()} />;
  return (
    <AuthStage>
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <AuthForm mode="login" />
        {configured && (
          <button onClick={() => setPassword(true)} className="text-sm font-bold text-ink/70 underline underline-offset-4">
            كلمة مرور اللوحة
          </button>
        )}
      </div>
    </AuthStage>
  );
}

const NAV = [
  { href: "/admin", label: "الألعاب", icon: "🎮", match: (p: string) => p === "/admin" || p.startsWith("/admin/games") || p.startsWith("/admin/dx") },
  { href: "/admin/activity", label: "النشاط", icon: "📈", match: (p: string) => p.startsWith("/admin/activity") || p.startsWith("/admin/sessions") },
];

export interface AdminWarning {
  /** Blocking problems are always shown; setup tips fold away. */
  level: "blocking" | "tip";
  text: string;
}

export function AdminShell({ children, warnings, email }: { children: React.ReactNode; warnings: AdminWarning[]; email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const blocking = warnings.filter((w) => w.level === "blocking");
  const tips = warnings.filter((w) => w.level === "tip");

  async function logout() {
    await api("/api/auth", { action: "logout" });
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="admin-dark flex min-h-dvh flex-col overflow-x-clip md:flex-row">
      <aside className="admin-side no-scrollbar sticky top-0 z-30 flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto px-3 py-2 md:h-dvh md:w-56 md:flex-col md:items-stretch md:gap-2 md:overflow-visible md:px-4 md:py-5">
        <Link href="/" className="hidden shrink-0 sm:block md:mb-4" aria-label="الرئيسية">
          <Brand className="text-xl md:text-2xl" />
        </Link>
        <nav className="flex flex-1 items-center gap-1 md:flex-none md:flex-col md:items-stretch">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`admin-nav ${n.match(pathname) ? "admin-nav-on" : ""}`}>
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 md:mt-auto md:flex-col md:items-stretch">
          <Link href="/games" className="admin-nav" title="العب">
            <span aria-hidden>📺</span>
            <span className="hidden md:inline">العب</span>
          </Link>
          <button onClick={logout} className="admin-nav text-mute" title={email ?? "خروج"}>
            <span aria-hidden>🚪</span>
            <span className="hidden md:inline">خروج</span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {(blocking.length > 0 || tips.length > 0) && (
          <div className="mx-auto mt-4 flex w-full max-w-6xl flex-col gap-2 px-4">
            {blocking.map((w) => (
              <p key={w.text} className="admin-alert px-4 py-2.5 text-sm font-bold">
                ⛔ {w.text}
              </p>
            ))}
            {tips.length > 0 && (
              <details className="admin-note group px-4 py-2 text-sm font-bold">
                <summary className="cursor-pointer list-none select-none">⚠️ ملاحظات الإعداد ({tips.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 font-semibold">
                  {tips.map((w) => (
                    <li key={w.text}>• {w.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5">{children}</div>
      </div>
    </div>
  );
}
