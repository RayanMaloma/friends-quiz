# عن مين؟ — Friends Quiz

A private, Kahoot-style party game. The facts belong to six friends (`data/people.json`),
but **any number of people can play** (tested with 13). A fact appears on the TV,
everyone guesses on their phone which of the six it's about, the TV reveals the answer, shows
how the group voted, and keeps the leaderboard.

**The TV is the game. Phones are controllers.** Phones never show the answer,
right/wrong, scores, rankings or the winner — only "look at the screen".

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Supabase Postgres (all game logic in SQL functions) + Supabase Realtime (broadcast)
- Vercel-ready. Vitest + PGlite for tests.

## How it works

```
Phone / TV ──POST /api/guest|/api/host──▶ Next.js route ──rpc(service role)──▶ Postgres functions
     ▲                                          │
     └──── Realtime broadcast "sync" ping ◀─────┘  (no data in the ping → client refetches its view)
```

- **One authoritative state** in `game_sessions` (`LOBBY → QUESTION → REVEAL → LEADERBOARD → … → FINISHED`).
  Only the host token can move it. Every transition carries the question index the host is looking at, so a
  double click / retry / refresh can never act twice or skip a question.
- **Browsers never touch tables.** RLS is on with no policies and anon has no grants. The server
  (service role) builds a role-specific *view*:
  - Host/TV view: fact text + answer count while the question is open; owner, vote distribution and scores
    only after reveal.
  - Guest view: the fact text, "is this my fact?", "did I answer?". Never owners, results, scores, rankings.
  - `data/facts.json` (which contains the answers) is only imported by server code (`server-only`).
- **Scores are derived, never stored**: 1 point per answer in a revealed round that picked the fact owner.
  Nothing is incremented, so nothing can be scored twice.
- **Integrity in the DB**: one answer per player per round (unique constraint), answers rejected once the
  round is revealed (row locks + trigger), the fact owner can't answer their own fact (function + trigger).
- **Realtime** pings trigger a refetch. Clients also resync on (re)subscribe, tab focus, `online`, and a
  5s safety poll (2s if Realtime is down). All requests from one device run through a serial queue so an
  old response can't overwrite a newer one.
- **Refresh/reconnect**: host token and player token live in `localStorage`; everything else is fetched
  from the server, so any refresh lands on the exact current screen.

Fact order: a **balanced shuffle** (`lib/game/shuffle.ts`) generated once at "Start" and stored in
`game_rounds`. It never puts the same person's facts back-to-back when that's mathematically possible.

### Players vs. fact owners

- `people.json` = the six fact owners = the possible answers. They are **not** the player list.
- Joining a game: enter a display name, then answer «عندك معلومات في اللعبة؟» — pick your name if you
  are one of the six, or «لا، أنا بس ألعب». Linked players never get their own facts and are not counted
  in that fact's "X / Y answered"; everyone else answers every fact.
- Display names are unique per game (case-insensitive); each fact owner can be linked to one device.
- Lobby/join show **no portraits** — they first appear on the TV at the reveal (and for a winning fact
  owner). The only exception is the decorative "peeking friends" on the TV lobby: one friend at a time
  sneaks in from an edge, behind the lobby content so it never covers the code/QR. Disabled for
  `prefers-reduced-motion`.

### Behaviour decisions

- **Late joiners**: anyone can join until the game is finished. They start at 0, and count toward the
  "X / Y answered" total from the moment they join. Past rounds are unaffected (the eligible count of each
  round is snapshotted at reveal).
- **Fact owner** (connected or not) is never eligible for their own fact and isn't counted in "X / Y".
- **Lost phone**: the host opens **اللاعبين** on the TV and presses **فك الربط** on that player; the
  player then rejoins on a new device by typing the **same name** and keeps their score and owner link.
