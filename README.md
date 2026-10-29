# ألعاب الشلّة — party game platform

A Kahoot-style party game **platform**. The TV shows the question, everyone answers on their phone,
the TV reveals the answer and keeps score. Every game — its people, questions, photos, rules and
look — is built in the **admin dashboard**. No code changes to make a new game.

**The TV is the game. Phones are controllers.**

## What you can build (no code)

| Question type | What players do | How it scores |
| --- | --- | --- |
| **مين؟** (who) | Pick one of the game's people — for facts, photos, quotes… | Right person |
| **اختيار من متعدد** | Pick one of 2–6 options (text and/or image) | Any option marked correct |
| **صح أو خطأ** | True / false | Right side |
| **تصويت** | Vote for a person or an option | Optional: everyone who voted with the majority |
| **إجابة مكتوبة** | Type the answer | Loose match (spacing, case, hamza/alef/taa-marbuta, «ال», Arabic digits) against a list of accepted answers |
| **تخمين رقم** | Type a number | The closest guess(es) |

Every question can have text, an image, a timer, its own points, a note shown at the reveal, and an
"about" person who sits that question out ("this one is about you 🤫").

Game-level rules (tab **القوانين**): timer per question, auto-reveal, points, speed bonus (100% → 50%),
shuffled (never the same person twice in a row when possible) or fixed order, play N random questions
per session, leaderboard every N questions or only at the end, show the question on phones or only on
the TV, phone feedback (✓/✗, points, rank) or keep phones silent, late join, ask players "are you one
of the people?", show everyone's votes, peeking portraits in the lobby. Look (tab **الاسم والشكل**):
title, tagline, emoji, accent color, cover image.

Templates give a starting point: **مين صوّر الصورة؟**, **عن مين؟** (facts), **مسابقة معلومات**,
**مين أكثر واحد…؟**, or blank.

### "Who took this photo?" in 2 minutes

1. **/admin → + لعبة جديدة → مين صوّر الصورة؟**
2. Tab **الأشخاص**: add everyone (a portrait is optional — it appears big on the TV at the reveal).
3. On each person's card press **📸 صور من …** and select their photos (any number, straight from the
   phone — they're resized in the browser before upload). One question is created per photo, with that
   person as the answer, and that person automatically sits out their own photos.
4. **نشر**, then **📺 تشغيل** on the TV laptop.

Facts work the same way: **📝 معلومات** on a person's card, one fact per line.

## Hidden-role games (أدوار سرّية)

A second kind of game: a Secret-Hitler-style deduction game (two templates: **هتلر السرّي**, **مجلس الظلال**),
fully customizable in `/admin/dx/[id]` (identity, themes, board, cards, factions & roles, rules, images).

**The TV shows the board. Each phone holds one player's secrets.**

| On the TV (public) | On the player's phone (private) |
| --- | --- |
| Lobby + QR, seat order, board, tracks, election tracker, log, results | Role card — **hold to flip**, let go and it hides (also hides when the app goes to background); teammates you know |
| Host taps the nomination and power targets the table agreed on out loud | Ballot: yes / no (changeable until the reveal) |
| Vote progress (who still has to vote), reveal (percentage or names) | President's 3 cards (discard 1), Chancellor's 2 cards (enact 1, or ask for a veto), veto answer |
| "X is choosing on their phone" with face-down cards | Investigation result and deck peek — leader's phone only |
| Host controls (skip, set leader, adjust tracks, declare winner) | "Look at the TV" status, "you're out", win/lose at the end |

How it's built: the engine (`lib/dx/engine`) runs **on the server**. Every action goes through `/api/dx`:
identify the device → check this device may send this action now (`lib/dx/actions.ts`) → run the engine →
save with an optimistic lock (`match_version`, simultaneous votes retry, none is lost). Each device gets only
`redactFor(itself)`: nobody else's role, hand, ballot or power result is ever sent to it. Rooms use the same
codes and `/join` flow as quizzes; new players can't join once the roles are dealt (a released player rejoins
by name). Migration: `supabase/migrations/20261018000000_deduction.sql`.

