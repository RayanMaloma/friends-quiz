"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import type { GuestView } from "@/lib/types";
import { PEOPLE, personName } from "@/lib/people";
import { Portrait } from "@/components/PersonImage";
import { Brand, Spinner } from "@/components/ui";

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <Join />
    </Suspense>
  );
}

type Lookup = { sessionId: string; code: string; takenPersonIds: string[] };

function Join() {
  const router = useRouter();
  const params = useSearchParams();
  const codeParam = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 4);

  const [code, setCode] = useState(codeParam);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<PlayerCreds | null>(null);
  const autoTried = useRef(false);

  const doLookup = useCallback(async (value: string) => {
    if (!/^\d{4}$/.test(value)) {
      setError("الرمز ٤ أرقام");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<{ sessionId: string; takenPersonIds: string[] }>("/api/guest", {
      action: "lookup",
      code: value,
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return;
    }
    // Already joined this game on this device? Go straight back in.
    const existing = playerStore.get(res.sessionId);
    if (existing) {
      const state = await api<{ view: GuestView }>("/api/guest", {
        action: "state",
        sessionId: existing.sessionId,
        playerToken: existing.playerToken,
      });
      if (state.ok) {
        router.replace(`/play/${existing.sessionId}`);
        return;
      }
      if (state.error === "NOT_A_PLAYER") playerStore.clear(existing.sessionId);
    }
    setLookup({ sessionId: res.sessionId, code: value, takenPersonIds: res.takenPersonIds });
    setSelected((s) => (s && res.takenPersonIds.includes(s) ? null : s));
  }, [router]);

  // Auto-continue from QR link, or offer to resume the last game.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (codeParam.length === 4) {
      void Promise.resolve(codeParam).then(doLookup);
      return;
    }
    const last = playerStore.last();
    if (!last) return;
    void api<{ view: GuestView }>("/api/guest", {
      action: "state",
      sessionId: last.sessionId,
      playerToken: last.playerToken,
    }).then((res) => {
      if (res.ok && res.view.status !== "FINISHED") setResume(last);
    });
  }, [codeParam, doLookup]);

  async function join() {
    if (!lookup || !selected || busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ sessionId: string; playerToken: string; personId: string }>("/api/guest", {
      action: "join",
      code: lookup.code,
      personId: selected,
    });
    if (!res.ok) {
      setBusy(false);
      setError(errorMessage(res.error));
      if (res.error === "IDENTITY_TAKEN") void doLookup(lookup.code);
      return;
    }
    playerStore.save({
      sessionId: res.sessionId,
      code: lookup.code,
      personId: res.personId,
      playerToken: res.playerToken,
    });
    router.replace(`/play/${res.sessionId}`);
  }

  // ---- Step 2: pick identity ----
  if (lookup) {
    return (
      <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col gap-5">
        <header className="flex items-center justify-between">
          <button onClick={() => setLookup(null)} className="btn btn-ghost h-10 rounded-full px-4 text-sm">
            رجوع
          </button>
          <span className="text-sm font-bold text-mute">
            رمز اللعبة <span className="font-black text-paper" dir="ltr">{lookup.code}</span>
          </span>
        </header>
        <div className="anim-rise text-center">
          <h1 className="text-3xl font-black">مين أنت؟</h1>
          <p className="mt-1 font-bold text-mute">اختار اسمك</p>
        </div>
        <div className="grid grid-cols-2 gap-3 pb-28">
          {PEOPLE.map((p, i) => {
            const taken = lookup.takenPersonIds.includes(p.id);
            const isSel = selected === p.id;
            return (
              <button
                key={p.id}
                disabled={taken}
                onClick={() => setSelected(p.id)}
                className={`anim-rise relative h-48 overflow-hidden rounded-3xl border-2 text-start transition-all ${
                  isSel
                    ? "scale-[1.02] border-sun bg-panel-2"
                    : taken
                      ? "border-line bg-panel opacity-40"
                      : "border-line bg-panel active:scale-[0.98]"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="absolute inset-x-0 bottom-11 top-2">
                  <Portrait personId={p.id} size="card" eager />
                </div>
                <div
                  className={`absolute inset-x-0 bottom-0 flex h-11 items-center justify-between px-3 font-black ${
                    isSel ? "bg-sun text-sun-ink" : "bg-panel-2"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  {taken && <span className="text-xs text-mute">داخل</span>}
                  {isSel && <span>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="sticky-bottom-safe fixed inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-6">
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            {error && <p className="text-center font-bold text-rose">{error}</p>}
            <button onClick={join} disabled={!selected || busy} className="btn btn-primary h-16 w-full text-2xl">
              {busy && <Spinner />}
              {selected ? `دخول باسم ${personName(selected)}` : "اختار اسمك"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---- Step 1: room code ----
  return (
    <main className="safe-pad mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 text-center">
      <Brand className="anim-pop text-6xl" />
      {resume && (
        <button
          onClick={() => router.push(`/play/${resume.sessionId}`)}
          className="btn btn-ghost anim-rise h-14 w-full text-lg"
        >
          رجوع للعبة ({resume.code}) باسم {personName(resume.personId)}
        </button>
      )}
      <form
        className="anim-rise flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void doLookup(code);
        }}
      >
        <label htmlFor="code" className="text-xl font-bold text-mute">
          رمز الدخول
        </label>
        <input
          id="code"
          dir="ltr"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={4}
          autoFocus
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
            setError(null);
          }}
          placeholder="0000"
          className="h-24 w-full rounded-3xl border-2 border-line bg-panel text-center text-6xl font-black tracking-[0.3em] text-sun outline-none placeholder:text-panel-2 focus:border-sun"
        />
        {error && <p className="font-bold text-rose">{error}</p>}
        <button type="submit" disabled={code.length !== 4 || busy} className="btn btn-primary h-16 text-2xl">
          {busy && <Spinner />}
          دخول
        </button>
      </form>
    </main>
  );
}
