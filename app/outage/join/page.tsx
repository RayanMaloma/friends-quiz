"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { playerStore } from "@/lib/client/storage";
import { Emblem } from "@/components/outage/parts";

/** Joining a «انقطاع الاتصال» room (reached from /join once the code is known). Same /api/guest join as every game; a name, no account. */
export default function OutageJoinPage() {
  return (
    <Suspense fallback={null}>
      <OutageJoin />
    </Suspense>
  );
}

function OutageJoin() {
  const router = useRouter();
  const code = (useSearchParams().get("code") ?? "").replace(/\D/g, "").slice(0, 4);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (code.length !== 4) {
      router.replace("/join");
      return;
    }
    void api<{ sessionId: string; kind: string }>("/api/guest", { action: "lookup", code }).then(async (res) => {
      if (!res.ok) {
        setError(errorMessage(res.error));
        return;
      }
      if (res.kind !== "outage") {
        router.replace(`/join?code=${code}`);
        return;
      }
      // Already in this room on this device: straight back in (same identity and score).
      const existing = playerStore.get(res.sessionId);
      if (existing) {
        const state = await api("/api/outage", { action: "state", as: "guest", sessionId: existing.sessionId, playerToken: existing.playerToken });
        if (state.ok) router.replace(`/outage/play/${existing.sessionId}`);
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
    router.replace(`/outage/play/${res.sessionId}`);
  }

  return (
    <div className="oc oc-page oc-center">
      <form className="oc-card oc-stack oc-join-form" onSubmit={join}>
        <Emblem size={64} />
        <h1 className="oc-title">انقطاع الاتصال</h1>
        <span className="oc-code is-small" dir="ltr" aria-label={`غرفة ${code}`}>
          {code}
        </span>
        <input
          aria-label="اسمك"
          className="oc-input is-center"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="go"
          placeholder="اسمك"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="oc-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="oc-btn oc-btn-primary oc-btn-lg" disabled={!trimmed || busy}>
          {busy && <span className="oc-loader is-small" />}
          ادخل
        </button>
      </form>
    </div>
  );
}
