'use client';

import { type AgentTheme } from '@/store/taskHubStore';

/**
 * 8-bit style pixel person avatar rendered as inline SVG.
 * Each agent theme gets a unique color + slight silhouette variation.
 *
 * Grid: 8x8 pixel art, rendered at arbitrary size via viewBox.
 */

/* ── Per-theme pixel grids (8x8) ── */
/* 0 = transparent, 1 = primary, 2 = skin, 3 = dark/hair, 4 = accent */
/*
 * Color roles per character:
 *   Mario:  1=red(cap/shirt) 2=skin 3=brown(hair/mustache/shoes) 4=blue(overalls)
 *   Luigi:  1=green(cap/shirt) 2=skin 3=brown(hair/mustache/shoes) 4=blue(overalls)
 *   Toad:   1=white(mushroom cap) 2=skin 3=blue(vest) 4=red(spots)
 *   Peach:  1=pink(dress) 2=skin 3=blonde(hair) 4=gold(crown)
 *   DK:     1=brown(body) 2=skin(face) 3=dark-brown(feet) 4=red(tie)
 *   Yoshi:  1=green(body) 2=white(belly) 3=orange(shell) 4=skin(snout)
 */
const PIXEL_GRIDS: Record<AgentTheme, number[][]> = {
  // Mario — Red cap, mustache, blue overalls
  mario: [
    [0, 0, 1, 1, 1, 1, 0, 0], // red cap
    [0, 1, 1, 1, 1, 1, 1, 0], // red cap wider
    [0, 3, 2, 2, 2, 2, 3, 0], // brown hair + skin face
    [0, 0, 2, 3, 3, 2, 0, 0], // mustache!
    [0, 0, 1, 1, 1, 1, 0, 0], // red shirt
    [0, 0, 1, 4, 4, 1, 0, 0], // red shirt + blue overall straps
    [0, 0, 4, 4, 4, 4, 0, 0], // blue overalls
    [0, 0, 3, 0, 0, 3, 0, 0], // brown shoes
  ],
  // Luigi — Green cap, thinner face, mustache, blue overalls
  luigi: [
    [0, 0, 1, 1, 1, 1, 0, 0], // green cap
    [0, 1, 1, 4, 4, 1, 1, 0], // green cap with L badge
    [0, 0, 3, 2, 2, 3, 0, 0], // thinner face (Luigi is slimmer)
    [0, 0, 2, 3, 3, 2, 0, 0], // mustache
    [0, 0, 1, 1, 1, 1, 0, 0], // green shirt
    [0, 0, 1, 4, 4, 1, 0, 0], // green + blue
    [0, 0, 4, 4, 4, 4, 0, 0], // blue overalls
    [0, 0, 3, 0, 0, 3, 0, 0], // brown shoes
  ],
  // Peach — Gold crown, blonde hair, pink dress
  peach: [
    [0, 0, 4, 4, 4, 4, 0, 0], // gold crown
    [0, 0, 4, 4, 4, 4, 0, 0], // gold crown
    [0, 3, 2, 2, 2, 2, 3, 0], // blonde hair + face
    [0, 3, 2, 2, 2, 2, 3, 0], // blonde hair + face
    [0, 0, 1, 1, 1, 1, 0, 0], // pink dress
    [0, 0, 1, 4, 4, 1, 0, 0], // pink + gold brooch
    [0, 0, 1, 1, 1, 1, 0, 0], // pink dress
    [0, 0, 1, 0, 0, 1, 0, 0], // pink shoes
  ],
  // Donkey Kong — Wide brown head, red tie
  dk: [
    [0, 0, 1, 1, 1, 1, 0, 0], // brown head
    [0, 1, 1, 1, 1, 1, 1, 0], // brown head (WIDE)
    [0, 1, 2, 2, 2, 2, 1, 0], // brown + skin face
    [0, 0, 2, 2, 2, 2, 0, 0], // skin face
    [0, 0, 1, 4, 4, 1, 0, 0], // brown body + RED TIE
    [0, 0, 1, 1, 1, 1, 0, 0], // brown body
    [0, 0, 1, 1, 1, 1, 0, 0], // brown body
    [0, 0, 3, 0, 0, 3, 0, 0], // dark feet
  ],
};

/* ── Color palettes per theme ── */
const PALETTES: Record<AgentTheme, Record<number, string>> = {
  mario: {
    1: 'hsl(0 72% 51%)',    // Red (cap, shirt)
    2: 'hsl(28 60% 72%)',   // Skin
    3: 'hsl(25 40% 25%)',   // Dark brown (hair, mustache, shoes)
    4: 'hsl(220 70% 45%)',  // Blue (overalls)
  },
  luigi: {
    1: 'hsl(130 60% 40%)',  // Green (cap, shirt)
    2: 'hsl(28 60% 72%)',   // Skin
    3: 'hsl(25 40% 25%)',   // Dark brown (hair, mustache, shoes)
    4: 'hsl(220 70% 45%)',  // Blue (overalls)
  },
  peach: {
    1: 'hsl(330 70% 75%)',  // Pink (dress)
    2: 'hsl(28 60% 72%)',   // Skin
    3: 'hsl(45 80% 65%)',   // Blonde (hair)
    4: 'hsl(45 90% 55%)',   // Gold (crown, brooch)
  },
  dk: {
    1: 'hsl(25 70% 35%)',   // Brown (body)
    2: 'hsl(28 60% 72%)',   // Skin (face)
    3: 'hsl(25 40% 20%)',   // Dark brown (feet)
    4: 'hsl(0 65% 50%)',    // Red (tie)
  },
};

interface PixelAvatarProps {
  theme: AgentTheme;
  size?: number;
  className?: string;
}

export function PixelAvatar({ theme, size = 36, className }: PixelAvatarProps) {
  const grid = PIXEL_GRIDS[theme];
  const palette = PALETTES[theme];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      className={className}
      role="img"
      aria-label={`${theme} pixel avatar`}
      style={{ imageRendering: 'pixelated' }}
    >
      {grid.map((row, y) =>
        row.map((cell, x) =>
          cell > 0 ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={palette[cell]}
            />
          ) : null
        )
      )}
    </svg>
  );
}
