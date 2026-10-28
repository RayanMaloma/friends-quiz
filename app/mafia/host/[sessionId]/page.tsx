"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { MafiaHost } from "@/components/mafia/MafiaHost";
import { Plain } from "@/components/mafia/parts";

export default function MafiaHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) return <Plain><span className="mf-loader" aria-label="جاري التحميل" /></Plain>;
  if (creds === null) {
    return (
      <Plain>
        <p className="mf-plain-title">{errorMessage("FORBIDDEN")}</p>
        <Link href="/host" className="mf-btn mf-btn-gold">غرفة جديدة</Link>
      </Plain>
    );
  }
  return <MafiaHost creds={creds} />;
}
