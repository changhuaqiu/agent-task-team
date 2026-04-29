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
  // Jean - Knight (Anemo)
  jean: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 3, 3, 3, 3, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Keqing - Twin tails (Electro)
  keqing: [
    [3, 0, 0, 0, 0, 0, 0, 3],
    [3, 3, 0, 3, 3, 0, 3, 3],
    [3, 3, 2, 2, 2, 2, 3, 3],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Zhongli - Archon (Geo)
  zhongli: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 2, 2, 3, 0, 0],
    [0, 0, 0, 2, 2, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 3, 4, 4, 3, 1, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Nahida - Archon (Dendro)
  nahida: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [1, 1, 2, 2, 2, 2, 1, 1],
    [1, 1, 0, 2, 2, 0, 1, 1],
    [0, 0, 3, 1, 1, 3, 0, 0],
    [0, 0, 3, 4, 4, 3, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0],
  ],
  // Albedo - Chalk Prince (Geo)
  albedo: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 3, 3, 3, 3, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Venti - Tone-Deaf Bard (Anemo)
  venti: [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 3, 3, 3, 3, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
};

/* ── Color palettes per theme ── */
const PALETTES: Record<AgentTheme, Record<number, string>> = {
  jean: {
    1: 'hsl(160 40% 90%)',   // White/light green clothes
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(45 80% 65%)',    // Blonde hair
    4: 'hsl(160 40% 50%)',   // Anemo green accent
  },
  keqing: {
    1: 'hsl(280 50% 60%)',   // Purple clothes
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(280 40% 40%)',   // Dark purple hair
    4: 'hsl(40 80% 60%)',    // Gold accent
  },
  zhongli: {
    1: 'hsl(40 80% 55%)',    // Amber/Geo clothes
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(30 20% 20%)',    // Dark brown hair/clothes
    4: 'hsl(40 90% 70%)',    // Bright gold accent
  },
  nahida: {
    1: 'hsl(130 30% 90%)',   // White/green clothes
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(130 50% 45%)',   // Green hair
    4: 'hsl(40 80% 60%)',    // Gold accent
  },
  albedo: {
    1: 'hsl(45 30% 90%)',    // White coat
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(45 60% 60%)',    // Ash blonde hair
    4: 'hsl(200 60% 60%)',   // Star mark / vision
  },
  venti: {
    1: 'hsl(180 50% 50%)',   // Teal/Anemo clothes
    2: 'hsl(28 60% 72%)',    // skin
    3: 'hsl(220 60% 25%)',   // Dark blue hair
    4: 'hsl(180 80% 60%)',   // Bright cyan accent
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
