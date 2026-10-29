"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerStore } from "@/lib/client/storage";
import { Scene } from "@/components/mafia/Scene";

/** Joining a Mafia room (reached from /join once the code is known). Same /api/guest join as every game. */
export default function MafiaJoinPage() {
  return (
    <Suspense fallback={null}>
      <MafiaJoin />
    </Suspense>
  );
}

function MafiaJoin() {
  const router = useRouter();
  const code = (useSearchParams().get("code") ?? "").replace(/\D/g, "").slice(0, 4);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canJoin, setCanJoin] = useState(true);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (code.length !== 4) {
      router.replace("/join");
      return;
    }
    void api<{ sessionId: string; kind: string; canJoin: boolean }>("/api/guest", { action: "lookup", code }).then(async (res) => {
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      if (res.kind !== "mafia") {
        router.replace(`/join?code=${code}`);
        return;
      }
      setCanJoin(res.canJoin);
      // Already in this room on this device: straight back in.
      const existing = playerStore.get(res.sessionId);
      if (existing) {
        const state = await api("/api/mafia", { action: "state", as: "guest", sessionId: existing.sessionId, playerToken: existing.playerToken });
        if (state.ok) router.replace(`/mafia/play/${existing.sessionId}`);
        else if (state.error === "NOT_A_PLAYER") playerStore.clear(existing.sessionId);
      }
    });
  }, [code, router]);

  const trimmed = name.trim();

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const res = await api<{ sessionId: string; playerToken: string; name: string; personId: string | null }>("/api/guest", {
      action: "join",
      code,
      name: trimmed,
      personId: null,
    });
    if (!res.ok) {
      setBusy(false);
      setError(errorMessage(res.error));
      return;
    }
    playerStore.save({ sessionId: res.sessionId, code, name: res.name, personId: null, playerToken: res.playerToken });
    router.replace(`/mafia/play/${res.sessionId}`);
  }

  return (
    <div className="mf mf-phone mf-joinpage">
      <Scene mood="lobby" lite />
      <form className="mf-join-form" onSubmit={join}>
        <p className="mf-eyebrow">غرفة <b dir="ltr">{code}</b></p>
        <h1 className="mf-wordmark">MAFIA</h1>
        <p className="mf-title-ar">المافيا</p>
        {!canJoin && <p className="mf-note">اللعبة بدأت · للرجوع اكتب نفس اسمك</p>}
        <label htmlFor="mf-name" className="mf-join-label">وش اسمك؟</label>
        <input
          id="mf-name"
          className="mf-input"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="go"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="mf-error" role="alert">{error}</p>}
        <button type="submit" className="mf-btn mf-btn-crimson mf-btn-lg" disabled={!trimmed || busy}>
          {busy && <span className="mf-loader" />}
          ادخل المدينة
        </button>
      </form>
    </div>
  );
}
