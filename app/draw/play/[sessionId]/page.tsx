"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { DrawPhone } from "@/components/draw/DrawPhone";

export default function DrawPlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) {
    return (
      <div className="mw mw-page mw-center-page">
        <span className="mw-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  return <DrawPhone creds={creds} />;
}