- In the lobby a guest can tap **مو أنت؟ غيّر الاسم** to switch names.
- TV keyboard shortcut: **Space / Enter / ←** triggers the main button.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev
```

> **No Supabase yet?** If the env vars are missing, `npm run dev` runs on an embedded local Postgres
> (PGlite, stored in `.local-db/`) with fast polling instead of Realtime. Great for trying the game on
> one machine; use Supabase for the real night and for Vercel.

### Supabase

1. Create a project at https://supabase.com (free tier is fine).
2. **SQL Editor** → run each file in `supabase/migrations/` **in order**:
   `20261004000000_init.sql`, then `20261004010000_open_players.sql`.
   (Both are safe to run again.) With the Supabase CLI instead: `supabase db push`.
3. **Project Settings → API / API Keys** and copy into `.env.local`:

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` key (or new *publishable* key) | public, used only for Realtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (or new *secret* key) | **server only — never commit** |

4. **Realtime → Settings**: keep *"Allow public access"* enabled (i.e. don't force private-only channels).
   The channels carry only content-free "sync" pings.

If an RPC call says the function isn't in the schema cache, run `notify pgrst, 'reload schema';` in the SQL Editor.

## Local testing

- **TV**: open `http://<your-LAN-IP>:3000/host` on the laptop (the dev server prints the *Network* URL).
  Use the LAN IP, not `localhost`, so the QR code works for phones.
- **Guests**: each guest needs its own browser storage. Use an incognito window, a different browser,
  or different hostnames (`localhost`, `127.0.0.1`, your LAN IP) — each hostname has separate storage.
- **iPhone on the same Wi‑Fi**: scan the QR on the TV, or open `http://<LAN-IP>:3000/join`.
  On Windows, allow Node.js through the firewall when prompted (Private networks). `next.config.ts`
  already allows common LAN ranges as dev origins.
- Realtime test: with Supabase configured, join from two phones and watch the TV counter move instantly.

```bash
npm test          # balanced shuffle, scoring/views, SQL integrity (runs the real migration in PGlite)
npm run lint
npm run typecheck
npm run build
```

## Host flow

`/` → **إنشاء لعبة** → room code + QR on the TV → players appear live → **ابدأ اللعبة** →
fact + "X / Y جاوبوا" → **إظهار الشخص** (any time) → reveal + votes → **عرض الترتيب** →
**المعلومة التالية** … → after the last one **النتائج النهائية 🏆** → winner screen.
Refreshing the TV returns to the same screen (`/host` also offers **كمّل اللعبة**).

## Guest flow

`/join` (or QR) → room code → pick your name → waiting → read fact, pick a person, **تأكيد الإجابة** →
"تم تسجيل إجابتك ✓ — تابع الشاشة 👀" → "شوف الشاشة" during reveal → "الترتيب على الشاشة" → next fact.

## Editing content

- **People**: `data/people.json` — `{ "id": "stable-id", "name": "الاسم", "image": "/people/file.png" }`.
  The `id` is the only thing used for relationships; never change an id mid-game.
- **Facts**: `data/facts.json` — `{ "id": "fact-015", "personId": "<people id>", "text": "..." }`.
  Facts with an unknown `personId` are skipped. A game snapshots its facts when it starts, so edits apply
  to the next game.
- **Profile PNGs**: put them in `public/people/`, transparent background, portrait (roughly 3:4 or taller),
  person cut off flat at the bottom edge (they're bottom-anchored on screen). The files are served
  untouched; Next.js only generates resized copies.

## Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (framework preset: Next.js).
2. Add the three env vars (Production + Preview).
3. Deploy, then open `https://<app>.vercel.app/host` on the TV laptop. The QR points to the same domain.

## Project map

```
app/page.tsx                 home
app/host/page.tsx            create / resume game
app/host/[sessionId]/        TV screen (lobby, question, reveal, leaderboard, final)
app/join/page.tsx            room code + identity picker
app/play/[sessionId]/        phone controller
app/api/host, app/api/guest  the only server endpoints
lib/game/                    pure logic: balanced shuffle, scoring, role views
lib/server/                  db rpc (Supabase or local PGlite), facts, tokens, realtime ping
lib/client/                  api wrapper, storage, useGameSync (realtime + resync)
supabase/migrations/         schema + all state-transition functions
tests/                       vitest
```
