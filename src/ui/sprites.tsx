// Top-down GBA-style sprite silhouettes for each unit type.
// All sprites render in a unit coordinate space where the base circle = r 1.0, centered at (0,0).
// The Board wraps each in <g transform="translate(cx,cy) scale(r)">.

import type { ReactElement } from 'react';

type SP = {
  fill: string;   // faction primary colour
  light: string;  // lighter accent for internal detail
};

// ── Tyranid sprites ───────────────────────────────────────────────────────────

/** Termagant / Hormagaunt – small insectoid, 6 legs */
function Gaunt({ fill, light }: SP) {
  const leg = (x1: number, y1: number, x2: number, y2: number) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
  );
  return (
    <g>
      <ellipse rx={0.42} ry={0.28} fill={fill} />
      <circle cx={0} cy={-0.5} r={0.2} fill={fill} />
      {/* mandibles */}
      <line x1={-0.12} y1={-0.64} x2={-0.22} y2={-0.78} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <line x1={0.12} y1={-0.64} x2={0.22} y2={-0.78} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      {/* 6 legs */}
      {leg(-0.3, -0.12, -0.82, -0.42)}
      {leg(-0.32, 0.06, -0.9, 0.06)}
      {leg(-0.28, 0.22, -0.78, 0.6)}
      {leg(0.3, -0.12, 0.82, -0.42)}
      {leg(0.32, 0.06, 0.9, 0.06)}
      {leg(0.28, 0.22, 0.78, 0.6)}
    </g>
  );
}

/** Genestealer – 4 arms spread in an X, elongated skull */
function Genestealer({ fill, light }: SP) {
  const arm = (x1: number, y1: number, x2: number, y2: number) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={light} strokeWidth={0.15} strokeLinecap="round" />
  );
  return (
    <g>
      <ellipse rx={0.35} ry={0.42} fill={fill} />
      {/* elongated xenomorph skull */}
      <ellipse cx={0} cy={-0.7} rx={0.18} ry={0.26} fill={fill} />
      <line x1={0} y1={-0.44} x2={0} y2={-0.96} stroke={light} strokeWidth={0.06} />
      {/* 4 clawed arms */}
      {arm(-0.25, -0.22, -0.82, -0.72)}
      {arm(0.25, -0.22, 0.82, -0.72)}
      {arm(-0.25, 0.22, -0.82, 0.72)}
      {arm(0.25, 0.22, 0.82, 0.72)}
      {/* claw tips */}
      <circle cx={-0.82} cy={-0.72} r={0.09} fill={light} />
      <circle cx={0.82} cy={-0.72} r={0.09} fill={light} />
      <circle cx={-0.82} cy={0.72} r={0.09} fill={light} />
      <circle cx={0.82} cy={0.72} r={0.09} fill={light} />
    </g>
  );
}

/** Tyranid Warrior – upright, 4 arms, dorsal spines */
function Warrior({ fill, light }: SP) {
  return (
    <g>
      {/* body – taller oval */}
      <ellipse rx={0.38} ry={0.5} fill={fill} />
      {/* head with synapse crown */}
      <circle cx={0} cy={-0.68} r={0.22} fill={fill} />
      <polygon points="0,-0.92 -0.1,-0.78 0.1,-0.78" fill={light} />
      <polygon points="-0.16,-0.86 -0.24,-0.72 -0.06,-0.72" fill={light} />
      <polygon points="0.16,-0.86 0.24,-0.72 0.06,-0.72" fill={light} />
      {/* upper weapon arms */}
      <line x1={-0.32} y1={-0.28} x2={-0.88} y2={-0.6} stroke={light} strokeWidth={0.16} strokeLinecap="round" />
      <line x1={0.32} y1={-0.28} x2={0.88} y2={-0.6} stroke={light} strokeWidth={0.16} strokeLinecap="round" />
      {/* lower limbs */}
      <line x1={-0.3} y1={0.2} x2={-0.78} y2={0.62} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
      <line x1={0.3} y1={0.2} x2={0.78} y2={0.62} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
      {/* dorsal spine */}
      <ellipse cx={0} cy={-0.1} rx={0.1} ry={0.28} fill={light} opacity={0.5} />
    </g>
  );
}

