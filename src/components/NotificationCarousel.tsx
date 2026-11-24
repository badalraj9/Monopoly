import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import './NotificationCarousel.css';

export type DispatchCategory =
  | 'deed'
  | 'fate'
  | 'rent'
  | 'tax'
  | 'court'
  | 'bank'
  | 'treasury'
  | 'trade'
  | 'general';

export interface DispatchItem {
  id: string;
  category: DispatchCategory;
  headline: string;
  body: string;
  timeStr: string;
  turn?: number;
  amount?: number;
  stamp: string;
  stampColor: 'emerald' | 'gold' | 'crimson' | 'navy' | 'sepia';
  playerName?: string;
  playerColor?: string;
  tileName?: string;
}

export interface NotificationCarouselProps {
  logs: string[];
  players?: Array<{ name: string; color: string }>;
  currentTurn?: number;
  onTileSelect?: (tileName: string) => void;
  autoFadeDelay?: number; // In ms, default 4500ms
}

function formatINR(val: number): string {
  return '₹' + Math.abs(val).toLocaleString('en-IN');
}

/**
 * Parses raw game log strings into clean, high-impact dispatch announcements
 */
function parseLogToDispatch(
  log: string,
  index: number,
  players?: Array<{ name: string; color: string }>,
  currentTurn?: number
): DispatchItem {
  const id = `dispatch-${index}-${log.slice(0, 18)}`;
  const text = log.trim();

  // Find matching player
  const player = players?.find((p) => text.startsWith(p.name) || text.includes(` ${p.name} `));
  const playerName = player?.name;
  const playerColor = player?.color;

  // Extract money amount if present
  const moneyMatch = text.match(/₹([0-9,]+)/);
  const amount = moneyMatch ? Number(moneyMatch[1].replace(/,/g, '')) : undefined;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 1. Chance / Community Chest
  if (text.startsWith('Chance:') || text.startsWith('Community Chest:') || text.includes('Chance') || text.includes('Community Chest')) {
    const isChance = text.includes('Chance');
    const parts = text.split(':');
    const content = parts.length > 1 ? parts.slice(1).join(':').trim() : text;
    return {
      id,
      category: 'fate',
      headline: isChance ? 'Providence Calls • Chance' : 'Community Chest',
      body: content,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: isChance ? 'CHANCE' : 'CHEST',
      stampColor: 'gold',
      playerName,
      playerColor,
    };
  }

  // 2. Property Deed Purchases
  if (text.includes('bought') && (text.includes('for ₹') || text.includes('for'))) {
    const deedMatch = text.match(/bought (.+?) for/);
    const tileName = deedMatch ? deedMatch[1].trim() : 'Property';
    return {
      id,
      category: 'deed',
      headline: `${playerName || 'Player'} Acquired ${tileName}`,
      body: `${playerName || 'Player'} registered deed conveyance for ${tileName}${amount ? ` at ${formatINR(amount)}` : ''}.`,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: 'CONVEYED',
      stampColor: 'emerald',
      playerName,
      playerColor,
      tileName,
    };
  }

  // 3. Quick-start deals
  if (text.includes('Quick-start deal')) {
    return {
      id,
      category: 'deed',
      headline: 'Imperial Charter • Free City Grants',
      body: text,
      timeStr,
      turn: currentTurn,
      stamp: 'CHARTERED',
      stampColor: 'gold',
    };
  }

  // 4. Rent Settlements
  if (text.toLowerCase().includes('rent')) {
    return {
      id,
      category: 'rent',
      headline: 'Tenancy Quittance & Rent Dues',
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: 'RENT',
      stampColor: 'navy',
      playerName,
      playerColor,
    };
  }

  // 5. Imperial Revenue & Tax
  if (text.includes('Tax') || text.includes('tax') || text.includes('GST') || text.includes('Assessment')) {
    return {
      id,
      category: 'tax',
      headline: 'Inland Revenue & Tax Levy',
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: 'TAX',
      stampColor: 'crimson',
      playerName,
      playerColor,
    };
  }

  // 6. Magistrate Court & Jail
  if (text.includes('Jail') || text.includes('jail') || text.includes('bail')) {
    const isBail = text.includes('bail');
    const isPardon = text.includes('Get Out') || text.includes('card');
    return {
      id,
      category: 'court',
      headline: isBail
        ? 'Bail Settled • Remand Lifted'
        : isPardon
        ? 'Magistrate Pardon Granted'
        : "Magistrate's Remand Warrant",
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: isBail || isPardon ? 'RELEASED' : 'REMANDED',
      stampColor: 'crimson',
      playerName,
      playerColor,
    };
  }

  // 7. Imperial Bank Facilities
  if (text.includes('borrowed') || text.includes('loan') || text.includes('Bank') || text.includes('repaid')) {
    const isPayoff = text.includes('settled') || text.includes('repaid');
    return {
      id,
      category: 'bank',
      headline: isPayoff ? 'Imperial Bank • Debt Discharged' : 'Imperial Bank • Credit Disbursed',
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: isPayoff ? 'CLEARED' : 'LOAN',
      stampColor: 'gold',
      playerName,
      playerColor,
    };
  }

  // 8. Circuit Pass & Salary
  if (text.includes('START') && text.includes('1,500')) {
    return {
      id,
      category: 'treasury',
      headline: 'Circuit Completed • Salary Disbursed',
      body: `${playerName || 'Traveler'} reached START and collected statutory ₹1,500 salary.`,
      timeStr,
      turn: currentTurn,
      amount: 1500,
      stamp: 'SALARY',
      stampColor: 'emerald',
      playerName,
      playerColor,
    };
  }

  // 9. Club House & Jackpot
  if (text.includes('Club House') || text.includes('Jackpot') || text.includes('Rest House')) {
    const isJackpot = text.includes('Jackpot');
    return {
      id,
      category: 'treasury',
      headline: isJackpot ? 'Tax Jackpot Claimed!' : 'Royal Club Hospitality Dividend',
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: isJackpot ? 'JACKPOT' : 'DIVIDEND',
      stampColor: 'gold',
      playerName,
      playerColor,
    };
  }

  // 10. Building Upgrades, Mortgages, Sales
  if (text.includes('upgraded') || text.includes('built') || text.includes('mortgage') || text.includes('sold')) {
    const isBuild = text.includes('upgraded') || text.includes('built');
    const isMortgage = text.includes('mortgaged');
    return {
      id,
      category: 'deed',
      headline: isBuild
        ? 'Real Estate Development'
        : isMortgage
        ? 'Mortgage Conveyance Executed'
        : 'Estate Liquidation Sanctioned',
      body: text,
      timeStr,
      turn: currentTurn,
      amount,
      stamp: isBuild ? 'BUILD' : isMortgage ? 'MORTGAGE' : 'LIQUIDATE',
      stampColor: 'sepia',
      playerName,
      playerColor,
    };
  }

  // 11. Trades
  if (text.includes('trade') || text.includes('Trade')) {
    return {
      id,
      category: 'trade',
      headline: 'Trade Accord Ratified',
      body: text,
      timeStr,
      turn: currentTurn,
      stamp: 'TRADE',
      stampColor: 'navy',
      playerName,
      playerColor,
    };
  }

  // 12. General Dispatches
  return {
    id,
    category: 'general',
    headline: 'Table Dispatch',
    body: text,
    timeStr,
    turn: currentTurn,
    stamp: 'DISPATCH',
    stampColor: 'sepia',
    playerName,
    playerColor,
  };
}

