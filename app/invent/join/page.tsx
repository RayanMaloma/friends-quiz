"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerStore } from "@/lib/client/storage";

/** Joining an «اخترع إجابتك» room (reached from /join once the code is known). Same /api/guest join as every game. */
export default function InventJoinPage() {
  return (
    <Suspense fallback={null}>
      <InventJoin />
    </Suspense>
  );
}

function InventJoin() {
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
      if (res.kind !== "invent") {
        router.replace(`/join?code=${code}`);
        return;
      }
      setCanJoin(res.canJoin);
      // Already in this room on this device: straight back in (same identity, score and answers).
      const existing = playerStore.get(res.sessionId);
      if (existing) {
        const state = await api("/api/invent", { action: "state", as: "guest", sessionId: existing.sessionId, playerToken: existing.playerToken });
        if (state.ok) router.replace(`/invent/play/${existing.sessionId}`);
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
    const res = await api<{ sessionId: string; playerToken: string; name: string }>("/api/guest", {
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
    router.replace(`/invent/play/${res.sessionId}`);
  }

  return (
    <div className="iv iv-joinpage">
      <form className="iv-join-form iv-rise" onSubmit={join}>
        <p className="iv-round-pill self-center" dir="ltr" aria-label={`غرفة ${code}`}>
          {code}
        </p>
        <h1 className="iv-wordmark m-0 text-5xl">
          اخترع إجابتك <span className="bulb">💡</span>
        </h1>
        {!canJoin && <p className="iv-mute font-bold">اللعبة بدأت — ترجع بنفس اسمك فقط</p>}
        <input
          id="iv-name"
          aria-label="اسمك"
          className="iv-input text-center"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="go"
          placeholder="اسمك هنا"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="iv-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="iv-btn iv-btn-gold iv-btn-lg" disabled={!trimmed || busy}>
          {busy && <span className="iv-loader" />}
          ادخل
        </button>
      </form>
    </div>
  );
}
