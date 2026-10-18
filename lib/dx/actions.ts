import type { ID } from "@/lib/dx/types/config";
import type { Action, MatchState } from "@/lib/dx/types/match";

/**
 * Who may send which engine action. The engine checks the rules of the game;
 * this checks the *sender*: the TV (host) runs the public steps, each phone
 * only its own secret steps.
 */

export type Actor = { kind: "host" } | { kind: "player"; id: ID };

const HOST_ACTIONS = new Set<Action["type"]>([
  "NOMINATE",
  "REVEAL_VOTES",
  "RESOLVE_VOTE",
  "POWER_TARGET",
  "POWER_DONE",
  "ADMIN_END_REVEAL",
  "ADMIN_DECLARE_WINNER",
  "ADMIN_SKIP_POWER",
  "ADMIN_SET_LEADER",
  "ADMIN_ADJUST_TRACK",
  "ADMIN_ADJUST_TRACKER",
  "ADMIN_TOGGLE_ALIVE",
  "ADMIN_SKIP_TURN",
  "DISMISS_REMINDER",
]);

const isStr = (v: unknown, max = 80): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Shape check of an untrusted action. Returns null if malformed. */
export function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case "SEE_ROLE":
      return { type: "SEE_ROLE", playerId: "" };
    case "CAST_VOTE":
      return a.vote === "yes" || a.vote === "no" ? { type: "CAST_VOTE", playerId: "", vote: a.vote } : null;
    case "NOMINATE":
      return isStr(a.nomineeId) ? { type: "NOMINATE", nomineeId: a.nomineeId } : null;
    case "LEADER_DISCARD":
    case "NOMINEE_ENACT":
      return isInt(a.index, 0, 20) ? { type: a.type, index: a.index } : null;
    case "VETO_RESPONSE":
      return typeof a.accept === "boolean" ? { type: "VETO_RESPONSE", accept: a.accept } : null;
    case "POWER_TARGET":
      return isStr(a.targetId) ? { type: "POWER_TARGET", targetId: a.targetId } : null;
    case "ADMIN_DECLARE_WINNER":
      return isStr(a.factionId)
        ? { type: a.type, factionId: a.factionId, reason: typeof a.reason === "string" ? a.reason.slice(0, 200) : "" }
        : null;
    case "ADMIN_SET_LEADER":
    case "ADMIN_TOGGLE_ALIVE":
      return isStr(a.playerId) ? { type: a.type, playerId: a.playerId } : null;
    case "ADMIN_ADJUST_TRACK":
      return isStr(a.trackId) && isInt(a.delta, -20, 20) ? { type: a.type, trackId: a.trackId, delta: a.delta } : null;
    case "ADMIN_ADJUST_TRACKER":
      return isInt(a.delta, -20, 20) ? { type: a.type, delta: a.delta } : null;
    case "DISMISS_REMINDER":
      return isStr(a.ruleId) ? { type: a.type, ruleId: a.ruleId } : null;
    case "REVEAL_VOTES":
    case "RESOLVE_VOTE":
    case "REQUEST_VETO":
    case "POWER_DONE":
    case "ADMIN_END_REVEAL":
    case "ADMIN_SKIP_POWER":
    case "ADMIN_SKIP_TURN":
      return { type: a.type };
    default:
      return null;
  }
}

/**
 * Returns the action to run (with the sender's own id filled in), or null if
 * this sender may not do it right now.
 */
export function authorize(m: MatchState, actor: Actor, action: Action): Action | null {
  if (actor.kind === "host") return HOST_ACTIONS.has(action.type) ? action : null;

  const me = actor.id;
  if (!m.players.some((p) => p.id === me)) return null;
  switch (action.type) {
    case "SEE_ROLE":
      return { type: "SEE_ROLE", playerId: me };
    case "CAST_VOTE":
      return { ...action, playerId: me };
    case "LEADER_DISCARD":
    case "VETO_RESPONSE":
      return m.leaderId === me ? action : null;
    case "NOMINEE_ENACT":
    case "REQUEST_VETO":
      return m.nomineeId === me ? action : null;
    case "POWER_DONE": {
      // The leader closes a private power (peek / investigation result) from their phone.
      const pp = m.pendingPower;
      const privateDone = pp && (pp.kind === "peek" || (pp.kind === "investigate" && !!pp.result));
      return m.leaderId === me && privateDone ? action : null;
    }
    default:
      return null;
  }
}
