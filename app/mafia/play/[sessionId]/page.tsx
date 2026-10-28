"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { MafiaPhone } from "@/components/mafia/MafiaPhone";
import { Plain } from "@/components/mafia/parts";

export default function MafiaPlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) return <Plain><span className="mf-loader" aria-label="جاري التحميل" /></Plain>;
  return <MafiaPhone creds={creds} />;
}
