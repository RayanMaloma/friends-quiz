import type {
  Accent,
  ChoiceOption,
  GameDoc,
  GameSettings,
  Person,
  Question,
  QuestionType,
} from "@/lib/types";

// The game document is authored in the admin dashboard and stored as JSON.
// `normalizeGameDoc` turns ANY input (an old export, a hand-edited file, a
// malicious request) into a well-formed document: unknown fields are dropped,
// strings are trimmed and capped, numbers are clamped, references are fixed.
// `validateGameDoc` then lists what still prevents the game from being played.

export const LIMITS = {
  title: 60,
  tagline: 140,
  emoji: 16,
  personName: 24,
  people: 40,
  questions: 500,
  prompt: 1200,
  option: 80,
  options: 6,
  accepted: 20,
  note: 600,
  timeLimit: 600,
  points: 10000,
} as const;

export const ACCENTS: Accent[] = ["sun", "pink", "sky", "mint", "grape", "orange"];

export const QUESTION_TYPES: QuestionType[] = ["who", "choice", "truefalse", "poll", "text", "number"];

export const TRUE_FALSE_OPTIONS: ChoiceOption[] = [
  { id: "true", label: "صح", image: null },
  { id: "false", label: "خطأ", image: null },
];

export const DEFAULT_SETTINGS: GameSettings = {
  order: "shuffle",
  questionLimit: null,
  timeLimit: 30,
  autoReveal: true,
  points: 100,
  speedBonus: true,
  showQuestionOnPhones: true,
  phoneFeedback: true,
  showVotes: true,
  leaderboardEvery: 1,
  askPersonOnJoin: true,
  lateJoin: true,
  lobbyPeek: true,
};

/** Short random id, safe in URLs and as a JSON key. Works on plain-http LAN pages. */
export function newId(prefix = ""): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return prefix + id;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export function isValidId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

// ---------------------------------------------------------------------------
// Primitive coercion
// ---------------------------------------------------------------------------

