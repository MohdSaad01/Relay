import React from 'react';
import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';

/**
 * Hand-drawn bottom-navigation icons (P23) — stroke-based, 24x24 viewBox,
 * matching the line-icon language already established on Desktop
 * (desktop/src/renderer/icons.js: fill="none", stroke-width 2, round caps/
 * joins). No icon-font/icon-library dependency for three icons — only
 * react-native-svg itself (a rendering primitive, not a bundled icon set)
 * was added, mirroring why Desktop didn't pull one in either.
 */

interface IconProps {
  color: string;
  size: number;
}

/** Files tab: a folder. */
export function FolderIcon({ color, size }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 7.5C3 6.12 4.12 5 5.5 5H9.17C9.57 5 9.95 5.16 10.23 5.44L11.79 7H18.5C19.88 7 21 8.12 21 9.5V17.5C21 18.88 19.88 20 18.5 20H5.5C4.12 20 3 18.88 3 17.5V7.5Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Transfers tab: two opposing arrows — files moving both directions between devices. */
export function TransferIcon({ color, size }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="4" y1="7" x2="17" y2="7" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Polyline
        points="13,3 17,7 13,11"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1="20" y1="17" x2="7" y2="17" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Polyline
        points="11,13 7,17 11,21"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Settings tab: three preference sliders. */
export function SlidersIcon({ color, size }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="9" cy="6" r="2.5" stroke={color} strokeWidth={2} fill="#fff" />
      <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="15" cy="12" r="2.5" stroke={color} strokeWidth={2} fill="#fff" />
      <Line x1="3" y1="18" x2="21" y2="18" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="7" cy="18" r="2.5" stroke={color} strokeWidth={2} fill="#fff" />
    </Svg>
  );
}