The default content recreates the mechanics of *Secret Hitler* (CC BY-NC-SA 4.0) as editable data.

## «اخترع إجابتك» (built-in)

A bluffing / comedy game with 46 fixed questions (`lib/invent/questions.ts`, wording exactly as approved). Every round:
question → everyone writes an answer on their phone → all answers appear anonymously in one shuffled
two-column grid → everyone votes for someone else's → the same cards reveal their authors (diagonal gold tags),
vote counts and points (**100 per vote received**, nothing else) → leaderboard → next question.

- Host opens it from `/host` (card «اخترع إجابتك»). Lobby: QR + code, live player list (remove with ✕), match length
  (1–46, default 36, random without repeats), answer timer (default 60s) and voting timer (default 30s): any whole number of seconds.
- The host panel shows round, phase, countdown, answers/votes progress and connected players, and can pause/resume, skip the
  phase, free a stuck seat, end the match (with confirmation) and **change either timer live**:
  `remaining = max(0, duration − active time already played)` (pauses excluded), for the running phase and every later one.
- Same architecture as Mafia: the engine (`lib/invent/engine.ts`) runs on the server, `/api/invent` checks every move and
  saves with the `match_version` lock (simultaneous answers/votes retry; a round is scored once), and each device gets its own
  view (`lib/invent/views.ts`): no answer text before voting, no authors or vote counts before the reveal, never who voted for whom.
- Migration: `supabase/migrations/20261029000000_invent.sql` (schema version 6).

## Pages

| URL | Who | What |
| --- | --- | --- |
| `/` | everyone | Join, or run a game on the TV |
| `/join` (QR) | players | Room code → name → (optional) "I'm one of the people" |
| `/play/[id]` | players | The phone controller |
| `/host` | admin | Pick a published game (or test a draft) and open a room |
| `/host/[id]` | TV | Lobby + QR, questions, timer, reveal, leaderboard, winner |
| `/admin` | admin | Games: create from template, edit, duplicate, import/export JSON, archive, delete |
| `/admin/games/[id]` | admin | The editor (autosaves) |
| `/admin/sessions` | admin | Rooms played: status, results, end a stuck room, delete |
| `/admin/dx/[id]` | admin | Hidden-role game editor (autosaves) |
| `/dx/host/[id]` | TV | Hidden-role game: lobby, board, public steps |
| `/dx/play/[id]` | players | Hidden-role game: the private phone screen |
| `/invent/host/[id]` | host screen | «اخترع إجابتك»: lobby, rounds, host panel, results |
| `/invent/join`, `/invent/play/[id]` | players | «اخترع إجابتك»: join, answer, vote, standings |

## How it works

```
Phone / TV / Admin ──POST /api/guest|host|admin──▶ Next.js route ──rpc(service role)──▶ Postgres functions
        ▲                                                  │
        └────── Realtime broadcast "sync" ping ◀───────────┘  (no data in the ping → client refetches its view)
```

- **Games** are one JSON document each (`games.doc`). The server normalizes every save
  (`lib/game/doc.ts`): unknown fields dropped, strings capped, numbers clamped, references to deleted
  people/options removed. `validateGameDoc` lists what still blocks playing; a game with issues can't be
  published (and drops back to draft if edited into a broken state). Saves use optimistic locking
  (`version`), so two tabs can't silently overwrite each other.
- **Sessions snapshot the game** when a room opens (`config` + every round with its secret answer key),
  so editing a game never affects a running room.
- **One authoritative state** in `game_sessions` (`LOBBY → QUESTION → REVEAL → (LEADERBOARD) → … → FINISHED`).
  Every transition carries the question index the host is looking at, so double clicks, retries and an
  auto-reveal racing a manual click can never act twice or skip a question.
- **Browsers never touch tables.** RLS is on with no policies; anon has no grants. The server builds
  role-specific views (`lib/game/views.ts`): the TV gets answers only after reveal; phones never get
  answers, and get results only after reveal when the game enables phone feedback.
