"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { InventPhone } from "@/components/invent/InventPhone";

export default function InventPlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) {
    return (
      <div className="iv iv-joinpage">
        <span className="iv-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  return <InventPhone creds={creds} />;
}
