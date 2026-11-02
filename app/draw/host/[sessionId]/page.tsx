"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { DrawHost } from "@/components/draw/DrawHost";

export default function DrawHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) {
    return (
      <div className="mw mw-page mw-center-page">
        <span className="mw-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  if (creds === null) {
    return (
      <div className="mw mw-page mw-center-page">
        <div className="mw-card mw-stack">
          <p className="mw-error">{errorMessage("FORBIDDEN")}</p>
          <Link href="/games" className="mw-btn mw-btn-primary">غرفة جديدة</Link>
        </div>
      </div>
    );
  }
  return <DrawHost creds={creds} />;
}
