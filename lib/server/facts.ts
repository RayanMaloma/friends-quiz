import "server-only";
import factsJson from "@/data/facts.json";
import type { Fact } from "@/lib/types";
import { isKnownPerson } from "@/lib/people";

// Facts (and their owners) only ever load on the server. Guests receive the
// text of the current fact through role-filtered views, never the owner.
export function getFacts(): Fact[] {
  return (factsJson as Fact[]).filter(
    (f) => typeof f.text === "string" && f.text.trim() && isKnownPerson(f.personId),
  );
}
