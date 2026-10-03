// People are not secret: safe to import on the client.
// Facts are NOT imported here on purpose (see lib/server/facts.ts).
import peopleJson from "@/data/people.json";
import type { Person } from "@/lib/types";

export const PEOPLE: Person[] = peopleJson as Person[];

const byId = new Map(PEOPLE.map((p) => [p.id, p]));

export function getPerson(id: string): Person | undefined {
  return byId.get(id);
}

export function personName(id: string): string {
  return byId.get(id)?.name ?? id;
}

export function isKnownPerson(id: unknown): id is string {
  return typeof id === "string" && byId.has(id);
}
