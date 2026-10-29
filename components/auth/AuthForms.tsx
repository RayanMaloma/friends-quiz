"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { Brand, Spinner } from "@/components/ui";
import { homeFor, type Me } from "@/lib/auth";

/** Sun-yellow stage of the home page, with the brand on top. */
export function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <main className="home">
      <div aria-hidden className="home-rays" />
      <header className="home-top">
        <Link href="/" aria-label="الرئيسية">
          <Brand chip="bg-card" className="text-[clamp(1.6rem,3.2vw+0.6rem,3.2rem)]" />
        </Link>
      </header>
      <section className="relative z-30 flex flex-1 items-center justify-center px-4 py-8">{children}</section>
    </main>
  );
}

/** Unauthenticated «اختر لعبة»: two cards. */
export function AuthChoice() {
  return (
    <div className="anim-rise grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
      <ChoiceCard href="/login" emoji="🔑" label="عندك حساب؟" tone="bg-card" />
      <ChoiceCard href="/register" emoji="✨" label="سجّل الآن" tone="bg-pink text-card" />
    </div>
  );
}

function ChoiceCard({ href, emoji, label, tone }: { href: string; emoji: string; label: string; tone: string }) {
  return (
    <Link
      href={href}
      className={`chunk flex flex-col items-center justify-center gap-3 p-8 text-center transition-transform hover:-translate-y-1 sm:aspect-square ${tone}`}
    >
      <span className="text-6xl" aria-hidden>
        {emoji}
      </span>
      <span className="font-display text-4xl">{label}</span>
    </Link>
  );
}

/** Email + password + submit. Nothing else (no recovery links: no email is ever sent). */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const register = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    setTaken(false);
    const res = await api<Me>("/api/auth", { action: mode, email, password });
    if (!res.ok) {
      setBusy(false);
      setError(errorMessage(res.error));
      setTaken(res.error === "EMAIL_TAKEN");
      return;
    }
    router.replace(homeFor(res.user!.role));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="anim-rise chunk flex w-full max-w-sm flex-col gap-4 bg-card p-6">
      <h1 className="text-center font-display text-4xl">{register ? "سجّل الآن" : "تسجيل الدخول"}</h1>
      <input
        type="email"
        dir="ltr"
        required
        autoFocus
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="البريد الإلكتروني"
        aria-label="البريد الإلكتروني"
        className="chunk-sm h-14 w-full bg-cream px-4 text-center text-lg font-bold outline-none placeholder:text-mute/70 focus:bg-[#fffbea]"
      />
      <input
        type="password"
        dir="ltr"
        required
        minLength={register ? 8 : undefined}
        autoComplete={register ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="كلمة المرور"
        aria-label="كلمة المرور"
        className="chunk-sm h-14 w-full bg-cream px-4 text-center text-lg font-bold outline-none placeholder:text-mute/70 focus:bg-[#fffbea]"
      />
      {error && (
        <p role="alert" className="text-center font-bold text-pink">
          {error}
          {taken && (
            <>
              {" · "}
              <Link href="/login" className="underline underline-offset-4">
                سجّل دخولك
              </Link>
            </>
          )}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-primary h-14 text-2xl">
        {busy && <Spinner />}
        {register ? "إنشاء الحساب" : "دخول"}
      </button>
      <Link href={register ? "/login" : "/register"} className="text-center text-sm font-bold text-mute underline underline-offset-4">
        {register ? "عندك حساب؟" : "ما عندك حساب؟"}
      </Link>
    </form>
  );
}