/** Hive Guard – stocky body, forward bio-cannon arm */
function HiveGuard({ fill, light }: SP) {
  return (
    <g>
      {/* stocky body */}
      <ellipse rx={0.44} ry={0.38} fill={fill} />
      {/* heavy armour dome */}
      <ellipse rx={0.3} ry={0.25} fill={light} opacity={0.3} />
      {/* head */}
      <circle cx={0} cy={-0.52} r={0.2} fill={fill} />
      {/* massive bio-cannon pointing forward-left */}
      <rect x={-0.88} y={-0.12} width={0.6} height={0.22} rx={0.08} fill={light} opacity={0.7} />
      <line x1={-0.88} y1={0} x2={-0.44} y2={0} stroke={light} strokeWidth={0.14} />
      {/* support arm right */}
      <line x1={0.38} y1={-0.1} x2={0.8} y2={-0.45} stroke={light} strokeWidth={0.13} strokeLinecap="round" />
    </g>
  );
}

/** Zoanthrope – huge psyker brain-head, small vestigial body, tendrils */
function Zoanthrope({ fill, light }: SP) {
  return (
    <g>
      {/* tiny vestigial body */}
      <ellipse cy={0.35} rx={0.22} ry={0.3} fill={fill} />
      {/* big psychic dome head */}
      <circle cy={-0.22} r={0.62} fill={fill} />
      {/* glowing brain pattern */}
      <circle cy={-0.22} r={0.44} fill={light} opacity={0.18} />
      <circle cy={-0.22} r={0.26} fill={light} opacity={0.22} />
      {/* eye / psyker glow */}
      <circle cy={-0.18} r={0.09} fill={light} opacity={0.8} />
      {/* tendrils */}
      <line x1={-0.16} y1={0.05} x2={-0.72} y2={0.62} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <line x1={0.16} y1={0.05} x2={0.72} y2={0.62} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
    </g>
  );
}

/** Lictor – narrow mantis-killer, huge scything claws raised */
function Lictor({ fill, light }: SP) {
  return (
    <g>
      {/* narrow upright body */}
      <ellipse rx={0.22} ry={0.44} fill={fill} />
      {/* head */}
      <circle cy={-0.58} r={0.18} fill={fill} />
      {/* huge scything talons, raised like a praying mantis */}
      <line x1={-0.18} y1={-0.3} x2={-0.78} y2={-0.82} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      <line x1={0.18} y1={-0.3} x2={0.78} y2={-0.82} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      {/* inner claw blades */}
      <line x1={-0.78} y1={-0.82} x2={-0.48} y2={-0.92} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <line x1={0.78} y1={-0.82} x2={0.48} y2={-0.92} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      {/* small lower feet */}
      <line x1={-0.18} y1={0.32} x2={-0.55} y2={0.72} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <line x1={0.18} y1={0.32} x2={0.55} y2={0.72} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
    </g>
  );
}

/** Hive Tyrant (ground) – massive creature, 4 huge limbs spread wide */
function HiveTyrant({ fill, light }: SP) {
  return (
    <g>
      {/* large body */}
      <ellipse rx={0.5} ry={0.56} fill={fill} />
      {/* carapace plates */}
      <ellipse rx={0.36} ry={0.4} fill={light} opacity={0.25} />
      {/* large head with crest */}
      <circle cy={-0.72} r={0.26} fill={fill} />
      <polygon points="0,-1.0 -0.14,-0.82 0.14,-0.82" fill={light} />
      {/* 4 massive claw arms */}
      <line x1={-0.42} y1={-0.3} x2={-0.9} y2={-0.75} stroke={light} strokeWidth={0.2} strokeLinecap="round" />
      <line x1={0.42} y1={-0.3} x2={0.9} y2={-0.75} stroke={light} strokeWidth={0.2} strokeLinecap="round" />
      <line x1={-0.44} y1={0.18} x2={-0.92} y2={0.58} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      <line x1={0.44} y1={0.18} x2={0.92} y2={0.58} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      {/* tail */}
      <line x1={0} y1={0.56} x2={0.2} y2={0.88} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
    </g>
  );
}

