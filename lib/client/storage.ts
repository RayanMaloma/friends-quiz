// localStorage helpers. Wrapped in try/catch: private modes can throw.

export interface PlayerCreds {
  sessionId: string;
  code: string;
  name: string;
  /** Fact-owner link (people.json id) or null for a regular player. */
  personId: string | null;
  playerToken: string;
}

export interface HostCreds {
  sessionId: string;
  code: string;
  hostToken: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const hostKey = (sessionId: string) => `fq:host:${sessionId}`;
export const playerKey = (sessionId: string) => `fq:player:${sessionId}`;

export const hostStore = {
  get: (sessionId: string) => read<HostCreds>(hostKey(sessionId)),
  last: () => {
    const id = read<string>("fq:host:last");
    return id ? read<HostCreds>(hostKey(id)) : null;
  },
  save: (creds: HostCreds) => {
    write(hostKey(creds.sessionId), creds);
    write("fq:host:last", creds.sessionId);
  },
};

export const playerStore = {
  get: (sessionId: string) => read<PlayerCreds>(playerKey(sessionId)),
  last: () => {
    const id = read<string>("fq:player:last");
    return id ? read<PlayerCreds>(playerKey(id)) : null;
  },
  save: (creds: PlayerCreds) => {
    write(playerKey(creds.sessionId), creds);
    write("fq:player:last", creds.sessionId);
  },
  clear: (sessionId: string) => {
    write(playerKey(sessionId), null);
    if (read<string>("fq:player:last") === sessionId) write("fq:player:last", null);
  },
};
