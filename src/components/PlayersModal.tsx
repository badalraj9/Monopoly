import React from 'react';
import { X, Landmark, Users, Building2, Shield, ShoppingBag, LogOut } from 'lucide-react';
import './PlayersModal.css';

export interface PlayerModalData {
  name: string;
  color: string;
  cash: number;
  pos: number;
  lapsCompleted?: number;
  skipTurns?: number;
  owned: number[];
  buildings: Record<number, number>;
  mortgaged: number[];
  jail: number;
  jailCard: number;
  loan: boolean;
  loanLaps: number;
  active: boolean;
  loanTier?: string;
  loanMaxLaps?: number;
  loanInstallment?: number;
}

export interface PlayersModalProps {
  isOpen: boolean;
  onClose: () => void;
  players: any[];
  turn: number;
  controlPlayer: number;
  room?: any;
  roomSeat?: number;
  features: {
    upgrades: boolean;
    mortgages: boolean;
    auctions: boolean;
    loans: boolean;
    trading: boolean;
    taxMode: 'dynamic' | 'flat';
    rest: 'skip' | 'free' | 'jackpot';
    mode: 'last' | 'timed';
    duration: number;
    hidden?: boolean;
  };
  tradeCounts?: Record<number, number>;
  onInspectPlayer: (index: number) => void;
  onConfirmLeave?: (index: number) => void;
  netWorth: (player: any) => number;
  money: (amount: number) => string;
}

export const PlayersModal: React.FC<PlayersModalProps> = ({
  isOpen,
  onClose,
  players,
  turn,
  controlPlayer,
  room,
  roomSeat,
  features,
  tradeCounts = {},
  onInspectPlayer,
  onConfirmLeave,
  netWorth,
  money
}) => {
  if (!isOpen) return null;

  const activePlayers = players.filter(p => p.active);

  return (
    <div className="players-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <section className="players-modal" onClick={e => e.stopPropagation()}>
        <header className="players-modal-header">
          <div>
            <div className="eyebrow">TABLE ROSTER · STANDINGS</div>
            <h2>Active Players & Empire Net Worth</h2>
            <p className="players-subtitle">
              <Users size={13} /> {activePlayers.length} Active / {players.length} Total Players
            </p>
          </div>
          <button className="icon-btn close-btn" onClick={onClose} aria-label="Close players panel">
            <X size={18} />
          </button>
        </header>

        <div className="players-grid">
          {players.map((q, i) => {
            const isTurn = i === turn;
            const isMe = room && roomSeat !== undefined && roomSeat >= 0 ? i === roomSeat : i === controlPlayer;
            const presence = room?.players?.find((x: any) => x.index === i);
            const isOnline = presence?.online ?? true;
            const nw = netWorth(q);
            const hiddenCash = features.hidden && !isTurn;

            return (
              <article
                key={q.name + i}
                className={`player-roster-card ${isTurn ? 'current-turn' : ''} ${!q.active ? 'eliminated' : ''}`}
                style={{ '--player-color': q.color } as React.CSSProperties}
              >
                <div className="card-top">
                  <div className="player-avatar" style={{ backgroundColor: q.color }}>
                    {q.name.charAt(0).toUpperCase()}
                  </div>

                  <div className="player-meta">
                    <div className="name-row">
                      <b className="name-text">{q.name}</b>
                      {isMe && <span className="you-pill">YOU</span>}
                      {room && (
                        <span
                          className={`presence-dot ${isOnline ? 'online' : 'reconnecting'}`}
                          title={isOnline ? 'Online' : 'Reconnecting'}
                        />
                      )}
                    </div>
                    <span className="turn-status">
                      {isTurn ? '• PLAYING CURRENT TURN' : q.active ? 'In the game' : 'Bankrupt'}
                    </span>
                  </div>

                  <div className="cash-col">
                    <span className="label">LIQUID CASH</span>
                    <b className="cash-val">{hiddenCash ? '₹???,???' : money(q.cash)}</b>
                  </div>
                </div>

                <div className="card-metrics">
                  <div className="metric">
                    <span className="metric-label">NET WORTH</span>
                    <b className="metric-val">{money(nw)}</b>
                  </div>
                  <div className="metric">
                    <span className="metric-label">PROPERTIES</span>
                    <span className="metric-val">
                      <Landmark size={12} /> {q.owned.length} assets
                    </span>
                  </div>
                </div>

                <div className="card-badges">
                  {q.jail > 0 && <span className="roster-badge jail-badge">IN JAIL ({q.jail}/3)</span>}
                  {q.loan && <span className="roster-badge loan-badge">LOAN {q.loanLaps}/6</span>}
                  {tradeCounts[i] > 0 && (
                    <span className="roster-badge trade-badge">{tradeCounts[i]} TRADE OFFERS</span>
                  )}
                </div>

                <div className="card-actions">
                  <button
                    className="action-btn view-assets-btn"
                    onClick={() => {
                      onInspectPlayer(i);
                      onClose();
                    }}
                  >
                    <ShoppingBag size={13} /> View Assets ({q.owned.length})
                  </button>

                  {q.active && onConfirmLeave && (!room || i === roomSeat) && (
                    <button
                      className="action-btn leave-btn"
                      onClick={() => {
                        onConfirmLeave(i);
                        onClose();
                      }}
                    >
                      <LogOut size={12} /> Forfeit
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="table-rules-summary">
          <div className="rules-head">
            <Shield size={14} /> <b>Active Table Rules</b>
          </div>
          <div className="rules-pills">
            <span>{features.upgrades ? '✓ Buildings Enabled' : '✗ Base Rent Only'}</span>
            <span>{features.mortgages ? '✓ Mortgages Active' : '✗ Mortgages Disabled'}</span>
            <span>{features.auctions ? '✓ Auctions On' : '✗ No Auctions'}</span>
            <span>{features.loans ? '✓ Imperial Bank Loans' : '✗ No Loans'}</span>
            <span>{features.trading ? '✓ Player Trading' : '✗ Trading Off'}</span>
            <span>Tax: {features.taxMode === 'flat' ? 'Flat ₹200' : 'Dynamic'}</span>
            <span>Rest House: {features.rest}</span>
          </div>
        </div>

        <footer className="players-modal-footer">
          <span>Tap any player to inspect their portfolio</span>
          <button className="primary" onClick={onClose}>
            Back to Game Board
          </button>
        </footer>
      </section>
    </div>
  );
};

export default PlayersModal;
