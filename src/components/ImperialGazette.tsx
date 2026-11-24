import React from 'react';

export type GazetteCategory =
  | 'all'
  | 'deed'
  | 'fate'
  | 'rent'
  | 'tax'
  | 'court'
  | 'bank'
  | 'treasury'
  | 'trade'
  | 'general';

export interface GazetteDispatch {
  id: string;
  category: GazetteCategory;
  headline: string;
  body: string;
  timestamp: string;
  turn?: number;
  amount?: number;
  stamp: string;
  stampColor: 'gold' | 'crimson' | 'emerald' | 'navy' | 'sepia';
  playerName?: string;
  playerColor?: string;
  tileName?: string;
  isBreaking?: boolean;
}

export interface ImperialGazetteProps {
  logs?: string[];
  players?: Array<{ name: string; color: string }>;
  currentTurn?: number;
  rolls?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onTileSelect?: (tileName: string) => void;
}

export const ImperialGazette = React.memo<ImperialGazetteProps>(() => null);

export default ImperialGazette;
