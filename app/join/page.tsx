"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerStore, type PlayerCreds } from "@/lib/client/storage";
import type { GuestView } from "@/lib/types";
import { PEOPLE } from "@/lib/people";
import { Brand, Decor, Spinner } from "@/components/ui";

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <Join />
    </Suspense>
  );
}

type Lookup = { sessionId: string; code: string; takenPersonIds: string[] };
/** "none" = regular player; otherwise the people.json id this player is linked to. */
type OwnerChoice = "none" | string | null;

function Join() {
  const router = useRouter();
  const params = useSearchParams();
  const codeParam = (params.get("code") ?? "").replace(/\D/g, "").slice(0, 4);

  const [code, setCode] = useState(codeParam);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<OwnerChoice>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<PlayerCreds | null>(null);
  const autoTried = useRef(false);

  const doLookup = useCallback(
    async (value: string) => {
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
      setOwner((o) => (o && o !== "none" && res.takenPersonIds.includes(o) ? null : o));
    },
    [router],
  );

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

  const trimmed = name.trim();
  const canJoin = !!lookup && trimmed.length > 0 && owner !== null && !busy;

  async function join() {
    if (!lookup || !canJoin) return;
    setBusy(true);
    setError(null);
    const res = await api<{ sessionId: string; playerToken: string; name: string; personId: string | null }>(
      "/api/guest",
      { action: "join", code: lookup.code, name: trimmed, personId: owner === "none" ? null : owner },
    );
    if (!res.ok) {
      setBusy(false);
      setError(errorMessage(res.error));
      if (res.error === "IDENTITY_TAKEN") void doLookup(lookup.code);
      return;
    }
    playerStore.save({
      sessionId: res.sessionId,
      code: lookup.code,
      name: res.name,
      personId: res.personId,
      playerToken: res.playerToken,
    });
    router.replace(`/play/${res.sessionId}`);
  }

  // ---- Step 2: name + optional fact-owner link (text only, no portraits) ----
  if (lookup) {
    return (
      <main className="safe-pad mx-auto flex min-h-dvh max-w-lg flex-col gap-6 pb-36">
        <header className="flex items-center justify-between">
          <button onClick={() => setLookup(null)} className="btn btn-ghost h-11 px-4 text-lg">
            رجوع
          </button>
          <span className="chunk-sm bg-card px-3 pb-1 pt-2 font-display text-lg leading-none">
            رمز <span dir="ltr">{lookup.code}</span>
          </span>
        </header>

        <section className="anim-rise flex flex-col gap-3">
          <label htmlFor="name" className="font-display text-4xl leading-tight">
            وش اسمك؟ ✍️
          </label>
          <input
            id="name"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="done"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="اكتب اسمك هنا"
            className="chunk h-20 w-full bg-card px-5 font-display text-3xl outline-none placeholder:text-mute/50 focus:bg-[#fffbea]"
          />
        </section>

        <section className="anim-rise flex flex-col gap-3" style={{ animationDelay: "80ms" }}>
          <div>
            <h2 className="font-display text-2xl leading-tight">عندك معلومات في اللعبة؟</h2>
            <p className="text-sm font-bold text-mute">لو أنت واحد منهم اختار اسمك — ما بتجاوب على معلوماتك</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {PEOPLE.map((p) => {
              const taken = lookup.takenPersonIds.includes(p.id);
              const sel = owner === p.id;
              return (
                <button
                  key={p.id}
                  disabled={taken}
                  onClick={() => setOwner(p.id)}
                  className={`chunk-sm h-16 px-3 pt-1 font-display text-xl leading-none transition-transform disabled:bg-cream-2 disabled:opacity-50 disabled:shadow-none ${
                    sel ? "-rotate-1 bg-sun" : "bg-card"
                  }`}
                >
                  {sel && "✓ "}
                  {p.name}
                  {taken && <span className="block pt-1 font-sans text-xs font-bold text-mute">داخل</span>}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setOwner("none")}
            className={`chunk-sm h-16 font-display text-xl leading-none transition-transform ${
              owner === "none" ? "rotate-1 bg-sky text-white" : "bg-card"
            }`}
          >
            {owner === "none" && "✓ "}لا، أنا بس ألعب 🎮
          </button>
        </section>

        <div className="sticky-bottom-safe fixed inset-x-0 bottom-0 bg-gradient-to-t from-cream via-cream/95 to-transparent px-4 pt-8">
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            {error && <p className="text-center font-bold text-pink">{error}</p>}
            <button onClick={join} disabled={!canJoin} className="btn btn-primary h-20 w-full text-3xl">
              {busy && <Spinner />}
              {!trimmed ? "اكتب اسمك" : owner === null ? "اختار من فوق" : "يلا ندخل! 🚀"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---- Step 1: room code ----
  return (
    <main className="safe-pad relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 overflow-hidden text-center">
      <Decor />
      <Brand className="anim-pop relative text-7xl" />
      {resume && (
        <button
          onClick={() => router.push(`/play/${resume.sessionId}`)}
          className="btn btn-ghost anim-rise relative h-16 w-full text-xl"
        >
          رجوع للعبة ({resume.code}) باسم {resume.name ?? ""}
        </button>
      )}
      <form
        className="anim-rise relative flex w-full flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void doLookup(code);
        }}
      >
        <label htmlFor="code" className="font-display text-3xl">
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
          className="chunk h-28 w-full bg-card pt-3 text-center font-display text-7xl tracking-[0.25em] outline-none placeholder:text-ink/15 focus:bg-[#fffbea]"
        />
        {error && <p className="font-bold text-pink">{error}</p>}
        <button type="submit" disabled={code.length !== 4 || busy} className="btn btn-primary h-20 text-3xl">
          {busy && <Spinner />}
          دخول
        </button>
      </form>
    </main>
  );
}
