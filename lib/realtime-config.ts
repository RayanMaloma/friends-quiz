export const SYNC_EVENT = "sync";

export function gameChannelName(sessionId: string): string {
  return `game-${sessionId}`;
}
