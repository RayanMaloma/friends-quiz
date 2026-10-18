"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { Spinner } from "@/components/ui";
import { DxHost } from "@/components/dx/play/DxHost";

export default function DxHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) {
    return <main className="flex min-h-dvh items-center justify-center"><Spinner className="size-10 text-ink" /></main>;
  }
  if (creds === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 text-center">
        <p className="font-display text-4xl">{errorMessage("FORBIDDEN")}</p>
        <Link href="/host" className="btn btn-primary h-16 px-8 text-2xl">إنشاء لعبة جديدة</Link>
      </main>
    );
  }
  return <DxHost creds={creds} />;
}
