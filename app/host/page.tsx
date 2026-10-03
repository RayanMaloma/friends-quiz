"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, errorMessage } from "@/lib/client/api";
import { hostStore, type HostCreds } from "@/lib/client/storage";
import type { HostView } from "@/lib/types";
import { Brand, Spinner } from "@/components/ui";

export default function HostEntryPage() {
  const router = useRouter();
  const [resumable, setResumable] = useState<HostCreds | null>(null);
  const [checking, setChecking] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Offer to resume an unfinished game this browser is hosting.
  useEffect(() => {
    const last = hostStore.last();
    const check = last
      ? api<{ view: HostView }>("/api/host", {
          action: "state",
          sessionId: last.sessionId,
          hostToken: last.hostToken,
        }).then((res) => (res.ok && res.view.status !== "FINISHED" ? last : null))
      : Promise.resolve(null);
    void check.then((r) => {
      setResumable(r);
      setChecking(false);
    });
  }, []);

  async function createGame() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const res = await api<{ sessionId: string; code: string; hostToken: string }>("/api/host", {
      action: "create",
    });
    if (!res.ok) {
      setError(errorMessage(res.error));
      setCreating(false);
      return;
    }
    hostStore.save({ sessionId: res.sessionId, code: res.code, hostToken: res.hostToken });
    router.replace(`/host/${res.sessionId}`);
  }

  return (
    <main className="safe-pad flex min-h-dvh flex-col items-center justify-center gap-10 text-center">
      <Brand className="anim-pop text-7xl" />
      <div className="anim-rise flex w-full max-w-md flex-col gap-4">
        {checking ? (
          <Spinner className="mx-auto size-8 text-sun" />
        ) : (
          <>
            {resumable && (
              <Link href={`/host/${resumable.sessionId}`} className="btn btn-primary h-16 text-2xl">
                كمّل اللعبة ({resumable.code})
              </Link>
            )}
            <button
              onClick={createGame}
              disabled={creating}
              className={`btn h-16 text-2xl ${resumable ? "btn-ghost" : "btn-primary"}`}
            >
              {creating ? <Spinner /> : null}
              {resumable ? "لعبة جديدة" : "إنشاء لعبة"}
            </button>
          </>
        )}
        {error && <p className="font-bold text-rose">{error}</p>}
      </div>
      <p className="max-w-md text-mute">
        افتح هذي الصفحة على اللابتوب الموصول بالتلفزيون. الجوالات تدخل من صفحة «دخول لعبة».
      </p>
    </main>
  );
}
