"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { playerKey, type PlayerCreds } from "@/lib/client/storage";
import { useStored } from "@/lib/client/useStored";
import { OutagePhone } from "@/components/outage/OutagePhone";

export default function OutagePlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const creds = useStored<PlayerCreds>(playerKey(sessionId));
  useEffect(() => {
    if (creds === null) router.replace("/join");
  }, [creds, router]);
  if (!creds) {
    return (
      <div className="oc oc-page oc-center">
        <span className="oc-loader" aria-label="جاري التحميل" />
      </div>
    );
  }
  return <OutagePhone creds={creds} />;
}
