"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { CourtHost } from "@/components/court/CourtHost";

export default function CourtHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) {
    return (
      <div className="ct ct-page ct-center">
        <span className="ct-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  if (creds === null) {
    return (
      <div className="ct ct-page ct-center">
        <div className="ct-card ct-stack">
          <p className="ct-error">{errorMessage("FORBIDDEN")}</p>
          <Link href="/games" className="ct-btn is-primary">
            غرفة جديدة
          </Link>
        </div>
      </div>
    );
  }
  return <CourtHost creds={creds} />;
}
