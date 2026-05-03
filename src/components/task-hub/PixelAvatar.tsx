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
const PIXEL_GRIDS: Record<AgentTheme, number[][]> = {
  // Mario — Red cap with M badge
  mario: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 4, 4, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Luigi — Green cap with L badge, taller
  luigi: [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 4, 4, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Toad — Mushroom dome, round face, blue vest
  toad: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Peach — Gold crown, pink hair, pink dress
  peach: [
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0],
  ],
  // Donkey Kong — Brown body, wide face, red tie
  dk: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 4, 4, 2, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Yoshi — Green body, white belly, orange shell ridge
  yoshi: [
    [0, 0, 0, 4, 4, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 1, 3, 3, 1, 0, 0],
    [0, 0, 1, 3, 3, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
};

/* ── Color palettes per theme ── */
const PALETTES: Record<AgentTheme, Record<number, string>> = {
  mario: {
    1: 'hsl(0 72% 51%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(220 70% 45%)',
    4: 'hsl(45 80% 55%)',
  },
  luigi: {
    1: 'hsl(130 60% 40%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(220 70% 45%)',
    4: 'hsl(45 80% 55%)',
  },
  toad: {
    1: 'hsl(25 20% 92%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(220 60% 50%)',
    4: 'hsl(0 65% 55%)',
  },
  peach: {
    1: 'hsl(330 70% 75%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(330 50% 60%)',
    4: 'hsl(45 90% 55%)',
  },
  dk: {
    1: 'hsl(25 70% 35%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(25 40% 25%)',
    4: 'hsl(0 65% 50%)',
  },
  yoshi: {
    1: 'hsl(100 60% 50%)',
    2: 'hsl(28 60% 72%)',
    3: 'hsl(100 40% 80%)',
    4: 'hsl(25 90% 55%)',
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