- **The database enforces the rules**: one answer per player per round, answers rejected after reveal or
  after the timer (+2s grace), the "about" person can't answer, answers validated against the round type
  and its options (functions + trigger).
- **Scores are derived, never stored** (correctness × points × speed factor), so nothing can be scored twice.
- **Images** are uploaded by the admin, resized in the browser, type-checked by magic bytes on the
  server (no SVG), stored under random UUID names in a **private** Supabase Storage bucket (`media`,
  created automatically) and served through `/api/media/<key>` with immutable caching.
- **Admin auth**: `ADMIN_PASSWORD` → signed httpOnly cookie (30 days; changing the password signs
  everyone out), login throttling, same-origin check on admin endpoints. Opening a room requires admin.
- **Realtime / reconnects / refresh**: unchanged — pings trigger refetches; clients also resync on
  reconnect, focus, `online`, and a 5s safety poll. Host and player tokens live in `localStorage`.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

> **No Supabase yet?** Without the Supabase env vars (or with `NEXT_PUBLIC_FQ_LOCAL_DB=1`), `npm run dev`
> runs on an embedded Postgres (PGlite, `.local-db/`) and stores uploads in `.local-db/media`. Admin
> password defaults to `admin` locally.

### Supabase

1. **SQL Editor** → run each file in `supabase/migrations/` **in order** (all are safe to re-run):
   `20261004000000_init.sql`, `20261004010000_open_players.sql`, **`20261009000000_platform.sql`**, **`20261018000000_deduction.sql`** (hidden-role games), `20261028000000_mafia.sql`, **`20261029000000_invent.sql`** (اخترع إجابتك).
   Already ran the first two? Just run the third. It replaces the old session tables (old rooms are
   dropped). With the Supabase CLI: `supabase db push`.
   The dashboard shows a warning until this migration is applied.
2. **Project Settings → API**: copy the URL, anon key and service-role key into `.env.local`.
3. Storage needs nothing: the private `media` bucket is created on the first upload.
4. **Realtime → Settings**: keep public access allowed (channels only carry content-free pings).
5. First visit to `/admin`: press **استيراد «عن مين؟» الأصلية** to bring the original game (people,
   portraits and all facts from `data/`) into the platform.

If an RPC call says the function isn't in the schema cache, run `notify pgrst, 'reload schema';`.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public, Realtime only |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** |
| `ADMIN_PASSWORD` | **server only**, required in production (the dashboard stays locked without it) |

## Deploy to Vercel

1. Import the repo (framework preset: Next.js).
2. Add the four env vars (Production + Preview). Run the migration (above).
3. Open `https://<app>.vercel.app/host` on the TV laptop, log in once, pick a game. The QR points to the
   same domain.

## Local testing

- **TV**: `http://<LAN-IP>:3000/host` (not `localhost`, so the QR works for phones).
- **Players**: each needs its own browser storage — incognito, another browser, or another hostname
  (`localhost`, `127.0.0.1`, LAN IP).
- TV shortcut: **Space / Enter / ←** = main button.

```bash
npm test          # doc normalization, scoring for every type, views, SQL integrity (real migrations in PGlite)
npm run lint
npm run typecheck
npm run build
```

## Project map

```
app/admin/                  dashboard: games, editor, sessions (layout = auth gate + DB health warnings)
app/host/, app/host/[id]    game picker, TV screen
app/join, app/play/[id]     phone join + controller
app/api/admin               admin actions (games, sessions, login)
app/api/admin/media         image upload          app/api/media/[key]   image serving
app/api/host, app/api/guest game endpoints
components/admin/           editor UI (questions, people, rules, bulk photo/fact import, image field)
components/host/            TV screens
lib/game/doc.ts             game document: types → normalize, validate, templates
lib/game/rounds.ts          game → session rounds (order, limit, options, secret answer keys)
lib/game/views.ts           scoring + role views          lib/game/text.ts  typed-answer matching
lib/server/                 db (Supabase or PGlite), admin auth, media storage, games, legacy import
supabase/migrations/        schema + every state transition
tests/                      vitest
data/                       the original game's content (used only by the one-time import)
```