function str(v: unknown, max: number, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  // Strip control characters except newlines/tabs (prompts can be multi-line).
  const clean = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return [...clean].slice(0, max).join("");
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Image references: our media route, a site-relative path, or an https URL. */
export function imageRef(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 500) return null;
  if (/^\/(?!\/)[\w\-./%]+$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  return null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeSettings(input: unknown): GameSettings {
  const s = obj(input);
  const d = DEFAULT_SETTINGS;
  const limit = s.questionLimit;
  return {
    order: oneOf(s.order, ["shuffle", "fixed"] as const, d.order),
    questionLimit:
      limit === null || limit === undefined || limit === "" || limit === 0
        ? null
        : int(limit, 1, LIMITS.questions, 10),
    timeLimit: int(s.timeLimit, 0, LIMITS.timeLimit, d.timeLimit),
    autoReveal: bool(s.autoReveal, d.autoReveal),
    points: int(s.points, 0, LIMITS.points, d.points),
    speedBonus: bool(s.speedBonus, d.speedBonus),
    showQuestionOnPhones: bool(s.showQuestionOnPhones, d.showQuestionOnPhones),
    phoneFeedback: bool(s.phoneFeedback, d.phoneFeedback),
    showVotes: bool(s.showVotes, d.showVotes),
    leaderboardEvery: int(s.leaderboardEvery, 0, 50, d.leaderboardEvery),
    askPersonOnJoin: bool(s.askPersonOnJoin, d.askPersonOnJoin),
    lateJoin: bool(s.lateJoin, d.lateJoin),
    lobbyPeek: bool(s.lobbyPeek, d.lobbyPeek),
  };
}

function normalizeOptions(input: unknown): ChoiceOption[] {
  const seen = new Set<string>();
  const out: ChoiceOption[] = [];
  for (const raw of arr(input)) {
    const o = obj(raw);
    let id = isValidId(o.id) ? o.id : newId("o");
    if (seen.has(id)) id = newId("o");
    seen.add(id);
    out.push({ id, label: str(o.label, LIMITS.option), image: imageRef(o.image) });
    if (out.length >= LIMITS.options) break;
  }
  return out;
}

export function blankQuestion(type: QuestionType, overrides: Partial<Question> = {}): Question {
  const base: Question = {
    id: newId("q"),
    type,
    prompt: "",
    image: null,
    options: [],
    optionSource: "people",
    correct: [],
    accepted: [],
    numberAnswer: null,
    pollScoring: "none",
    aboutPersonId: null,
    timeLimit: null,
    points: null,
    note: "",
    enabled: true,
  };
  if (type === "choice") {
    base.options = [1, 2, 3, 4].map(() => ({ id: newId("o"), label: "", image: null }));
  }
  if (type === "poll") base.optionSource = "people";
  return { ...base, ...overrides };
}

function normalizeQuestion(input: unknown, personIds: Set<string>): Question {
  const q = obj(input);
  const type = oneOf(q.type, QUESTION_TYPES, "who");
  const optionSource = type === "poll" ? oneOf(q.optionSource, ["people", "custom"] as const, "people") : "custom";

  let options: ChoiceOption[] = [];
  if (type === "choice" || (type === "poll" && optionSource === "custom")) options = normalizeOptions(q.options);

  const validIds =
    type === "who" || (type === "poll" && optionSource === "people")
      ? personIds
      : type === "truefalse"
        ? new Set(["true", "false"])
        : new Set(options.map((o) => o.id));

  let correct: string[] = [];
  if (type === "who" || type === "choice" || type === "truefalse") {
    correct = [...new Set(arr(q.correct).filter((c): c is string => typeof c === "string" && validIds.has(c)))];
    if (type === "truefalse") correct = correct.slice(0, 1);
  }

  const accepted =
    type === "text"
      ? [...new Set(arr(q.accepted).map((a) => str(a, LIMITS.option)).filter(Boolean))].slice(0, LIMITS.accepted)
      : [];

  const numberRaw = q.numberAnswer;
  const numberAnswer =
    type === "number" && numberRaw !== null && numberRaw !== "" && Number.isFinite(Number(numberRaw))
      ? Number(numberRaw)
      : null;

  let aboutPersonId = typeof q.aboutPersonId === "string" && personIds.has(q.aboutPersonId) ? q.aboutPersonId : null;
  // "Who" questions are about the answer person by default.
  if (type === "who" && !aboutPersonId && q.aboutPersonId === undefined && correct.length === 1) {
    aboutPersonId = correct[0];
  }

  const t = q.timeLimit;
  const p = q.points;
  return {
    id: isValidId(q.id) ? q.id : newId("q"),
    type,
    prompt: str(q.prompt, LIMITS.prompt),
    image: imageRef(q.image),
    options,
    optionSource: type === "poll" ? optionSource : "people",
    correct,
    accepted,
    numberAnswer,
    pollScoring: type === "poll" ? oneOf(q.pollScoring, ["none", "majority"] as const, "none") : "none",
    aboutPersonId,
    timeLimit: t === null || t === undefined || t === "" ? null : int(t, 0, LIMITS.timeLimit, 0),
    points: p === null || p === undefined || p === "" ? null : int(p, 0, LIMITS.points, 0),
    note: str(q.note, LIMITS.note),
    enabled: bool(q.enabled, true),
  };
}

export function normalizeGameDoc(input: unknown): GameDoc {
  const d = obj(input);

  const people: Person[] = [];
  const personIds = new Set<string>();
  for (const raw of arr(d.people)) {
    const p = obj(raw);
    let id = isValidId(p.id) ? p.id : newId("p");
    if (personIds.has(id)) id = newId("p");
    const name = str(p.name, LIMITS.personName);
    if (!name) continue;
    personIds.add(id);
    people.push({ id, name, image: imageRef(p.image) });
    if (people.length >= LIMITS.people) break;
  }

  const questionIds = new Set<string>();
  const questions: Question[] = [];
  for (const raw of arr(d.questions).slice(0, LIMITS.questions)) {
    const q = normalizeQuestion(raw, personIds);
    if (questionIds.has(q.id)) q.id = newId("q");
    questionIds.add(q.id);
    questions.push(q);
  }

  return {
    title: str(d.title, LIMITS.title) || "لعبة بدون اسم",
    tagline: str(d.tagline, LIMITS.tagline),
    emoji: str(d.emoji, LIMITS.emoji) || "🎉",
    cover: imageRef(d.cover),
    accent: oneOf(d.accent, ACCENTS, "sun"),
    people,
    questions,
    settings: normalizeSettings(d.settings),
  };
}

// ---------------------------------------------------------------------------
// Validation (what prevents a game from being played)
// ---------------------------------------------------------------------------

export interface Issue {
  /** Question id, or null for game-level issues. */
  questionId: string | null;
  message: string;
}

export function questionIssues(q: Question, people: Person[]): string[] {
  const issues: string[] = [];
  const hasContent = q.prompt.trim() !== "" || q.image !== null;
  if (!hasContent) issues.push("السؤال بدون نص أو صورة");
  switch (q.type) {
    case "who":
      if (people.length < 2) issues.push("يحتاج شخصين على الأقل في قائمة الأشخاص");
      if (q.correct.length === 0) issues.push("اختر الشخص الصحيح");
      break;
    case "choice":
      if (q.options.filter((o) => o.label || o.image).length < 2) issues.push("يحتاج خيارين على الأقل");
      if (q.options.some((o) => !o.label && !o.image)) issues.push("فيه خيار فاضي");
      if (q.correct.length === 0) issues.push("حدد الإجابة الصحيحة");
      break;
    case "truefalse":
      if (q.correct.length === 0) issues.push("حدد صح أو خطأ");
      break;
    case "poll":
      if (q.optionSource === "people" && people.length < 2) issues.push("يحتاج شخصين على الأقل في قائمة الأشخاص");
      if (q.optionSource === "custom") {
        if (q.options.filter((o) => o.label || o.image).length < 2) issues.push("يحتاج خيارين على الأقل");
        if (q.options.some((o) => !o.label && !o.image)) issues.push("فيه خيار فاضي");
      }
      break;
    case "text":
      if (q.accepted.length === 0) issues.push("أضف إجابة مقبولة وحدة على الأقل");
      break;
    case "number":
      if (q.numberAnswer === null) issues.push("اكتب الرقم الصحيح");
      break;
  }
  return issues;
}

export function validateGameDoc(doc: GameDoc): Issue[] {
  const issues: Issue[] = [];
  const enabled = doc.questions.filter((q) => q.enabled);
  if (enabled.length === 0) issues.push({ questionId: null, message: "ما فيه أسئلة مفعّلة" });
  for (const q of enabled) {
    for (const message of questionIssues(q, doc.people)) issues.push({ questionId: q.id, message });
  }
  return issues;
}

/** Questions that will actually be played. */
export function playableQuestions(doc: GameDoc): Question[] {
  return doc.questions.filter((q) => q.enabled && questionIssues(q, doc.people).length === 0);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateId = "facts" | "photos" | "trivia" | "likely" | "blank";

export interface Template {
  id: TemplateId;
  emoji: string;
  title: string;
  description: string;
  /** The question type the editor offers first. */
  defaultType: QuestionType;
  /** Default prompt for new questions of this template ("" = none). */
  defaultPrompt: string;
  build: () => GameDoc;
}

function baseDoc(over: Partial<GameDoc>, settings: Partial<GameSettings> = {}): GameDoc {
  return normalizeGameDoc({ ...over, settings: { ...DEFAULT_SETTINGS, ...settings } });
}

export const TEMPLATES: Template[] = [
  {
    id: "photos",
    emoji: "📸",
    title: "مين صوّر الصورة؟",
    description: "كل واحد يرسل صور من جواله، والباقين يخمنون مين صوّرها.",
    defaultType: "who",
    defaultPrompt: "مين صوّر هذي الصورة؟",
    build: () =>
      baseDoc(
        { title: "مين صوّر الصورة؟", emoji: "📸", accent: "sky", tagline: "صور من جوالاتكم… مين صوّرها؟" },
        { timeLimit: 25, points: 100, speedBonus: true },
      ),
  },
  {
    id: "facts",
    emoji: "🤫",
    title: "عن مين؟",
    description: "معلومات وأسرار عن الشلة، خمّن كل معلومة عن مين.",
    defaultType: "who",
    defaultPrompt: "",
    build: () =>
      baseDoc(
        { title: "عن مين؟", emoji: "🤫", accent: "sun", tagline: "معلومات عن الشلة… خمّن كل وحدة عن مين" },
        { timeLimit: 0, points: 1, speedBonus: false, phoneFeedback: false, autoReveal: false },
      ),
  },
  {
    id: "trivia",
    emoji: "🧠",
    title: "مسابقة معلومات",
    description: "أسئلة اختيار من متعدد، صح وخطأ، أرقام وكتابة. الأسرع يكسب أكثر.",
    defaultType: "choice",
    defaultPrompt: "",
    build: () =>
      baseDoc(
        { title: "مسابقة معلومات", emoji: "🧠", accent: "grape" },
        { timeLimit: 20, points: 100, speedBonus: true, askPersonOnJoin: false, lobbyPeek: false },
      ),
  },
  {
    id: "likely",
    emoji: "🗳️",
    title: "مين أكثر واحد…؟",
    description: "تصويت على الشلة. اللي يصوّت مع الأغلبية ياخذ نقاط.",
    defaultType: "poll",
    defaultPrompt: "مين أكثر واحد ممكن ",
    build: () =>
      baseDoc(
        { title: "مين أكثر واحد…؟", emoji: "🗳️", accent: "pink" },
        { timeLimit: 20, points: 100, speedBonus: false, askPersonOnJoin: true },
      ),
  },
  {
    id: "blank",
    emoji: "✨",
    title: "لعبة فاضية",
    description: "ابدأ من الصفر واختار كل شي بنفسك.",
    defaultType: "choice",
    defaultPrompt: "",
    build: () => baseDoc({ title: "لعبة جديدة", emoji: "✨" }),
  },
];

/** Template-specific defaults for a new question (prompt + poll scoring). */
export function questionFromTemplate(template: TemplateId | null, type: QuestionType): Question {
  const t = TEMPLATES.find((x) => x.id === template);
  const q = blankQuestion(type);
  if (t && t.defaultType === type) q.prompt = t.defaultPrompt;
  if (type === "poll" && template === "likely") q.pollScoring = "majority";
  return q;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const QUESTION_TYPE_INFO: Record<QuestionType, { label: string; emoji: string; hint: string }> = {
  who: { label: "مين؟", emoji: "🧑‍🤝‍🧑", hint: "الإجابة واحد من الأشخاص (معلومة، صورة، صوت…)" },
  choice: { label: "اختيار من متعدد", emoji: "🔢", hint: "٢–٦ خيارات، واحد أو أكثر صحيح" },
  truefalse: { label: "صح أو خطأ", emoji: "⚖️", hint: "جملة والجواب صح أو خطأ" },
  poll: { label: "تصويت", emoji: "🗳️", hint: "ما فيه إجابة صحيحة — الأغلبية تكسب (اختياري)" },
  text: { label: "إجابة مكتوبة", emoji: "⌨️", hint: "اللاعب يكتب الإجابة" },
  number: { label: "تخمين رقم", emoji: "🎯", hint: "الأقرب للرقم الصحيح يكسب" },
};