/** Winged Hive Tyrant – same as ground but with wings */
function WingedHiveTyrant({ fill, light }: SP) {
  return (
    <g>
      <ellipse rx={0.42} ry={0.48} fill={fill} />
      <ellipse rx={0.28} ry={0.32} fill={light} opacity={0.22} />
      <circle cy={-0.62} r={0.22} fill={fill} />
      <polygon points="0,-0.88 -0.12,-0.72 0.12,-0.72" fill={light} />
      {/* wings spread wide */}
      <path d="M -0.38,-0.1 Q -0.92,-0.55 -0.78,0.08 L -0.38,0.08 Z" fill={light} opacity={0.35} />
      <path d="M  0.38,-0.1 Q  0.92,-0.55  0.78,0.08 L  0.38,0.08 Z" fill={light} opacity={0.35} />
      {/* wing membranes */}
      <line x1={-0.38} y1={-0.08} x2={-0.92} y2={-0.5} stroke={light} strokeWidth={0.1} />
      <line x1={0.38} y1={-0.08} x2={0.92} y2={-0.5} stroke={light} strokeWidth={0.1} />
      {/* weapon arms */}
      <line x1={-0.3} y1={-0.28} x2={-0.75} y2={-0.68} stroke={light} strokeWidth={0.16} strokeLinecap="round" />
      <line x1={0.3} y1={-0.28} x2={0.75} y2={-0.68} stroke={light} strokeWidth={0.16} strokeLinecap="round" />
    </g>
  );
}

/** Neurotyrant – floating with neural tentacles radiating down */
function Neurotyrant({ fill, light }: SP) {
  return (
    <g>
      {/* large floating body */}
      <circle r={0.55} fill={fill} />
      {/* neural glow rings */}
      <circle r={0.44} fill={light} opacity={0.14} />
      <circle r={0.3} fill={light} opacity={0.18} />
      {/* psychic eye cluster */}
      <circle r={0.1} fill={light} opacity={0.9} />
      <circle cx={-0.16} cy={-0.08} r={0.07} fill={light} opacity={0.7} />
      <circle cx={0.16} cy={-0.08} r={0.07} fill={light} opacity={0.7} />
      {/* neural tentacles radiating from body bottom */}
      {[-0.55, -0.28, 0, 0.28, 0.55].map((x, i) => (
        <line key={i} x1={x * 0.7} y1={0.38} x2={x} y2={0.9} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      ))}
    </g>
  );
}

/** Carnifex – massive crushing claws, wide armoured body */
function Carnifex({ fill, light }: SP) {
  return (
    <g>
      {/* wide heavy carapace */}
      <ellipse rx={0.62} ry={0.5} fill={fill} />
      {/* armour plates */}
      <ellipse rx={0.42} ry={0.34} fill={light} opacity={0.22} />
      {/* small head */}
      <circle cy={-0.62} r={0.2} fill={fill} />
      {/* HUGE crushing claw arms */}
      <line x1={-0.5} y1={-0.18} x2={-0.88} y2={-0.62} stroke={light} strokeWidth={0.26} strokeLinecap="round" />
      <line x1={0.5} y1={-0.18} x2={0.88} y2={-0.62} stroke={light} strokeWidth={0.26} strokeLinecap="round" />
      {/* claw tips (double-bladed) */}
      <line x1={-0.88} y1={-0.62} x2={-0.72} y2={-0.88} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={-0.88} y1={-0.62} x2={-1.0} y2={-0.82} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={0.88} y1={-0.62} x2={0.72} y2={-0.88} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={0.88} y1={-0.62} x2={1.0} y2={-0.82} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      {/* hind legs */}
      <line x1={-0.5} y1={0.3} x2={-0.82} y2={0.7} stroke={light} strokeWidth={0.15} strokeLinecap="round" />
      <line x1={0.5} y1={0.3} x2={0.82} y2={0.7} stroke={light} strokeWidth={0.15} strokeLinecap="round" />
    </g>
  );
}

/** Maleceptor – large oval body, prominent psychic hood/dome */
function Maleceptor({ fill, light }: SP) {
  return (
    <g>
      {/* body */}
      <ellipse rx={0.55} ry={0.62} fill={fill} />
      {/* psychic hood dome at top */}
      <ellipse cx={0} cy={-0.3} rx={0.4} ry={0.35} fill={light} opacity={0.28} />
      <ellipse cx={0} cy={-0.3} rx={0.26} ry={0.22} fill={light} opacity={0.35} />
      {/* glow point */}
      <circle cy={-0.3} r={0.1} fill={light} opacity={0.85} />
      {/* reaching arms */}
      <line x1={-0.48} y1={-0.15} x2={-0.92} y2={-0.52} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      <line x1={0.48} y1={-0.15} x2={0.92} y2={-0.52} stroke={light} strokeWidth={0.18} strokeLinecap="round" />
      {/* lower legs */}
      <line x1={-0.46} y1={0.35} x2={-0.78} y2={0.72} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={0.46} y1={0.35} x2={0.78} y2={0.72} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
    </g>
  );
}

