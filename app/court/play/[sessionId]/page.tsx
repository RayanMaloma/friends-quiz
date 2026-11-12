"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { CourtPhone } from "@/components/court/CourtPhone";

export default function CourtPlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) {
    return (
      <div className="ct ct-page ct-center">
        <span className="ct-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  return <CourtPhone creds={creds} />;
}
