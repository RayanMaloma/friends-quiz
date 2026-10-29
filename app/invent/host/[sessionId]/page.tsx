"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { errorMessage } from "@/lib/client/api";
import { hostKey, type HostCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { InventHost } from "@/components/invent/InventHost";

export default function InventHostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const creds = useStored<HostCreds>(hostKey(sessionId));
  if (creds === undefined) {
    return (
      <div className="iv iv-joinpage">
        <span className="iv-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  if (creds === null) {
    return (
      <div className="iv iv-joinpage">
        <div className="iv-join-form">
          <p className="iv-error">{errorMessage("FORBIDDEN")}</p>
          <Link href="/host" className="iv-btn iv-btn-gold">غرفة جديدة</Link>
        </div>
      </div>
    );
  }
  return <InventHost creds={creds} />;
}