/** Exocrine – wide body, prominent bio-plasma cannon dome on top */
function Exocrine({ fill, light }: SP) {
  return (
    <g>
      {/* wide body */}
      <ellipse rx={0.65} ry={0.5} fill={fill} />
      {/* bio-cannon dome – the key distinguishing feature */}
      <circle cy={-0.18} r={0.34} fill={light} opacity={0.38} />
      <circle cy={-0.18} r={0.22} fill={light} opacity={0.5} />
      <circle cy={-0.18} r={0.1} fill={light} opacity={0.95} />
      {/* cannon muzzles (6-barrelled bio-plasma array) */}
      {[-0.18, 0, 0.18].map((x, i) => (
        <circle key={i} cx={x} cy={-0.46} r={0.05} fill={light} opacity={0.9} />
      ))}
      {/* legs */}
      <line x1={-0.55} y1={0.2} x2={-0.88} y2={0.6} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={0.55} y1={0.2} x2={0.88} y2={0.6} stroke={light} strokeWidth={0.14} strokeLinecap="round" />
      <line x1={-0.38} y1={0.38} x2={-0.38} y2={0.75} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
      <line x1={0.38} y1={0.38} x2={0.38} y2={0.75} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
    </g>
  );
}

/** Winged Tyranid Prime – warrior with wings */
function WingedPrime({ fill, light }: SP) {
  return (
    <g>
      <ellipse rx={0.36} ry={0.46} fill={fill} />
      <circle cy={-0.62} r={0.2} fill={fill} />
      {/* wings */}
      <path d="M -0.3,-0.05 Q -0.88,-0.5 -0.72,0.12 L -0.3,0.12 Z" fill={light} opacity={0.32} />
      <path d="M  0.3,-0.05 Q  0.88,-0.5  0.72,0.12 L  0.3,0.12 Z" fill={light} opacity={0.32} />
      <line x1={-0.3} y1={0.0} x2={-0.88} y2={-0.46} stroke={light} strokeWidth={0.1} />
      <line x1={0.3} y1={0.0} x2={0.88} y2={-0.46} stroke={light} strokeWidth={0.1} />
      {/* weapon arms */}
      <line x1={-0.28} y1={-0.24} x2={-0.78} y2={-0.62} stroke={light} strokeWidth={0.15} strokeLinecap="round" />
      <line x1={0.28} y1={-0.24} x2={0.78} y2={-0.62} stroke={light} strokeWidth={0.15} strokeLinecap="round" />
    </g>
  );
}

// ── Space Marine sprites ──────────────────────────────────────────────────────

/** Generic Space Marine infantryman – iconic shoulder pads + round helmet */
function Marine({ fill, light }: SP) {
  return (
    <g>
      {/* torso */}
      <rect x={-0.3} y={-0.15} width={0.6} height={0.62} rx={0.1} fill={fill} />
      {/* shoulder pads – the iconic silhouette */}
      <ellipse cx={-0.52} cy={-0.08} rx={0.24} ry={0.18} fill={fill} />
      <ellipse cx={0.52} cy={-0.08} rx={0.24} ry={0.18} fill={fill} />
      {/* helmet */}
      <circle cy={-0.42} r={0.26} fill={fill} />
      {/* visor slit */}
      <rect x={-0.1} y={-0.46} width={0.2} height={0.08} rx={0.03} fill={light} opacity={0.7} />
      {/* gun barrel extending left */}
      <line x1={-0.54} y1={0.12} x2={-0.9} y2={0.12} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
      <rect x={-0.58} y={0.03} width={0.22} height={0.18} rx={0.05} fill={fill} />
      {/* legs */}
      <line x1={-0.14} y1={0.47} x2={-0.2} y2={0.82} stroke={fill} strokeWidth={0.22} strokeLinecap="round" />
      <line x1={0.14} y1={0.47} x2={0.2} y2={0.82} stroke={fill} strokeWidth={0.22} strokeLinecap="round" />
    </g>
  );
}

