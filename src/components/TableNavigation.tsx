import React from 'react';
import {
  Users,
  ShoppingBag,
  Landmark,
  ArrowRightLeft,
  CircleHelp,
  Clock3,
  Volume2,
  VolumeX,
  Home,
  ChevronDown
} from 'lucide-react';
import './TableNavigation.css';

export interface TableNavigationProps {
  activePlayer: {
    name: string;
    color: string;
    cash: number;
    jail?: number;
    loan?: boolean;
    owned: number[];
  };
  activePlayerIndex: number;
  totalPlayers: number;
  onOpenPlayers: () => void;
  onOpenAssets: () => void;
  assetsCount: number;
  onOpenBank?: () => void;
  hasLoans?: boolean;
  onOpenTrade?: () => void;
  hasTrading?: boolean;
  tradeOffersCount?: number;
  onOpenRules: () => void;
  onHome: () => void;
  speed: number;
  onToggleSpeed: () => void;
  muted: boolean;
  onToggleMute: () => void;
  timerSeconds: number;
  money: (amount: number) => string;
}

export const TableNavigation: React.FC<TableNavigationProps> = ({
  activePlayer,
  totalPlayers,
  onOpenPlayers,
  onOpenAssets,
  assetsCount,
  onOpenBank,
  hasLoans = true,
  onOpenTrade,
  hasTrading = true,
  tradeOffersCount = 0,
  onOpenRules,
  onHome,
  speed,
  onToggleSpeed,
  muted,
  onToggleMute,
  timerSeconds,
  money
}) => {
  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <>
      <header className="table-nav-bar">
        <div className="nav-group-left">
          <button className="nav-home-btn" onClick={onHome} title="Return to lobby / menu">
            <span className="brand-dot">₹</span>
            <span className="brand-label">BUSINESS</span>
            <Home size={13} className="home-icon" />
          </button>

          <button
            className="active-player-pill"
            onClick={onOpenPlayers}
            title="Click to view all players, standings and net worth"
            style={{ '--player-color': activePlayer?.color || '#31443a' } as React.CSSProperties}
          >
            <i className="turn-dot" style={{ backgroundColor: activePlayer?.color }} />
            <div className="pill-text">
              <span className="player-turn-name">{activePlayer?.name || 'Player'}</span>
              <span className="player-turn-cash">{money(activePlayer?.cash || 0)}</span>
            </div>
            <div className="pill-roster-tag">
              <Users size={12} />
              <span>{totalPlayers}</span>
              <ChevronDown size={11} className="pill-chevron" />
            </div>
          </button>
        </div>

        <div className="nav-group-center desktop-only">
          <button className="nav-action-btn" onClick={onOpenPlayers} title="View table roster">
            <Users size={14} />
            <span>Players</span>
          </button>

          <button className="nav-action-btn" onClick={onOpenAssets} title="View and manage your properties">
            <ShoppingBag size={14} />
            <span>My Assets</span>
            <span className="nav-badge-count">{assetsCount}</span>
          </button>

          {hasLoans && onOpenBank && (
            <button className="nav-action-btn" onClick={onOpenBank} title="Imperial Bank loans & credit">
              <Landmark size={14} />
              <span>Bank</span>
            </button>
          )}

          {hasTrading && onOpenTrade && (
            <button className="nav-action-btn" onClick={onOpenTrade} title="Propose trade or view offers">
              <ArrowRightLeft size={14} />
              <span>Trade</span>
              {tradeOffersCount > 0 && <span className="nav-badge-alert">{tradeOffersCount}</span>}
            </button>
          )}

          <button className="nav-action-btn" onClick={onOpenRules} title="Game rules and payout guides">
            <CircleHelp size={14} />
            <span>Rules</span>
          </button>
        </div>

        <div className="nav-group-right">
          <button
            className="nav-control-btn speed-btn"
            onClick={onToggleSpeed}
            title="Toggle game animation speed"
          >
            {speed}×
          </button>

          <button
            className="nav-control-btn mute-btn"
            onClick={onToggleMute}
            title={muted ? 'Unmute dice & card sounds' : 'Mute sound effects'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <div className="nav-timer" title="Match duration">
            <Clock3 size={12} />
            <span>{formatTimer(timerSeconds)}</span>
          </div>

          <button
            className="nav-action-btn mobile-rules-btn mobile-only"
            onClick={onOpenRules}
            title="Game rules"
          >
            <CircleHelp size={14} />
          </button>
        </div>
      </header>

      {/* Floating Action Dock for Mobile Devices */}
      <nav className="mobile-action-dock" aria-label="Quick game actions">
        <button className="dock-btn" onClick={onOpenPlayers}>
          <Users size={16} />
          <span>Players</span>
        </button>

        <button className="dock-btn" onClick={onOpenAssets}>
          <ShoppingBag size={16} />
          <span>Assets</span>
          {assetsCount > 0 && <span className="dock-badge">{assetsCount}</span>}
        </button>

        {hasLoans && onOpenBank && (
          <button className="dock-btn" onClick={onOpenBank}>
            <Landmark size={16} />
            <span>Bank</span>
          </button>
        )}

        {hasTrading && onOpenTrade && (
          <button className="dock-btn" onClick={onOpenTrade}>
            <ArrowRightLeft size={16} />
            <span>Trade</span>
            {tradeOffersCount > 0 && <span className="dock-badge alert">{tradeOffersCount}</span>}
          </button>
        )}

        <button className="dock-btn" onClick={onOpenRules}>
          <CircleHelp size={16} />
          <span>Rules</span>
        </button>
      </nav>
    </>
  );
};

export default TableNavigation;
