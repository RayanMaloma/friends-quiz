import { describe, expect, it } from "vitest";
import { createMatch, reduce, redactFor } from "@/lib/dx/engine/engine";
import { eligibleNominees, powerTargets, vetoAvailable, voters } from "@/lib/dx/engine/helpers";
import { TEMPLATES } from "@/lib/dx/config/templates";
import { validateConfig } from "@/lib/dx/config/validate";
import { authorize, parseAction, type Actor } from "@/lib/dx/actions";
import { newDxDoc, normalizeDxDoc, validateDxDoc } from "@/lib/dx/doc";
import { waitingFor } from "@/lib/dx/views";
import type { Action, MatchState } from "@/lib/dx/types/match";

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const HOST: Actor = { kind: "host" };
const player = (id: string): Actor => ({ kind: "player", id });

function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`, name: `لاعب ${i + 1}` }));
}

/** The next move, sent by the device that would send it in the real game. */
function nextMove(s: MatchState): { actor: Actor; action: Action } {
  switch (s.phase) {
    case "roleReveal": {
      const p = s.players.find((x) => !s.roleSeen.includes(x.id))!;
      return { actor: player(p.id), action: { type: "SEE_ROLE", playerId: "" } };
    }
    case "nominate":
      return { actor: HOST, action: { type: "NOMINATE", nomineeId: pick(eligibleNominees(s)).id } };
    case "vote": {
      const missing = voters(s).find((p) => !s.votes[p.id]);
      return missing
        ? { actor: player(missing.id), action: { type: "CAST_VOTE", playerId: "", vote: Math.random() < 0.6 ? "yes" : "no" } }
        : { actor: HOST, action: { type: "REVEAL_VOTES" } };
    }
    case "voteReveal":
      return { actor: HOST, action: { type: "RESOLVE_VOTE" } };
    case "leaderLegislate":
      return { actor: player(s.leaderId), action: { type: "LEADER_DISCARD", index: Math.floor(Math.random() * s.hand.length) } };
    case "nomineeLegislate":
      return {
        actor: player(s.nomineeId!),
        action: vetoAvailable(s) && Math.random() < 0.3 ? { type: "REQUEST_VETO" } : { type: "NOMINEE_ENACT", index: Math.floor(Math.random() * s.hand.length) },
      };
    case "vetoResponse":
      return { actor: player(s.leaderId), action: { type: "VETO_RESPONSE", accept: Math.random() < 0.5 } };
    case "power": {
      const pp = s.pendingPower!;
      const t = powerTargets(s);
      if ((pp.kind === "investigate" && !pp.result) || pp.kind === "execute" || pp.kind === "specialElection") {
        if (t.length) return { actor: HOST, action: { type: "POWER_TARGET", targetId: pick(t).id } };
      }
      // Private powers are closed by the leader's phone; anything else by the TV.
      const privateDone = pp.kind === "peek" || (pp.kind === "investigate" && !!pp.result);
      return { actor: privateDone ? player(s.leaderId) : HOST, action: { type: "POWER_DONE" } };
    }
    default:
      throw new Error(`bad phase ${s.phase}`);
  }
}

describe("deduction engine through the sender checks", () => {
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    it(`plays random ${key} games to the end with every player count`, () => {
      const cfg = tpl.make();
      expect(validateConfig(JSON.parse(JSON.stringify(cfg))).errors).toEqual([]);
      for (let n = cfg.mechanics.minPlayers; n <= cfg.mechanics.maxPlayers; n++) {
        for (let g = 0; g < 40; g++) {
          const created = createMatch(cfg, { players: seats(n) });
          expect(created.error).toBeUndefined();
          let s = created.state;
          let steps = 0;
          while (s.phase !== "gameOver" && steps++ < 3000) {
            const { actor, action } = nextMove(s);
            const move = authorize(s, actor, action);
            expect(move, `${actor.kind} may ${action.type} in ${s.phase}`).not.toBeNull();
            const r = reduce(s, move!);
            expect(r.error, `${action.type} in ${s.phase}`).toBeUndefined();
            s = r.state;
          }
          expect(s.phase).toBe("gameOver");
          expect(s.winner).toBeDefined();
        }
      }
    });
  }
});

describe("who may act", () => {
  const start = () => {
    let s = createMatch(TEMPLATES.classic.make(), { players: seats(7) }).state;
    for (const p of s.players) s = reduce(s, { type: "SEE_ROLE", playerId: p.id }).state;
    return s;
  };

  it("players can only act for themselves, and only in their own secret steps", () => {
    let s = start();
    expect(s.phase).toBe("nominate");
    const other = s.players.find((p) => p.id !== s.leaderId)!;
    // Phones cannot run the public steps; the TV cannot run the secret ones.
    expect(authorize(s, player(s.leaderId), { type: "NOMINATE", nomineeId: other.id })).toBeNull();
    s = reduce(s, authorize(s, HOST, { type: "NOMINATE", nomineeId: eligibleNominees(s)[0].id })!).state;
    expect(authorize(s, HOST, { type: "CAST_VOTE", playerId: other.id, vote: "yes" })).toBeNull();
    // A forged playerId is replaced with the sender's own id.
    const forged = authorize(s, player(other.id), { type: "CAST_VOTE", playerId: s.leaderId, vote: "no" });
    expect(forged).toEqual({ type: "CAST_VOTE", playerId: other.id, vote: "no" });
    for (const p of voters(s)) s = reduce(s, { type: "CAST_VOTE", playerId: p.id, vote: "yes" }).state;
    s = reduce(s, { type: "REVEAL_VOTES" }).state;
    s = reduce(s, { type: "RESOLVE_VOTE" }).state;
    expect(s.phase).toBe("leaderLegislate");
    const bystander = s.players.find((p) => p.id !== s.leaderId && p.id !== s.nomineeId)!;
    expect(authorize(s, player(bystander.id), { type: "LEADER_DISCARD", index: 0 })).toBeNull();
    expect(authorize(s, player(s.nomineeId!), { type: "LEADER_DISCARD", index: 0 })).toBeNull();
    expect(authorize(s, HOST, { type: "LEADER_DISCARD", index: 0 })).toBeNull();
    expect(authorize(s, player(s.leaderId), { type: "LEADER_DISCARD", index: 0 })).not.toBeNull();
    // Strangers (not seated) can do nothing.
    expect(authorize(s, player("nobody"), { type: "SEE_ROLE", playerId: "" })).toBeNull();
    expect(waitingFor(s)).toEqual([s.leaderId]);
  });

  it("rejects malformed actions", () => {
    expect(parseAction({ type: "CAST_VOTE", vote: "maybe" })).toBeNull();
    expect(parseAction({ type: "LEADER_DISCARD", index: -1 })).toBeNull();
    expect(parseAction({ type: "ADMIN_ADJUST_TRACK", trackId: "x", delta: 1000 })).toBeNull();
    expect(parseAction({ type: "HACK" })).toBeNull();
    expect(parseAction({ type: "VETO_RESPONSE", accept: true })).toEqual({ type: "VETO_RESPONSE", accept: true });
  });
});

describe("redaction (what each device receives)", () => {
  it("never leaks roles, hands, ballots or private power results", () => {
    for (let g = 0; g < 30; g++) {
      let s = createMatch(TEMPLATES.classic.make(), { players: seats(9) }).state;
      let steps = 0;
      while (s.phase !== "gameOver" && steps++ < 3000) {
        const tv = redactFor(s, "public");
        expect(tv.players.every((p) => p.roleId === "hidden")).toBe(true);
        expect(tv.hand.every((c) => c === "hidden")).toBe(true);
        expect(tv.drawPile.every((c) => c === "hidden")).toBe(true);
        if (s.phase === "vote") expect(Object.values(tv.votes as Record<string, string>).every((v) => v === "hidden")).toBe(true);
        expect(tv.pendingPower?.result).toBeUndefined();
        expect(tv.pendingPower?.peek).toBeUndefined();
        for (const p of s.players) {
          const phone = redactFor(s, p.id);
          expect(phone.players.filter((x) => x.roleId !== "hidden").map((x) => x.id)).toEqual([p.id]);
          const holds = (s.phase === "leaderLegislate" && p.id === s.leaderId) ||
            ((s.phase === "nomineeLegislate" || s.phase === "vetoResponse") && p.id === s.nomineeId);
          if (!holds) expect(phone.hand.every((c) => c === "hidden")).toBe(true);
          if (p.id !== s.leaderId) expect(phone.pendingPower?.result ?? phone.pendingPower?.peek).toBeUndefined();
        }
        const { actor, action } = nextMove(s);
        s = reduce(s, authorize(s, actor, action)!).state;
      }
      // After the game, everyone sees every role.
      expect(redactFor(s, "public").players.every((p) => p.roleId !== "hidden")).toBe(true);
    }
  });
});

describe("deduction game document", () => {
  it("templates are valid, playable and survive normalization", () => {
    for (const t of ["classic", "shadow"]) {
      const doc = newDxDoc(t);
      expect(validateDxDoc(doc)).toEqual([]);
      const again = normalizeDxDoc(JSON.parse(JSON.stringify(doc)));
      expect(again.errors).toEqual([]);
      expect(again.doc?.config.identity.name).toBe(doc.config.identity.name);
    }
  });

  it("refuses broken designs and strips unsafe asset URLs", () => {
    expect(normalizeDxDoc({ kind: "deduction", config: { identity: {} } }).doc).toBeNull();
    const doc = newDxDoc("classic");
    const res = normalizeDxDoc({
      ...doc,
      assets: [
        { id: "a1", url: "/api/media/abc.webp", name: "ok" },
        { id: "a2", url: "javascript:alert(1)", name: "bad" },
        { id: "a3", url: "\") ; background:url(http://x", name: "css" },
      ],
    });
    expect(res.doc?.assets.map((a) => a.id)).toEqual(["a1"]);
  });

  it("reports player counts that can't be dealt", () => {
    const doc = newDxDoc("classic");
    doc.config.mechanics.maxPlayers = 12;
    expect(validateDxDoc(doc).length).toBeGreaterThan(0);
  });
});