/** Scout – lighter armour, cloak, no shoulder pads */
function Scout({ fill, light }: SP) {
  return (
    <g>
      {/* body – narrower, no pads */}
      <ellipse rx={0.3} ry={0.46} fill={fill} />
      {/* hooded head */}
      <circle cy={-0.58} r={0.24} fill={fill} />
      {/* cloak/cape */}
      <path d="M -0.28,0.0 Q -0.72,0.3 -0.56,0.7 L 0,0.55 L 0.56,0.7 Q 0.72,0.3 0.28,0.0 Z" fill={light} opacity={0.3} />
      {/* sniper rifle */}
      <line x1={-0.28} y1={-0.08} x2={-0.92} y2={-0.08} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <circle cx={-0.92} cy={-0.08} r={0.05} fill={light} opacity={0.7} />
    </g>
  );
}

/** Aggressor – very wide and squat, fist gauntlets */
function Aggressor({ fill, light }: SP) {
  return (
    <g>
      {/* very wide squat body */}
      <ellipse rx={0.62} ry={0.44} fill={fill} />
      {/* round helmet, no neck */}
      <circle cy={-0.52} r={0.26} fill={fill} />
      <rect x={-0.1} y={-0.56} width={0.2} height={0.08} rx={0.03} fill={light} opacity={0.7} />
      {/* large fist gauntlets */}
      <circle cx={-0.72} cy={-0.02} r={0.24} fill={fill} />
      <circle cx={0.72} cy={-0.02} r={0.24} fill={fill} />
      {/* boltstorm nozzles */}
      <circle cx={-0.72} cy={-0.22} r={0.1} fill={light} opacity={0.6} />
      <circle cx={0.72} cy={-0.22} r={0.1} fill={light} opacity={0.6} />
      {/* legs */}
      <line x1={-0.22} y1={0.44} x2={-0.28} y2={0.78} stroke={fill} strokeWidth={0.24} strokeLinecap="round" />
      <line x1={0.22} y1={0.44} x2={0.28} y2={0.78} stroke={fill} strokeWidth={0.24} strokeLinecap="round" />
    </g>
  );
}

/** Bladeguard Veteran – Marine + large shield on left arm */
function Bladeguard({ fill, light }: SP) {
  return (
    <g>
      {/* torso */}
      <rect x={-0.28} y={-0.15} width={0.56} height={0.6} rx={0.1} fill={fill} />
      <ellipse cx={-0.5} cy={-0.08} rx={0.22} ry={0.17} fill={fill} />
      <ellipse cx={0.5} cy={-0.08} rx={0.22} ry={0.17} fill={fill} />
      <circle cy={-0.42} r={0.24} fill={fill} />
      <rect x={-0.09} y={-0.46} width={0.18} height={0.07} rx={0.03} fill={light} opacity={0.7} />
      {/* large storm shield on left */}
      <rect x={-0.88} y={-0.32} width={0.38} height={0.56} rx={0.1} fill={light} opacity={0.5} />
      <rect x={-0.82} y={-0.26} width={0.26} height={0.44} rx={0.06} fill={light} opacity={0.25} />
      {/* sword on right */}
      <line x1={0.5} y1={-0.5} x2={0.88} y2={0.38} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
      <line x1={0.42} y1={0.02} x2={0.72} y2={0.02} stroke={light} strokeWidth={0.08} />
      {/* legs */}
      <line x1={-0.1} y1={0.45} x2={-0.14} y2={0.82} stroke={fill} strokeWidth={0.22} strokeLinecap="round" />
      <line x1={0.1} y1={0.45} x2={0.14} y2={0.82} stroke={fill} strokeWidth={0.22} strokeLinecap="round" />
    </g>
  );
}

/** Inceptor – Marine with wide jump-pack wings */
function Inceptor({ fill, light }: SP) {
  return (
    <g>
      {/* body */}
      <rect x={-0.26} y={-0.18} width={0.52} height={0.56} rx={0.1} fill={fill} />
      <ellipse cx={-0.46} cy={-0.1} rx={0.2} ry={0.16} fill={fill} />
      <ellipse cx={0.46} cy={-0.1} rx={0.2} ry={0.16} fill={fill} />
      <circle cy={-0.42} r={0.22} fill={fill} />
      <rect x={-0.08} y={-0.46} width={0.16} height={0.07} rx={0.03} fill={light} opacity={0.7} />
      {/* jump-pack assembly spreads wide */}
      <rect x={-0.9} y={-0.05} width={0.36} height={0.44} rx={0.1} fill={fill} />
      <rect x={0.54} y={-0.05} width={0.36} height={0.44} rx={0.1} fill={fill} />
      {/* thruster nozzles */}
      <ellipse cx={-0.72} cy={0.42} rx={0.1} ry={0.08} fill={light} opacity={0.6} />
      <ellipse cx={0.72} cy={0.42} rx={0.1} ry={0.08} fill={light} opacity={0.6} />
      {/* assault bolters */}
      <line x1={-0.46} y1={0.1} x2={-0.92} y2={0.1} stroke={light} strokeWidth={0.1} />
      <line x1={0.46} y1={0.1} x2={0.92} y2={0.1} stroke={light} strokeWidth={0.1} />
    </g>
  );
}

