import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import people from "@/data/people.json";
import facts from "@/data/facts.json";

// Guards the content files: any number of fact owners, every one wired up.
describe("content data", () => {
  it("people have unique ids and an existing transparent PNG", () => {
    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
    for (const p of people) {
      const file = path.join(__dirname, "..", "public", p.image);
      expect(existsSync(file), p.image).toBe(true);
      const buf = readFileSync(file);
      expect(buf.subarray(1, 4).toString()).toBe("PNG");
      expect(buf[25], `${p.image} should be RGBA`).toBe(6);
    }
  });

  it("facts have unique ids and belong to a known person", () => {
    const ids = new Set(people.map((p) => p.id));
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
    for (const f of facts) expect(ids.has(f.personId), f.id).toBe(true);
  });

  it("includes Yazid as a fact owner", () => {
    expect(people.find((p) => p.id === "yazid")).toMatchObject({ name: "يزيد", image: "/people/yazid.png" });
    expect(facts.some((f) => f.personId === "yazid")).toBe(true);
  });
});
