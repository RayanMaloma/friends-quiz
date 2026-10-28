/**
 * The narrator's script, in Saudi Arabic (Najdi).
 *
 * Every line has a key. A recorded file for a key (see public/mafia/voice)
 * is played as-is, so recorded lines never contain names; `text` is what a
 * Saudi text-to-speech voice reads and what the TV shows as a subtitle, and
 * may include the player's name.
 */
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

/**
 * The recorded (name-free) wording of every line, in Najdi. Also the subtitle
 * when there is no name. No line ever says what a player who is out was.
 */
export const SCRIPT: Record<CueKey, string> = {
  // Spoken 3–7s into the opening sequence: kept short enough to end before the countdown.
  intro: "الليلة... بينكم قتلة. ومحد يدري مين يثق بمين.",
  roles: "كل واحد يشوف دوره في جواله... اضغط مطوّل على البطاقة، وخلك ساكت.",
  night_first: "حلّ الليل... والكل يغمّض عيونه.",
  night: "حلّ الليل... والكل يغمّض عيونه.",
  mafia: "الحين دور القتلة... الباقين يغمّضون عيونهم.",
  detective: "الحين دور الشايب... الباقين يغمّضون عيونهم.",
  doctor: "الحين دور الطبيب... الباقين يغمّضون عيونهم.",
  dawn: "طلع الصبح... افتحوا عيونكم.",
  dawn_killed: "القتلة اختاروا ضحيتهم... وللأسف، انتهت لعبته.",
  dawn_saved: "القتلة حاولوا يتخلصون من واحد منكم... لكن المحاولة فشلت.",
  dawn_quiet: "عدّت الليلة على خير... وما فقدنا أحد.",
  discussion: "الحين عندكم دقيقة ونص تتناقشون... حاولوا تعرفون مين القاتل.",
  voting: "انتهى وقت النقاش... الحين وقت التصويت.",
  verdict: "خلونا نشوف وش قررتوا...",
  verdict_eliminated: "تم استبعاد لاعب من اللعبة.",
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
  /** The player named in the line, if any. */
  name?: string;
}

/** The lines that can carry a player's name. */
export const NAMED_CUES: CueKey[] = ["dawn_killed", "dawn_saved", "verdict_eliminated"];

/** A line, personalised with a player's name where the moment calls for it. Never with a role. */
export function cue(key: CueKey, name?: string | null): Cue {
  if (name) {
    switch (key) {
      case "dawn_killed":
        return { key, name, text: `القتلة اختاروا ${name}... وللأسف، انتهت لعبته.` };
      case "dawn_saved":
        return { key, name, text: `القتلة حاولوا يتخلصون من ${name}... لكن المحاولة فشلت.` };
      case "verdict_eliminated":
        return { key, name, text: `تم استبعاد ${name} من اللعبة.` };
    }
  }
  return { key, text: SCRIPT[key] };
}
