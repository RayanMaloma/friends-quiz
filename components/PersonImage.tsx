import Image from "next/image";
import { getPerson } from "@/lib/people";

const SIZES = {
  hero: "(min-width: 1024px) 45vw, 90vw",
} as const;

/**
 * Full transparent cutout, anchored to the bottom of its (relative, sized) parent.
 * The source PNG is used untouched; next/image only serves resized copies.
 * Portraits only appear on the TV once a fact is revealed (and for a winner
 * who is a fact owner) — never in lobby/join, so nobody gets a preview.
 */
export function Portrait({
  personId,
  className = "",
}: {
  personId: string;
  className?: string;
}) {
  const person = getPerson(personId);
  if (!person) return null;
  return (
    <Image
      src={person.image}
      alt={person.name}
      fill
      sizes={SIZES.hero}
      loading="eager"
      className={`object-contain object-bottom select-none pointer-events-none ${className}`}
      draggable={false}
    />
  );
}

/** Invisible: warms the browser cache so the reveal portrait appears instantly. */
export function PortraitPreloader({ personIds }: { personIds: string[] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed -left-[200vw] top-0 h-[60vh] w-[45vw] opacity-0">
      {personIds.map((id) => (
        <div key={id} className="absolute inset-0">
          <Portrait personId={id} />
        </div>
      ))}
    </div>
  );
}
