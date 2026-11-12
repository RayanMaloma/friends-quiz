# استراحة المقيمين — party game platform

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

## Accounts, public games and the activity dashboard

- **Hosts need an account; players don't.** «اختر لعبة» → `/games`: signed out, two cards (عندك حساب؟ / سجّل الآن);
  `/login` and `/register` are email + password only. Players still join by QR / room code with a nickname.
- **Identity = Supabase Auth.** The server signs in with Supabase and keeps the access + refresh tokens in httpOnly
  cookies (`fq_at` 1h, `fq_rt` 30 days, renewed on use), so hosts stay signed in until the session expires, is
  revoked or they sign out. No email is ever sent (no confirmation, OTP or reset). Login/signup are throttled per IP
  and per email on top of Supabase's own limits. Local dev without Supabase uses a stand-in with the same contract
  (`lib/server/auth/local.ts`, scrypt hashes in a local `auth.users`, `supabase/local/auth_stub.sql`).
- **Roles** (`fq_profiles`): every account is `user`. The single `super_admin` is granted only by
  `npm run provision:super-admin` (service role). The super-admin email is reserved in the database: a public
  signup with it is refused. The old `ADMIN_PASSWORD` (GM) still opens the dashboard and acts like the super admin.
- **Game definition vs session.** Definitions (built-in rules, or games authored in `/admin`) are edited only by the
  super admin. Each is **public** or **private** (`fq_catalog`, `games.visibility`); regular users see and open only
  public, published ones — enforced in `/api/catalog` and again by every `create` endpoint (`lib/server/access.ts`), so a
  private game reads as missing even by direct id. **⋯ → نشر** on any game card in `/admin` makes it published and
  public in one step (refused while the game has problems). Defaults: المافيا, اخترع إجابتك and the public «المهرب السري» are public;
  the Ahaji question set and «المقيم السري» are private. A session belongs to its creator (`owner_id`) and holds its own
  settings; host actions still need the room's host token, and `/games` lets an owner take their open room back.
- **«المهرب السري»** = a public copy of the private «المقيم السري» made with **⋯ → نسخة عامة** in `/admin`
  (`lib/dx/publicCopy.ts`): same factions, roles, knowledge, distribution, deck, board and rules; every uploaded photo
  and every friend name removed. The private game is never modified.
- **Activity** (`/admin/activity`): users, sessions, active, completed; accounts (email, registration, last sign-in,
  sessions); sessions with filters (game, state, dates, creator) and details (settings, questions, players, event log,
  result, end / delete). Events (`fq_activity`) are written by the database: registration (trigger on `auth.users`),
  session created / started / completed / cancelled (triggers on `game_sessions`, one row each via `dedupe_key`), and
  logins (server). `fq_purge_activity(days)` drops old rows (min 30, default 365).
- **RLS** (defense in depth — the app itself uses the service role): a user JWT reads only its own profile and the
  non-secret columns of its own sessions, public published games and public catalog entries; never host tokens,
  configs, match state, other accounts or emails. All `fq_*` functions are service-role only.

## «اخترع إجابتك» (built-in)

Public rooms play the **host's own questions**: `/invent/new` → one question per line (1–100, ≤200 characters) + match
length (never more than the questions) and timers → the room opens with its QR. The questions are stored with the room
(`game_sessions.config.questions`). The private **Ahaji** version keeps the 46 approved questions
(`lib/invent/questions.ts`, server-only — they never reach the browser bundle). Every round:
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

## «المحكمة» (built-in)

A courtroom party game for 5–12 players. Each case: one **accused** (knows the truth), one **lawyer**, one **prosecutor**,
everyone else a **juror**; the server is the judge. Five fixed, reviewed cases (`lib/court/cases.ts`, server-only), picked at
random without repeats (a rematch prefers new ones); the host sets how many (1–5).

