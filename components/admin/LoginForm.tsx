"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Brand, Spinner } from "@/components/ui";

/** Admin password form. Used by /admin and by /host (starting a game needs admin). */
export function LoginForm({ onSuccess, hint }: { onSuccess: () => void; hint?: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const res = await api("/api/admin", { action: "login", password });
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    onSuccess();
  }

  return (
    <main className="safe-pad mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-8 text-center">
      <Brand className="anim-pop text-6xl" />
      <form onSubmit={submit} className="anim-rise flex w-full flex-col gap-4">
        <label htmlFor="admin-password" className="font-display text-3xl">
          لوحة التحكم 🔐
        </label>
        {hint && <p className="text-sm font-bold text-mute">{hint}</p>}
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          placeholder="كلمة المرور"
          className="panel h-16 w-full bg-card px-5 text-center text-2xl font-bold outline-none focus:bg-[#fffbea]"
        />
        {error && <p className="font-bold text-pink">{error}</p>}
        <button type="submit" disabled={!password || busy} className="abtn abtn-primary abtn-lg">
          {busy && <Spinner />}
          دخول
        </button>
      </form>
    </main>
  );
}
