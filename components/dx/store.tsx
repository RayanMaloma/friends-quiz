"use client";

/**
 * Context shared by every deduction component.
 *
 * - <StudioProvider>: the admin editor. Holds the design (GameConfig) and its
 *   image library; the page above it autosaves them to the database.
 * - <PlayProvider>: the TV and the phones. Read-only design + a `dispatch`
 *   that sends an engine action to the server.
 *
 * Components only call useStore(); fields a provider doesn't support are no-ops.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Asset, GameConfig, Theme } from "@/lib/dx/types/config";
import type { Action } from "@/lib/dx/types/match";
import { deepClone, uid } from "@/lib/dx/config/ids";
import { TEMPLATES } from "@/lib/dx/config/templates";
import { validateConfig } from "@/lib/dx/config/validate";
import { fileToAsset, referencedAssetIds } from "@/lib/dx/assets/assetUtils";
import { themeContainerProps } from "@/lib/dx/theme/applyTheme";

export interface Toast { id: string; text: string; kind: "info" | "success" | "error" }
export type StudioTab = "identity" | "theme" | "board" | "cards" | "roles" | "rules" | "assets" | "share";

interface StoreValue {
  config: GameConfig;
  theme: Theme;
  assets: Record<string, Asset>;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;
  // studio
  editable: boolean;
  previewThemeId: string | null;
  setPreviewTheme: (id: string | null) => void;
  go: (tab: StudioTab) => void;
  update: (fn: (c: GameConfig) => void) => void;
  resetPreset: () => void;
  importConfig: (text: string) => { errors: string[]; warnings: string[] };
  exportConfig: () => string;
  addAssets: (files: File[], folder: string) => Promise<Asset[]>;
  replaceAsset: (id: string, file: File) => Promise<void>;
  patchAsset: (id: string, patch: Partial<Pick<Asset, "name" | "folder">>) => void;
  deleteAsset: (id: string) => void;
  isAssetUsedAnywhere: (id: string) => boolean;
  // play
  dispatch: (a: Action) => Promise<string | null>;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside a deduction provider");
  return v;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = uid("toast");
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, toast, dismissToast };
}

function activeTheme(config: GameConfig, previewId?: string | null): Theme {
  return (
    config.themes.find((t) => t.id === previewId) ??
    config.themes.find((t) => t.id === config.activeThemeId) ??
    config.themes[0]
  );
}

const noop = () => {};
const asyncNoop = async () => {};

/* ------------------------------------------------------------------ */