Phases: announce (30s) → openings (prosecutor 60s, lawyer 60s) → evidence (105s: the prosecutor presents up to 3 exhibits
from the phone; the lawyer has **one objection**, which stops the evidence clock for the prosecutor's 15s, then shows the
case's predefined ruling: upheld with a note, or overruled) → cross-examination (prosecutor 60s, lawyer 30s) → closings
(30s + 30s) → secret jury vote (20s, ends early when every juror voted; a tie or no votes = not guilty) → verdict (truth,
explanation, exhibit classes: صحيح / مضلّل / غير حاسم, points) → standings → next case → final winner(s).

Points: accused **+200** when the verdict misses the truth, lawyer **+150** on «not guilty», prosecutor **+150** on «guilty»,
each juror **+100** for voting the truth. Key roles rotate (fewest key roles first, then fewest of that role, never the same
accused twice in a row).

- Same architecture as the other built-ins: engine `lib/court/engine.ts` on the server, `/api/court` checks every move against
  the sender's role, phase and case, saves with the `match_version` lock (simultaneous votes retry), and each device gets only
  its own view (`lib/court/views.ts`): the TV never sees a secret, an unpresented exhibit, a class or a ballot before the verdict.
- **Presence**: every phone request stamps `fq_player_presence`. A key role unseen for 20s (or whose seat was freed) pauses the
  hearing; their return resumes it. After a 15s grace the TV offers: go on without them, hand the role to a juror (the replaced
  player sits the case out), or void the case. The host can also pause/resume, skip a phase, free a seat (the player rejoins by
  typing the same name, keeping role and points) or end the session from ⚙.
- Phones: secrets are **hold to reveal** (hidden again on release or when the app goes to the background).
- Migration: `supabase/migrations/20261111000000_court.sql` (schema version 9).

## «انقطاع الاتصال» (built-in, 3–8 players)

A cooperative crisis on **المحطة 07**: the TV is the shared command center, each phone is one engineer's console, and
nobody holds all the tools or all the information — codes, sensor readings and diagnoses have to be said out loud.

- **Simulation** (`lib/outage/sim.ts`): a deterministic station that moves in one-second server ticks (never in
  wall-clock deltas, so poll rate and browser speed can't change the outcome). Generators → supply → allocations ×
  breakers → each system; pump power × its electricity × coolant × valve split → reactor cooling; backup generator heat
  ← its cooling loop; power + filter + scrubber → O₂, breaches (doors/vents) → O₂ loss; security power + controller +
  lockdown → doors; comms power + relay + tuning → messages; repairs need their device isolated for their whole duration.
- **Faults** (`lib/outage/missions.ts`): reactor overheat (always first, the 15-step chain), O₂ drop, main generator
  failure, hull breach, comms failure, security lockdown, dual fault. Each is `setup` + `stable` (+ optional failure);
  a fault completes only after its stable state holds for a few seconds. Add a fault by adding an entry.
- **Panels & roles** (`lib/outage/roles.ts`): 8 panels → 6 specialties; 3–5 players merge them, 7–8 split electrical and
  security into sub-panels. The server accepts a command only from the panel's current holder. A player silent for
  45 s (or released by the host) has their panels redistributed (keeping every fault two-player); they get them back on return.
- **Levels**: easy 3 faults / 12 min, medium 5 / 10 min (one overlap, one decoy message, enciphered codes, 2 short
  blackouts), hard 7 / 8 min (overlaps, decoys, drifting sensor, split code, frequent blackouts). Blackouts are a social
  rule only (that player must stay silent); their device keeps working.
- **Score**: 1000 per fault, 10 per second left, −150 per operational error (wrong code, wrong repair, burnt generator,
  opening a breached section…), +500 with no system collapse, never below 0. Grades are shares of each level's maximum:
  S ≥ 68 %, A ≥ 58 %, B ≥ 48 %, else C; failure is F.
- `/api/outage` (same optimistic-lock model as the other games), views in `lib/outage/views.ts` (the TV never sees a
  code, key, signal, diagnosis or the backup generator's heat). Migration `20261112000000_outage.sql` (schema version 10, builds on the court migration).
- Tests: `tests/outage.test.ts` (couplings, the reactor chain, codes, overlaps, decisions, blackouts, time, scoring,
  determinism, a scripted crew winning easy/medium with 3/6/8 players) and `tests/outage-route.test.ts` (end to end on the
  real migrations).

## Pages

| URL | Who | What |
| --- | --- | --- |
| `/` | everyone | Home: «اختر لعبة» |
| `/games` | hosts (account) | Sign-in choice, or the games you may open + your open rooms |
| `/login`, `/register` | hosts | Email + password |
| `/invent/new` | hosts | «اخترع إجابتك»: your questions + settings → room |
| `/join` (QR) | players | Room code → name → (optional) "I'm one of the people" |
| `/play/[id]` | players | The phone controller |
| `/host/[id]` | TV | Lobby + QR, questions, timer, reveal, leaderboard, winner |
| `/admin` | super admin | Games: built-ins + authored, public/private, create, edit, duplicate, public copy, import/export, archive, delete |
| `/admin/activity` | super admin | Activity: metrics, accounts, sessions (filters, details) |
| `/admin/games/[id]` | admin | The editor (autosaves) |
| `/admin/dx/[id]` | admin | Hidden-role game editor (autosaves) |
| `/dx/host/[id]` | TV | Hidden-role game: lobby, board, public steps |
| `/dx/play/[id]` | players | Hidden-role game: the private phone screen |
| `/invent/host/[id]` | host screen | «اخترع إجابتك»: lobby, rounds, host panel, results |
| `/invent/join`, `/invent/play/[id]` | players | «اخترع إجابتك»: join, answer, vote, standings |
| `/court/host/[id]` | TV | «المحكمة»: lobby, hearing, verdict, standings, host controls |
| `/court/join`, `/court/play/[id]` | players | «المحكمة»: join, role and secret, exhibits / objection / ballot, points |
| `/outage/host/[id]` | TV | «انقطاع الاتصال»: lobby + QR + difficulty, command center, results |
| `/outage/join`, `/outage/play/[id]` | players | «انقطاع الاتصال»: join, your control panels |

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
- **Auth**: accounts (above). The dashboard needs the super admin (or the GM password: `ADMIN_PASSWORD` → signed
  httpOnly cookie, 30 days). Same-origin check on auth/admin endpoints. Opening a room needs an account.
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
   `20261004000000_init.sql`, `20261004010000_open_players.sql`, **`20261009000000_platform.sql`**, **`20261018000000_deduction.sql`** (hidden-role games), `20261028000000_mafia.sql`, **`20261029000000_invent.sql`** (اخترع إجابتك), **`20261030000000_accounts.sql`** (accounts, catalog, activity), `20261102000000_draw.sql`, **`20261111000000_court.sql`** (المحكمة).
   Already ran the first two? Just run the third. It replaces the old session tables (old rooms are
   dropped). With the Supabase CLI: `supabase db push`.
   The dashboard shows a warning until this migration is applied.
2. **Project Settings → API**: copy the URL, anon key and service-role key into `.env.local`.
3. Storage needs nothing: the private `media` bucket is created on the first upload.
4. **Realtime → Settings**: keep public access allowed (channels only carry content-free pings).
5. First visit to `/admin`: press **استيراد «عن مين؟» الأصلية** to bring the original game (people,
   portraits and all facts from `data/`) into the platform.

6. **Authentication → Sign In / Providers → Email**: keep Email enabled and turn **Confirm email OFF** (accounts are
   used right after signup; nothing is ever emailed). While it is on, signup answers «التسجيل غير متاح حاليًا».
   Optionally review **Authentication → Rate Limits** (signups/logins go through the server).
7. Create the super admin: `npm run provision:super-admin` (reads `.env.local`; asks for the password without
   echo, or `SUPER_ADMIN_PASSWORD=… npm run provision:super-admin`). An existing account is promoted without touching
   its password. Locally: `npm run provision:super-admin -- --local` (with `npm run dev` stopped).
8. **Account recovery** (no email service): the administrator sets a new password in **Supabase → Authentication →
   Users**, or for the super admin `npm run provision:super-admin -- --reset-password`.

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
3. Open `https://<app>.vercel.app/games` on the TV laptop, sign in once, pick a game. The QR points to the
   same domain.

## Local testing

- **TV**: `http://<LAN-IP>:3000/games` (not `localhost`, so the QR works for phones).
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
app/games, app/login, app/register  game selection, accounts
app/host/[id]               quiz TV screen
app/join, app/play/[id]     phone join + controller
app/api/admin               admin actions (games, visibility, activity, sessions, GM login)
app/api/auth, app/api/catalog  accounts; games a host may open, own rooms
lib/server/auth/            Supabase Auth (+ local stand-in), session cookies
lib/server/access.ts        who may open which game (server-side gate)
scripts/provision-super-admin.mjs  creates / promotes the super admin
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
