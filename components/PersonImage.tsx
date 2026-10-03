import Image from "next/image";
import { getPerson } from "@/lib/people";

const SIZES = {
  hero: "(min-width: 1024px) 45vw, 90vw",
  card: "(min-width: 1024px) 18vw, 45vw",
  avatar: "160px",
} as const;

/**
 * Full transparent cutout, anchored to the bottom of its (relative, sized) parent.
 * The source PNG is used untouched; next/image only serves resized copies.
 */
export function Portrait({
  personId,
  size = "card",
  className = "",
  eager = false,
}: {
  personId: string;
  size?: keyof typeof SIZES;
  className?: string;
  eager?: boolean;
}) {
  const person = getPerson(personId);
  if (!person) return null;
  return (
    <Image
      src={person.image}
      alt={person.name}
      fill
      sizes={SIZES[size]}
      loading={eager ? "eager" : "lazy"}
      className={`object-contain object-bottom select-none pointer-events-none ${className}`}
      draggable={false}
    />
  );
}

/** Round head-and-shoulders crop of the cutout on a colored disc. */
export function Avatar({
  personId,
  className = "size-14",
  ring = "bg-panel-2",
}: {
  personId: string;
  className?: string;
  ring?: string;
}) {
  const person = getPerson(personId);
  if (!person) return null;
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-full ${ring} ${className}`}>
      <Image
        src={person.image}
        alt=""
        fill
        sizes={SIZES.avatar}
        className="origin-[50%_30%] scale-110 object-cover object-[50%_20%] select-none pointer-events-none"
        draggable={false}
      />
    </span>
  );
}

/** Loads every hero-size portrait up front so reveals appear instantly on the TV. */
export function PortraitPreloader({ personIds }: { personIds: string[] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed -left-[200vw] top-0 h-[60vh] w-[45vw] opacity-0">
      {personIds.map((id) => (
        <div key={id} className="absolute inset-0">
          <Portrait personId={id} size="hero" eager />
        </div>
      ))}
    </div>
  );
}
