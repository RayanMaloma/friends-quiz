"use client";

import { useEffect, useState } from "react";
import type { Asset, GameConfig } from "@/lib/dx/types/config";
import { api } from "@/lib/client/api";

type Who = { as: "host"; sessionId: string; hostToken: string } | { as: "guest"; sessionId: string; playerToken: string };

/** The session's frozen design (rules, cards, theme, images). Fetched once, retried until it arrives. */
export function useDxConfig(who: Who): { game: GameConfig; assets: Asset[] } | null {
  const [design, setDesign] = useState<{ game: GameConfig; assets: Asset[] } | null>(null);
  const key = JSON.stringify(who);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const res = await api<{ game: GameConfig; assets: Asset[] }>("/api/dx", { action: "config", ...JSON.parse(key) });
      if (!alive) return;
      if (res.ok) setDesign({ game: res.game, assets: res.assets });
      else timer = setTimeout(load, 2000);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key]);
  return design;
}
