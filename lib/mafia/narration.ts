/**
 * The narrator's script, in Saudi Arabic.
 *
 * Every line has a key. A recorded file for a key (see public/mafia/voice)
 * is played as-is, so recorded lines never contain names; `text` is what a
 * Saudi text-to-speech voice reads and what the TV shows as a subtitle, and
 * may include the player's name.
 */
import { ROLE_INFO, type Role } from "./rules";

export type CueKey =
  | "intro"
  | "roles"
  | "night_first"
  | "night"
  | "mafia"
  | "detective"
  | "doctor"
  | "dawn"
  | "dawn_killed"
  | "dawn_saved"
  | "dawn_quiet"
  | "discussion"
  | "voting"
  | "verdict"
  | "verdict_eliminated"
  | "verdict_skip"
  | "verdict_tie"
  | "win_mafia"
  | "win_citizens"
  | "paused"
  | "resumed";

/** The recorded (name-free) wording of every line. Also the subtitle when there is no name. */
export const SCRIPT: Record<CueKey, string> = {
  // Spoken 3–7s into the opening sequence: kept short enough to end before the countdown.
  intro: "الليلة... بينكم قتلة. ومحد يدري مين يثق بمين.",
  roles: "كل واحد يشوف دوره في جواله... اضغط مطوّل على البطاقة، وخلك ساكت.",
  night_first: "حلّ الليل... وكل واحد يخفي أسراره.",
  night: "رجع الليل... المدينة نايمة، بس فيه ناس صاحين.",
  mafia: "القتلة... جاء دوركم.",
  detective: "الشايب... حان وقت التحقيق.",
  doctor: "الطبيب... اختر الشخص اللي تبي تحميه.",
  dawn: "طلع الفجر... وخلونا نشوف وش صار الليلة.",
  dawn_killed: "للأسف... فيه واحد منكم ما شاف الصبح.",
  dawn_saved: "القتلة حاولوا الليلة... بس الطبيب كان أسرع منهم.",
  dawn_quiet: "ليلة هادية... محد مات الليلة.",
  discussion: "قدامكم دقيقة ونص... ناقشوا وشكّوا في بعض.",
  voting: "انتهى وقت الكلام... الحين وقت التصويت.",
  verdict: "خلونا نشوف وش قررت المدينة...",
  verdict_eliminated: "المدينة قالت كلمتها... وفيه واحد طلع من اللعبة. وش كان دوره؟ يبقى سرّ.",
  verdict_skip: "قررتوا تتخطون التصويت... محد طلع اليوم.",
  verdict_tie: "الأصوات تعادلت... محد يطلع اليوم.",
  win_mafia: "انتهت اللعبة... المافيا سيطرت على المدينة.",
  win_citizens: "انتهت اللعبة... المدينة نظفت من القتلة. المواطنين فازوا.",
  paused: "وقفة قصيرة...",
  resumed: "نكمّل...",
};

export interface Cue {
  key: CueKey;
  /** What is read aloud by text-to-speech and shown as the subtitle. */
  text: string;
}

const roleLabel = (role: Role | null) => (role ? ROLE_INFO[role].article : "");

/** A line, personalised with a name (and role) where the moment calls for it. */
export function cue(key: CueKey, name?: string | null, role?: Role | null): Cue {
  if (name) {
    switch (key) {
      case "dawn_killed":
        return { key, text: `للأسف... ${name} ما شاف الصبح. كان ${roleLabel(role ?? null)}.` };
      case "dawn_saved":
        return { key, text: `القتلة حاولوا يقتلون ${name}... بس الطبيب كان أسرع منهم.` };
      case "verdict_eliminated":
        // A vote-out never reveals the role.
        return { key, text: `المدينة قالت كلمتها... ${name} طلع من اللعبة. وش كان دوره؟ يبقى سرّ.` };
    }
  }
  return { key, text: SCRIPT[key] };
}
