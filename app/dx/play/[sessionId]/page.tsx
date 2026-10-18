"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { Spinner } from "@/components/ui";
import { DxPhone } from "@/components/dx/play/DxPhone";

export default function DxPlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) {
    return <main className="flex min-h-dvh items-center justify-center"><Spinner className="size-10 text-ink" /></main>;
  }
  return <DxPhone creds={creds} />;
}
