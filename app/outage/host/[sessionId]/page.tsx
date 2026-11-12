"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { OutageHost } from "@/components/outage/OutageHost";

export default function OutageHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) {
    return (
      <div className="oc oc-page oc-center">
        <span className="oc-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  if (creds === null) {
    return (
      <div className="oc oc-page oc-center">
        <div className="oc-card oc-stack">
          <p className="oc-error">{errorMessage("FORBIDDEN")}</p>
          <Link href="/games" className="oc-btn oc-btn-primary">
            غرفة جديدة
          </Link>
        </div>
      </div>
    );
  }
  return <OutageHost creds={creds} />;
}