/** Marine Character (Captain / Lieutenant / Librarian) – Marine + cloak + crest */
function MarineChar({ fill, light }: SP) {
  return (
    <g>
      {/* flowing cloak */}
      <path d="M -0.3,0.1 Q -0.75,0.45 -0.62,0.82 L 0,0.7 L 0.62,0.82 Q 0.75,0.45 0.3,0.1 Z" fill={light} opacity={0.32} />
      {/* torso */}
      <rect x={-0.28} y={-0.18} width={0.56} height={0.6} rx={0.1} fill={fill} />
      <ellipse cx={-0.5} cy={-0.1} rx={0.22} ry={0.17} fill={fill} />
      <ellipse cx={0.5} cy={-0.1} rx={0.22} ry={0.17} fill={fill} />
      {/* helmet with crest */}
      <circle cy={-0.44} r={0.24} fill={fill} />
      <rect x={-0.08} y={-0.68} width={0.16} height={0.26} rx={0.05} fill={light} opacity={0.7} />
      <rect x={-0.08} y={-0.48} width={0.16} height={0.07} rx={0.03} fill={light} opacity={0.75} />
      {/* command pistol / sword */}
      <line x1={0.46} y1={-0.3} x2={0.88} y2={0.32} stroke={light} strokeWidth={0.09} />
      {/* legs */}
      <line x1={-0.12} y1={0.42} x2={-0.16} y2={0.78} stroke={fill} strokeWidth={0.2} strokeLinecap="round" />
      <line x1={0.12} y1={0.42} x2={0.16} y2={0.78} stroke={fill} strokeWidth={0.2} strokeLinecap="round" />
    </g>
  );
}

/** Marneus Calgar – character + cape + ultra-gear (bigger/heavier) */
function Calgar({ fill, light }: SP) {
  return (
    <g>
      {/* big cloak */}
      <path d="M -0.4,0.05 Q -0.88,0.42 -0.72,0.88 L 0,0.72 L 0.72,0.88 Q 0.88,0.42 0.4,0.05 Z" fill={light} opacity={0.35} />
      {/* heavy torso */}
      <rect x={-0.34} y={-0.2} width={0.68} height={0.62} rx={0.1} fill={fill} />
      <ellipse cx={-0.58} cy={-0.1} rx={0.28} ry={0.2} fill={fill} />
      <ellipse cx={0.58} cy={-0.1} rx={0.28} ry={0.2} fill={fill} />
      {/* helmet with large crest */}
      <circle cy={-0.5} r={0.28} fill={fill} />
      <rect x={-0.1} y={-0.8} width={0.2} height={0.32} rx={0.06} fill={light} opacity={0.75} />
      <rect x={-0.1} y={-0.56} width={0.2} height={0.09} rx={0.03} fill={light} opacity={0.8} />
      {/* gauntlets of Ultramar */}
      <circle cx={-0.82} cy={0.05} r={0.22} fill={fill} />
      <circle cx={0.82} cy={0.05} r={0.22} fill={fill} />
      <circle cx={-0.82} cy={-0.12} r={0.09} fill={light} opacity={0.65} />
      <circle cx={0.82} cy={-0.12} r={0.09} fill={light} opacity={0.65} />
    </g>
  );
}

