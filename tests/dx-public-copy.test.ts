import { describe, expect, it } from "vitest";
import { newDxDoc, normalizeDxDoc, validateDxDoc, type DxDoc } from "@/lib/dx/doc";
import { publicCopy } from "@/lib/dx/publicCopy";

// «المهرب السري»: the public copy of the group's private hidden-role game keeps
// every rule and role mechanic, and drops the group's names and photos.

const FRIENDS = ["عبدالرحمن", "مشعل", "ريان", "فهد"];

/** Like the private game: base roles renamed after friends, extra friend roles, photos everywhere. */
function privateGame(): DxDoc {
  const doc = newDxDoc("classic");
  const c = doc.config;
  doc.assets = [{ id: "asset_1", url: "/api/media/0b8f0c4e-0000-4000-8000-000000000001.webp", name: "WhatsApp_Image", folder: "مرفوعات", mime: "image/png", width: 1, height: 1, bytes: 1, createdAt: 1, updatedAt: 1 }];
  const lib = c.roles.find((r) => r.id === "role_lib")!;
  const fas = c.roles.find((r) => r.id === "role_fas")!;
  lib.name = FRIENDS[0];
  lib.portrait = { assetId: "asset_1", fit: "cover" };
  fas.name = FRIENDS[1];
  fas.description = `${FRIENDS[1]} يعرف فريقه`;
  c.roles.push({ ...structuredClone(lib), id: "role_friend_a", name: FRIENDS[2], knowledge: [] });
  c.roles.push({ ...structuredClone(fas), id: "role_friend_b", name: FRIENDS[3], knowledge: [] });
  for (const row of c.distribution) {
    row.counts.role_friend_a = 0;
    row.counts.role_friend_b = 0;
  }
  const card = c.cards.find((x) => x.type === "role")!;
  card.name = FRIENDS[2];
  card.front.image = { assetId: "asset_1" };
  c.identity.logo = { assetId: "asset_1" };
  c.mechanics.randomNames = [...FRIENDS];
  const { doc: normalized } = normalizeDxDoc(doc);
  return normalized!;
}

describe("public copy of a hidden-role game", () => {
  const source = privateGame();
  const sourceJson = JSON.stringify(source);
  const { doc, removedNames } = publicCopy(source, "المهرب السري");
  const json = JSON.stringify(doc);

  it("removes every friend name and every photo", () => {
    for (const name of FRIENDS) expect(json).not.toContain(name);
    expect(json).not.toContain("assetId");
    expect(json).not.toContain("/api/media/");
    expect(doc.assets).toEqual([]);
    expect(doc.cover).toBeNull();
    expect(doc.config.mechanics.randomNames).toEqual([]);
    expect(removedNames.sort()).toEqual([...FRIENDS].sort());
  });

  it("keeps the gameplay identical: roles, teams, knowledge, distribution, rules, deck, board", () => {
    const strip = (d: DxDoc) => d.config.roles.map(({ id, factionId, knowledge, canBeLeader, canBeNominee, canBeTargeted }) => ({ id, factionId, knowledge, canBeLeader, canBeNominee, canBeTargeted }));
    expect(strip(doc)).toEqual(strip(source));
    expect(doc.config.distribution).toEqual(source.config.distribution);
    expect(doc.config.rules).toEqual(source.config.rules);
    expect(doc.config.factions.map((f) => f.id)).toEqual(source.config.factions.map((f) => f.id));
    expect(doc.config.mechanics.deck).toEqual(source.config.mechanics.deck);
    expect(doc.config.tracks.map((t) => [t.id, t.spaces.length])).toEqual(source.config.tracks.map((t) => [t.id, t.spaces.length]));
    // The hidden leader (referenced by the win rules) keeps its themed name.
    expect(doc.config.roles.find((r) => r.id === "role_hitler")!.name).toBe(source.config.roles.find((r) => r.id === "role_hitler")!.name);
  });

  it("is a valid, playable game and leaves the private one untouched", () => {
    expect(normalizeDxDoc(doc).doc).not.toBeNull();
    expect(validateDxDoc(doc)).toEqual([]);
    expect(doc.title).toBe("المهرب السري");
    expect(doc.config.identity.name).toBe("المهرب السري");
    expect(JSON.stringify(source)).toBe(sourceJson);
  });
});
