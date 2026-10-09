import Image from "next/image";
import type { Person } from "@/lib/types";

/**
 * Images come from the game document: our own uploads (/api/media/…), files
 * in /public, or https URLs. Local ones go through next/image (resized,
 * modern formats); remote ones are shown as-is.
 */
export function Img({
  src,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized={src.startsWith("https://")}
      loading={priority ? "eager" : undefined}
      draggable={false}
      className={`select-none ${className}`}
    />
  );
}

/**
 * Full portrait, anchored to the bottom of its (relative, sized) parent.
 * Transparent cutouts look best. Falls back to a big initial if the person
 * has no image.
 */
export function Portrait({ person, className = "" }: { person: Person; className?: string }) {
  if (!person.image) {
    return (
      <div className="absolute inset-0 flex items-end justify-center pb-[6%]">
        <span className="chunk-tv grid aspect-square h-[62%] place-items-center rounded-full bg-card font-display text-[22vh] leading-none">
          <span className="pt-[0.2em]">{[...person.name.trim()][0] ?? "؟"}</span>
        </span>
      </div>
    );
  }
  return (
    <Img
      src={person.image}
      alt={person.name}
      sizes="(min-width: 1024px) 45vw, 90vw"
      priority
      className={`pointer-events-none object-contain object-bottom ${className}`}
    />
  );
}

/** Invisible: warms the browser cache so reveal images appear instantly. */
export function Preloader({ people, images }: { people: Person[]; images: string[] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed -left-[200vw] top-0 h-[60vh] w-[45vw] opacity-0">
      {people.map((p) => (
        <div key={p.id} className="absolute inset-0">
          <Portrait person={p} />
        </div>
      ))}
      {images.map((src) => (
        <div key={src} className="absolute inset-0">
          <Img src={src} alt="" sizes="80vw" priority />
        </div>
      ))}
    </div>
  );
}
