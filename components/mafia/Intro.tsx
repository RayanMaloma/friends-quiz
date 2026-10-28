"use client";

/**
 * The opening sequence on the TV (the server's 10-second `intro` phase).
 *
 *   0–3s  darkness falls, fog drifts in, the title surfaces
 *   3–7s  crimson light and sweeping shadows, the title pushes in, the narrator speaks
 *   7–10s the title rises away and a ٣ ٢ ١ countdown hands over to the role reveal
 *
 * Every animation is offset by how far into the phase this screen is
 * (negative delays), so a refresh or a late TV joins mid-shot instead of
 * restarting. The countdown digit is computed from the server clock.
 */
import React, { useState } from "react";
import { Emblem } from "./Emblem";
import { INTRO, introDigit } from "./timing";

export function IntroSequence({ elapsed }: { elapsed: number }) {
  // Where the film was when this screen joined it; CSS plays on from there.
  const [offset] = useState(() => Math.max(0, elapsed));
  const digit = introDigit(elapsed);
  return (
    <div className="mf-intro-film" style={{ "--intro-t": `${-offset}ms` } as React.CSSProperties} aria-live="polite">
      <div className="mf-intro-dark" />
      <div className="mf-intro-fog" />
      <div className="mf-intro-crimson" />
      <div className="mf-intro-beam is-a" />
      <div className="mf-intro-beam is-b" />
      <Emblem role="mafia" className="mf-intro-shadow" />
      <div className="mf-intro-title">
        <p className="mf-intro-eyebrow">ألعاب الشلّة تقدّم</p>
        <h1 className="mf-intro-wordmark" dir="ltr">MAFIA</h1>
        <p className="mf-intro-ar">المافيا</p>
      </div>
      <div className="mf-intro-count" aria-label={digit ? `تبدأ اللعبة بعد ${digit}` : undefined}>
        {digit && <span key={digit}>{digit}</span>}
      </div>
      <div className="mf-intro-iris" />
      <span className="mf-sr">المقدمة: {Math.max(0, Math.ceil((INTRO.end - elapsed) / 1000))} ثواني</span>
    </div>
  );
}
