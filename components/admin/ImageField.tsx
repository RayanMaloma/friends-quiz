"use client";

import { useRef, useState } from "react";
import { uploadImage, type UploadKind } from "@/lib/client/upload";
import { Img } from "@/components/Media";
import { Spinner } from "@/components/ui";

/**
 * Pick / replace / remove an image. Accepts a click, a drop, or a paste
 * (Ctrl+V of a screenshot while hovering).
 */
export function ImageField({
  value,
  onChange,
  kind,
  label = "صورة",
  className = "h-40",
  fit = "contain",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  kind: UploadKind;
  label?: string;
  className?: string;
  fit?: "contain" | "cover";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function handle(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    const res = await uploadImage(file, kind);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onChange(res.url);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void handle(e.dataTransfer.files[0]);
        }}
        onPaste={(e) => {
          const file = [...e.clipboardData.files][0];
          if (file) void handle(file);
        }}
        className={`panel-sm relative overflow-hidden ${className} ${over ? "bg-[#fffbea]" : value ? "bg-ink" : "bg-cream"}`}
      >
        {value ? (
          <>
            <Img src={value} alt="" sizes="400px" className={fit === "cover" ? "object-cover" : "object-contain"} />
            <div className="absolute bottom-2 start-2 flex gap-2">
              <button type="button" onClick={() => input.current?.click()} className="abtn abtn-sm">
                تغيير
              </button>
              <button type="button" onClick={() => onChange(null)} className="abtn abtn-danger abtn-sm">
                حذف
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-full flex-col items-center justify-center gap-1 text-center font-extrabold text-mute"
          >
            <span className="text-3xl">🖼️</span>
            <span>{label}</span>
            <span className="text-xs">اضغط أو اسحب الصورة هنا</span>
          </button>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-cream/80">
            <Spinner className="size-8 text-ink" />
          </div>
        )}
      </div>
      {error && <p className="text-sm font-bold text-pink">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