export function PlayProvider({ config, assets, dispatch, children }: {
  config: GameConfig;
  assets: Asset[];
  dispatch: (a: Action) => Promise<string | null>;
  children: React.ReactNode;
}) {
  const { toasts, toast, dismissToast } = useToasts();
  const value = useMemo<StoreValue>(() => {
    const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
    return {
      config, theme: activeTheme(config), assets: byId, toasts, toast, dismissToast,
      editable: false, previewThemeId: null, setPreviewTheme: noop, go: noop, update: noop, resetPreset: noop,
      importConfig: () => ({ errors: [], warnings: [] }), exportConfig: () => "",
      addAssets: async () => [], replaceAsset: asyncNoop, patchAsset: noop, deleteAsset: noop,
      isAssetUsedAnywhere: () => false, dispatch,
    };
  }, [config, assets, toasts, toast, dismissToast, dispatch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */

export interface StudioDoc { config: GameConfig; assets: Asset[] }

export function StudioProvider({ doc, onChange, onTab, children }: {
  doc: StudioDoc;
  /** Receives every edit; the page autosaves. */
  onChange: (fn: (d: StudioDoc) => StudioDoc) => void;
  onTab: (tab: StudioTab) => void;
  children: React.ReactNode;
}) {
  const { toasts, toast, dismissToast } = useToasts();
  const [previewThemeId, setPreviewTheme] = useState<string | null>(null);

  const value = useMemo<StoreValue>(() => {
    const assets = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
    const update = (fn: (c: GameConfig) => void) =>
      onChange((d) => {
        const config = deepClone(d.config);
        fn(config);
        config.updatedAt = Date.now();
        return { ...d, config };
      });
    return {
      config: doc.config,
      theme: activeTheme(doc.config, previewThemeId),
      assets, toasts, toast, dismissToast,
      editable: true, previewThemeId, setPreviewTheme, go: onTab, update,
      resetPreset: () => {
        const tpl = (TEMPLATES[doc.config.baseTemplate] ?? TEMPLATES.classic).make();
        onChange((d) => ({ ...d, config: tpl }));
        toast("رجعت اللعبة للإعدادات الأصلية.", "success");
      },
      importConfig: (text: string) => {
        let raw: unknown;
        try { raw = JSON.parse(text); } catch (e) {
          return { errors: [`الملف مو JSON صالح: ${(e as Error).message}`], warnings: [] };
        }
        // Our own export: { format, doc: { config, assets } }. Also accepts a bare config.
        const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const d = (o.doc && typeof o.doc === "object" ? o.doc : o) as Record<string, unknown>;
        const res = validateConfig(d.config ?? d);
        if (!res.config) return { errors: res.errors, warnings: res.warnings };
        const imported = Array.isArray(d.assets) ? (d.assets as Asset[]).filter((a) => a && typeof a.id === "string" && typeof a.url === "string") : [];
        onChange((cur) => {
          const ids = new Set(cur.assets.map((a) => a.id));
          return { config: res.config!, assets: [...cur.assets, ...imported.filter((a) => !ids.has(a.id))] };
        });
        return { errors: [], warnings: res.warnings };
      },
      exportConfig: () => JSON.stringify({ format: "shilla-deduction", version: 1, doc: { kind: "deduction", config: doc.config, assets: doc.assets } }, null, 2),
      addAssets: async (files: File[], folder: string) => {
        const added: Asset[] = [];
        for (const f of files) {
          try { added.push(await fileToAsset(f, folder)); } catch (e) { toast((e as Error).message, "error"); }
        }
        if (added.length) {
          onChange((d) => ({ ...d, assets: [...d.assets, ...added] }));
          toast(added.length === 1 ? "انرفعت الصورة." : `انرفعت ${added.length} صور.`, "success");
        }
        return added;
      },
      replaceAsset: async (id: string, file: File) => {
        try {
          const next = await fileToAsset(file, "");
          onChange((d) => ({
            ...d,
            assets: d.assets.map((a) => (a.id === id ? { ...a, url: next.url, mime: next.mime, width: next.width, height: next.height, bytes: next.bytes, updatedAt: Date.now() } : a)),
          }));
          toast("تم استبدال الصورة في كل مكان.", "success");
        } catch (e) { toast((e as Error).message, "error"); }
      },
      patchAsset: (id, patch) => onChange((d) => ({ ...d, assets: d.assets.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)) })),
      deleteAsset: (id) => onChange((d) => ({ ...d, assets: d.assets.filter((a) => a.id !== id) })),
      isAssetUsedAnywhere: (id) => referencedAssetIds(doc.config).has(id),
      dispatch: async () => null,
    };
  }, [doc, onChange, onTab, previewThemeId, toasts, toast, dismissToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */

/** The themed root every deduction screen renders inside. */
export function DxRoot({ children, className = "", fill = true }: { children: React.ReactNode; className?: string; fill?: boolean }) {
  const { theme, assets, toasts, dismissToast } = useStore();
  const props = themeContainerProps(theme, assets);
  return (
    <div className={`dx ${fill ? "dx-fill" : ""} ${className}`} dir="rtl" {...props}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span>{t.text}</span>
            <button type="button" className="dbtn dbtn-ghost dbtn-icon" aria-label="إغلاق" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