export function NotificationCarousel({
  logs = [],
  players = [],
  currentTurn = 0,
  onTileSelect,
  autoFadeDelay = 4500,
}: NotificationCarouselProps) {
  // Convert up to latest 20 logs into parsed dispatches
  const dispatches = useMemo(() => {
    return logs.slice(0, 20).map((log, idx) => parseLogToDispatch(log, idx, players, currentTurn));
  }, [logs, players, currentTurn]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFaded, setIsFaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const fadeTimerRef = useRef<number | null>(null);
  const lastLogRef = useRef<string | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const touchStartXRef = useRef<number | null>(null);

  // Clear timers safely
  const clearFadeTimer = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  // Start the 4.5s auto-fade countdown
  const startFadeTimer = useCallback(() => {
    clearFadeTimer();
    fadeTimerRef.current = window.setTimeout(() => {
      setIsFaded(true);
    }, autoFadeDelay);
  }, [clearFadeTimer, autoFadeDelay]);

  // When a new log arrives: jump to index 0, awaken, start fade timer
  useEffect(() => {
    if (!logs.length) return;
    const latestLog = logs[0];

    if (latestLog !== lastLogRef.current) {
      lastLogRef.current = latestLog;
      setCurrentIndex(0);
      setIsFaded(false);

      if (!isHovered) {
        startFadeTimer();
      }
    }
  }, [logs, isHovered, startFadeTimer]);

  // Pause fade while hovered; resume when mouse leaves
  useEffect(() => {
    if (isHovered) {
      clearFadeTimer();
      setIsFaded(false);
    } else if (!isFaded && dispatches.length > 0) {
      startFadeTimer();
    }
  }, [isHovered, isFaded, dispatches.length, clearFadeTimer, startFadeTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearFadeTimer();
  }, [clearFadeTimer]);

  if (!dispatches.length) return null;

  const currentDispatch = dispatches[currentIndex] || dispatches[0];

  const handlePrev = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (dispatches.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : dispatches.length - 1));
    setIsFaded(false);
    startFadeTimer();
  };

  const handleNext = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (dispatches.length <= 1) return;
    setCurrentIndex((prev) => (prev < dispatches.length - 1 ? prev + 1 : 0));
    setIsFaded(false);
    startFadeTimer();
  };

  // Mouse wheel scroll handler
  const handleWheel = (e: React.WheelEvent) => {
    if (dispatches.length <= 1) return;
    const now = Date.now();
    if (now - lastScrollTimeRef.current < 160) return;

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 8) return;

    if (delta > 0) {
      handleNext();
    } else {
      handlePrev();
    }
    lastScrollTimeRef.current = now;
  };

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    setIsHovered(true);
    setIsFaded(false);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current !== null) {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartXRef.current - touchEndX;
      if (Math.abs(diff) > 25) {
        if (diff > 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
      touchStartXRef.current = null;
    }
    setTimeout(() => {
      setIsHovered(false);
      startFadeTimer();
    }, 1800);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearFadeTimer();
    setIsFaded(true);
  };

  const handleWakeUp = () => {
    setIsFaded(false);
    startFadeTimer();
  };

  const handleTileClick = (e: React.MouseEvent) => {
    if (currentDispatch.tileName && onTileSelect) {
      e.stopPropagation();
      onTileSelect(currentDispatch.tileName);
    }
  };

  return (
    <aside
      className={`notification-carousel-host ${isFaded ? 'faded' : 'active'}`}
      aria-label="Table dispatches and announcements"
    >
      <div
        className="notification-ticker"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={isFaded ? handleWakeUp : undefined}
        title={isFaded ? 'Click to view latest dispatches' : 'Scroll mouse wheel or swipe to view previous announcements'}
      >
        {/* Subtle Category Stamp or Player Color Pip */}
        <div className="ticker-badge-wrap">
          {currentDispatch.playerColor ? (
            <span
              className="ticker-player-dot"
              style={{ background: currentDispatch.playerColor }}
              title={currentDispatch.playerName || 'Player'}
            />
          ) : null}
          <span className={`ticker-stamp stamp-${currentDispatch.stampColor}`}>
            {currentDispatch.stamp}
          </span>
        </div>

        {/* Dispatch Text Body */}
        <div
          className={`ticker-content ${currentDispatch.tileName && onTileSelect ? 'clickable-tile' : ''}`}
          onClick={handleTileClick}
          title={currentDispatch.tileName && onTileSelect ? `Inspect ${currentDispatch.tileName}` : undefined}
        >
          <span className="ticker-headline">{currentDispatch.headline}</span>
          <span className="ticker-sep">—</span>
          <span className="ticker-body">{currentDispatch.body}</span>
          {currentDispatch.amount !== undefined && currentDispatch.amount !== 0 && (
            <span
              className={`ticker-amount ${
                currentDispatch.category === 'tax' ||
                currentDispatch.category === 'court' ||
                (currentDispatch.category === 'rent' && currentDispatch.body.includes('paid'))
                  ? 'debit'
                  : 'credit'
              }`}
            >
              {formatINR(currentDispatch.amount)}
            </span>
          )}
        </div>

        {/* Scroll Controls (Prev / Next & Counter) */}
        {dispatches.length > 1 && (
          <div className="ticker-nav" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="ticker-nav-btn"
              onClick={handlePrev}
              aria-label="Previous announcement"
              title="Previous (or scroll up)"
            >
              <ChevronLeft size={12} />
            </button>
            <span className="ticker-counter" title="Current dispatch / Total">
              {currentIndex + 1}/{dispatches.length}
            </span>
            <button
              type="button"
              className="ticker-nav-btn"
              onClick={handleNext}
              aria-label="Next announcement"
              title="Next (or scroll down)"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        )}

        {/* Subtle Dismiss Cross */}
        <button
          type="button"
          className="ticker-dismiss-btn"
          onClick={handleDismiss}
          aria-label="Fade announcement"
          title="Fade announcement"
        >
          <X size={11} />
        </button>
      </div>
    </aside>
  );
}

export default NotificationCarousel;