/** Redemptor / Ballistus Dreadnought – boxy walker, two arms */
function Dreadnought({ fill, light }: SP) {
  return (
    <g>
      {/* main body box */}
      <rect x={-0.5} y={-0.38} width={1.0} height={0.88} rx={0.1} fill={fill} />
      {/* viewport / sarcophagus */}
      <ellipse cy={-0.18} rx={0.28} ry={0.2} fill={light} opacity={0.38} />
      <ellipse cy={-0.18} rx={0.16} ry={0.12} fill={light} opacity={0.5} />
      {/* left arm – power fist */}
      <rect x={-0.88} y={-0.22} width={0.42} height={0.36} rx={0.1} fill={fill} />
      <rect x={-0.94} y={-0.15} width={0.12} height={0.22} rx={0.04} fill={light} opacity={0.5} />
      {/* right arm – cannon */}
      <rect x={0.46} y={-0.26} width={0.44} height={0.32} rx={0.08} fill={fill} />
      <line x1={0.9} y1={-0.1} x2={1.0} y2={-0.1} stroke={light} strokeWidth={0.12} strokeLinecap="round" />
      {/* leg stubs */}
      <rect x={-0.42} y={0.5} width={0.3} height={0.28} rx={0.06} fill={fill} />
      <rect x={0.12} y={0.5} width={0.3} height={0.28} rx={0.06} fill={fill} />
    </g>
  );
}

/** Gladiator Lancer – elongated tank, long lance cannon */
function Gladiator({ fill, light }: SP) {
  return (
    <g>
      {/* hull */}
      <ellipse rx={0.58} ry={0.44} fill={fill} />
      {/* track sponsons */}
      <rect x={-0.7} y={-0.1} width={0.2} height={0.52} rx={0.06} fill={fill} />
      <rect x={0.5} y={-0.1} width={0.2} height={0.52} rx={0.06} fill={fill} />
      {/* track detail lines */}
      {[-0.05, 0.1, 0.25].map((y, i) => (
        <line key={i} x1={-0.7} y1={y} x2={-0.5} y2={y} stroke={light} strokeWidth={0.04} opacity={0.6} />
      ))}
      {[-0.05, 0.1, 0.25].map((y, i) => (
        <line key={i + 3} x1={0.5} y1={y} x2={0.7} y2={y} stroke={light} strokeWidth={0.04} opacity={0.6} />
      ))}
      {/* turret */}
      <circle cy={-0.06} r={0.26} fill={fill} />
      <ellipse cy={-0.06} rx={0.18} ry={0.18} fill={light} opacity={0.2} />
      {/* Lancer gun – long lance barrel */}
      <rect x={-0.88} y={-0.1} width={0.88} height={0.14} rx={0.05} fill={fill} />
      <line x1={-0.88} y1={-0.03} x2={-1.0} y2={-0.03} stroke={light} strokeWidth={0.1} strokeLinecap="round" />
    </g>
  );
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function DefaultSprite({ fill, light }: SP) {
  return (
    <g>
      <circle r={0.7} fill={fill} />
      <circle r={0.4} fill={light} opacity={0.3} />
      <circle r={0.12} fill={light} opacity={0.8} />
    </g>
  );
}

// ── Sprite map ────────────────────────────────────────────────────────────────

type SpriteComp = (props: SP) => ReactElement;

const SPRITE_MAP: [RegExp, SpriteComp][] = [
  // Tyranids
  [/termagant|hormagaunt|neurogaunt/i, Gaunt],
  [/genestealer/i, Genestealer],
  [/winged hive tyrant/i, WingedHiveTyrant],
  [/winged tyranid prime/i, WingedPrime],
  [/hive tyrant/i, HiveTyrant],
  [/neurotyrant/i, Neurotyrant],
  [/tyranid warrior/i, Warrior],
  [/hive guard/i, HiveGuard],
  [/zoanthrope/i, Zoanthrope],
  [/lictor/i, Lictor],
  [/carnifex/i, Carnifex],
  [/maleceptor/i, Maleceptor],
  [/exocrine/i, Exocrine],
  // Space Marines
  [/marneus calgar/i, Calgar],
  [/aggressor/i, Aggressor],
  [/bladeguard/i, Bladeguard],
  [/inceptor/i, Inceptor],
  [/scout/i, Scout],
  [/redemptor|ballistus|dreadnought/i, Dreadnought],
  [/gladiator|lancer/i, Gladiator],
  [/captain|lieutenant|librarian|ancient|chaplain|apothecary|castellan/i, MarineChar],
  [/intercessor|hellblaster|infernus|heavy intercessor|assault intercessor/i, Marine],
];

export function unitSprite(unitName: string): SpriteComp {
  for (const [re, comp] of SPRITE_MAP) {
    if (re.test(unitName)) return comp;
  }
  return DefaultSprite;
}

/** Light accent colour for a faction's sprite detail. */
export const SPRITE_LIGHT: Record<string, string> = {
  player: '#e0ccff',
  ai: '#c5deff',
};
