/** Original line-art emblems for each role (fedora, magnifier, doctor's bag, street lamp). */
import type { Role } from "@/lib/mafia/rules";

export function Emblem({ role, className = "" }: { role: Role | "city"; className?: string }) {
  return (
    <svg className={`mf-emblem ${className}`} viewBox="0 0 120 120" aria-hidden data-role={role}>
      {role === "mafia" && (
        <g>
          <ellipse cx="60" cy="84" rx="52" ry="10" className="fill" />
          <path className="fill" d="M29 83 C28 56 34 39 47 36 C53 35 56 43 60 43 C64 43 67 35 73 36 C86 39 92 56 91 83 Z" />
          <path className="band" d="M30.5 70 C50 74 70 74 89.5 70 L90.6 81 C70 85 50 85 29.4 81 Z" />
          <path className="line" d="M38 52 C46 47 52 49 56 51" />
          <path className="line drip" d="M60 96 C60 101 57 104 57 107 C57 110 63 110 63 107 C63 104 60 101 60 96 Z" />
        </g>
      )}
      {role === "detective" && (
        <g>
          <circle cx="50" cy="50" r="27" className="line thick" />
          <circle cx="50" cy="50" r="20" className="glass" />
          <path className="line" d="M36 40 C39 34 45 31 51 31" />
          <path className="fill" d="M68 64 L74 70 L104 100 C106 102 106 105 104 107 L101 110 C99 112 96 112 94 110 L64 80 L60 74 Z" />
          <path className="band" d="M70 72 L78 80 L74 84 L66 76 Z" />
        </g>
      )}
      {role === "doctor" && (
        <g>
          <path className="line thick" d="M44 44 C44 30 76 30 76 44" />
          <rect x="16" y="44" width="88" height="58" rx="9" className="fill" />
          <path className="band" d="M16 60 L104 60 L104 66 L16 66 Z" />
          <path className="cross" d="M54 70 H66 V78 H74 V90 H66 V98 H54 V90 H46 V78 H54 Z" />
          <circle cx="24" cy="52" r="2.5" className="glass" />
          <circle cx="96" cy="52" r="2.5" className="glass" />
        </g>
      )}
      {role === "citizen" && (
        <g>
          <circle cx="60" cy="40" r="26" className="glow" />
          <path className="fill" d="M58 46 H62 V106 H58 Z" />
          <path className="fill" d="M48 106 H72 L70 112 H50 Z" />
          <path className="fill" d="M46 28 L74 28 L69 44 L51 44 Z" />
          <path className="glass" d="M50 31 L70 31 L67 41 L53 41 Z" />
          <path className="fill" d="M44 28 L60 16 L76 28 Z" />
          <path className="line" d="M62 60 C74 60 80 56 84 50" />
        </g>
      )}
      {role === "city" && (
        <g>
          <circle cx="60" cy="72" r="30" className="glow" />
          <path className="line" d="M60 30 V20 M32 44 L26 38 M88 44 L94 38 M22 72 H12 M98 72 H108" />
          <path className="fill" d="M10 104 V80 H22 V70 H34 V86 H44 V62 H56 V90 H66 V74 H78 V58 H90 V84 H100 V76 H110 V104 Z" />
        </g>
      )}
    </svg>
  );
}
