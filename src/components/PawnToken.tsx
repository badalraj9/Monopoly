import React from 'react';

export interface PawnTokenProps {
  name: string;
  color: string;
  index: number;
  isMoving?: boolean;
  size?: number | string | { width?: number | string; height?: number | string };
}

export const PawnToken = React.memo(function PawnToken({
  name,
  color,
  index,
  isMoving,
  size
}: PawnTokenProps) {
  let tokenWidth: number | string = 20;
  let tokenHeight: number | string = 25;
  if (typeof size === 'number') {
    tokenWidth = size;
    tokenHeight = Math.round(size * 1.25);
  } else if (typeof size === 'string') {
    tokenWidth = size;
    tokenHeight = size;
  } else if (size && typeof size === 'object') {
    if (size.width !== undefined) tokenWidth = size.width;
    if (size.height !== undefined) tokenHeight = size.height;
  }

  const cleanId = `${index}-${name.replace(/[^a-zA-Z0-9]/g, '')}`;
  const brassGradId = `brass-pawn-${cleanId}`;
  const gemGradId = `gem-pawn-${cleanId}`;
  const shadowId = `pawn-shadow-${cleanId}`;
  const initial = (name || 'P').trim().slice(0, 1).toUpperCase();

  return (
    <svg
      className={`pawn-token ${isMoving ? 'hopping' : ''}`}
      viewBox="0 0 24 30"
      width={tokenWidth}
      height={tokenHeight}
      aria-label={`Player ${name}`}
      role="img"
    >
      <defs>
        {/* Antique turned brass gradient with warm highlights and deep shadows */}
        <linearGradient id={brassGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="25%" stopColor="#d4af37" />
          <stop offset="60%" stopColor="#99701d" />
          <stop offset="85%" stopColor="#63450c" />
          <stop offset="100%" stopColor="#3d2805" />
        </linearGradient>

        {/* Polished player-colored gemstone cabochon with inner ambient light */}
        <radialGradient id={gemGradId} cx="36%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.8} />
          <stop offset="28%" stopColor={color} />
          <stop offset="80%" stopColor={color} />
          <stop offset="100%" stopColor="#1a1410" />
        </radialGradient>

        {/* Tactile physical shadow filter */}
        <filter id={shadowId} x="-20%" y="-15%" width="150%" height="150%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="1.6" floodColor="#1a1c17" floodOpacity="0.45" />
          <feDropShadow dx="0" dy="0.7" stdDeviation="0.4" floodColor="#000000" floodOpacity="0.3" />
        </filter>
      </defs>

      <g filter={`url(#${shadowId})`} className="pawn-structure">
        {/* Heavy turned pedestal base */}
        <ellipse
          cx="12"
          cy="26.2"
          rx="8.2"
          ry="2.4"
          fill="#4a330a"
          stroke="#261b05"
          strokeWidth="0.6"
        />
        <path
          d="M5.5 25.5 C5.5 22.2 7.8 20.4 12 20.4 C16.2 20.4 18.5 22.2 18.5 25.5 Z"
          fill={`url(#${brassGradId})`}
          stroke="#261b05"
          strokeWidth="0.6"
        />

        {/* Tapered hourglass waist */}
        <path
          d="M8.8 20.4 C8.8 17 8.5 14.8 9.4 13.8 L14.6 13.8 C15.5 14.8 15.2 17 15.2 20.4 Z"
          fill={`url(#${brassGradId})`}
          stroke="#261b05"
          strokeWidth="0.6"
        />

        {/* Ornamental brass collar ring */}
        <ellipse
          cx="12"
          cy="13.8"
          rx="4.8"
          ry="1.4"
          fill="#fef08a"
          stroke="#261b05"
          strokeWidth="0.6"
        />

        {/* Imperial brass finial head / bezel setting */}
        <circle
          cx="12"
          cy="7.4"
          r="6"
          fill={`url(#${brassGradId})`}
          stroke="#261b05"
          strokeWidth="0.7"
        />

        {/* Radiant player gem cabochon */}
        <circle
          cx="12"
          cy="7.4"
          r="4.5"
          fill={`url(#${gemGradId})`}
          stroke="rgba(255, 255, 255, 0.55)"
          strokeWidth="0.5"
        />

        {/* Facet specular gleam */}
        <path
          d="M9.8 5 C10.6 4.1 12 3.9 13.3 4.3"
          stroke="rgba(255, 255, 255, 0.85)"
          strokeWidth="0.75"
          strokeLinecap="round"
          fill="none"
        />

        {/* Engraved player initial */}
        <text
          x="12"
          y="9.8"
          textAnchor="middle"
          fontSize="5.8"
          fontFamily="'Playfair Display', Georgia, serif"
          fontWeight="700"
          fill="#ffffff"
          className="pawn-initial"
        >
          {initial}
        </text>
      </g>
    </svg>
  );
});

export default PawnToken;
