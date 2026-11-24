import React, { useState, useMemo } from 'react';
import {
  Newspaper,
  Scroll,
  Coins,
  Scale,
  Building2,
  HelpCircle,
  Landmark,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  Filter,
} from 'lucide-react';
import './EventNotification.css';

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
  logs: string[];
  players?: Array<{ name: string; color: string }>;
  currentTurn?: number;
  rolls?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onTileSelect?: (tileName: string) => void;
}

function formatINR(val: number): string {
  return '₹' + Math.abs(val).toLocaleString('en-IN');
}

/**
 * Parses raw game log strings into authentic colonial newspaper dispatches
 */
function parseLogToDispatch(
  log: string,
  index: number,
  players?: Array<{ name: string; color: string }>,
  currentTurn?: number
): GazetteDispatch {
  const id = `log-${index}-${log.slice(0, 16)}`;
  const text = log.trim();

  // Find matching player
  const player = players?.find((p) => text.startsWith(p.name) || text.includes(` ${p.name} `));
  const playerName = player?.name;
  const playerColor = player?.color;

  // Extract money amount if present
  const moneyMatch = text.match(/₹([0-9,]+)/);
  const amount = moneyMatch ? Number(moneyMatch[1].replace(/,/g, '')) : undefined;

  // Format relative timestamp
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 1. Chance / Community Chest
  if (text.startsWith('Chance:') || text.startsWith('Community Chest:')) {
    const isChance = text.startsWith('Chance:');
    const parts = text.split(':');
    const content = parts.slice(1).join(':').trim();
    return {
      id,
      category: 'fate',
      headline: isChance ? 'Providence Calls • Chance Drawn' : 'Imperial Chest • Decree Issued',
      body: content,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: isChance ? 'CHANCE' : 'CHEST',
      stampColor: 'gold',
      playerName,
      playerColor,
    };
  }

  // 2. Property Deed Purchases
  if (text.includes('bought') && text.includes('for ₹')) {
    const deedMatch = text.match(/bought (.+?) for ₹/);
    const tileName = deedMatch ? deedMatch[1].trim() : 'Property';
    return {
      id,
      category: 'deed',
      headline: `${playerName || 'Investor'} Acquires ${tileName}`,
      body: `The municipal title deed of ${tileName} was officially conveyed and registered in the sovereign registry.`,
      timestamp: timeStr,
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
      timestamp: timeStr,
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
      headline: 'Tenancy Quittance & Rent Dues Settled',
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: 'DISCHARGED',
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
      headline: 'Imperial Board of Revenue Assessment',
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: 'LEVIED',
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
        ? 'Bail Settle • Remand Lifted'
        : isPardon
        ? 'Magistrate Court Pardon Exercised'
        : "Magistrate's Remand Warrant Executed",
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: isBail || isPardon ? 'RELEASED' : 'WARRANT',
      stampColor: 'crimson',
      playerName,
      playerColor,
    };
  }

  // 7. Imperial Bank Facilities
  if (text.includes('borrowed') || text.includes('loan') || text.includes('Bank')) {
    const isPayoff = text.includes('settled') || text.includes('repaid');
    return {
      id,
      category: 'bank',
      headline: isPayoff ? 'Imperial Bank • Loan Balance Discharged' : 'Imperial Bank • Credit Facility Disbursed',
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: isPayoff ? 'CLEARED' : 'CREDITED',
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
      headline: 'Full Circuit Completed • Salary Disbursed',
      body: `${playerName || 'Traveler'} reached START and collected the statutory ₹1,500 circuit stipend.`,
      timestamp: timeStr,
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
      headline: isJackpot ? 'Tax Jackpot Claimed at Dak Bungalow' : 'Royal Club House Hospitality Dividend',
      body: text,
      timestamp: timeStr,
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
        ? 'Real Estate Development Undertaken'
        : isMortgage
        ? 'Mortgage Conveyance Executed'
        : 'Estate Liquidation Sanctioned',
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      amount,
      stamp: isBuild ? 'CONSTRUCTED' : 'MORTGAGED',
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
      headline: 'Bilateral Trade Accord Ratified',
      body: text,
      timestamp: timeStr,
      turn: currentTurn,
      stamp: 'RATIFIED',
      stampColor: 'navy',
      playerName,
      playerColor,
    };
  }

  // 12. General Dispatches
  return {
    id,
    category: 'general',
    headline: 'Imperial Board Dispatch',
    body: text,
    timestamp: timeStr,
    turn: currentTurn,
    stamp: 'GAZETTED',
    stampColor: 'sepia',
    playerName,
    playerColor,
  };
}

export function ImperialGazette({
  logs = [],
  players = [],
  currentTurn = 0,
  rolls = 0,
  collapsed = false,
  onToggleCollapse,
  onTileSelect,
}: ImperialGazetteProps) {
  const [filter, setFilter] = useState<GazetteCategory>('all');

  // Convert game log entries into rich news dispatches
  const dispatches = useMemo(() => {
    return logs.map((log, index) => {
      const item = parseLogToDispatch(log, index, players, currentTurn);
      if (index === 0) {
        item.isBreaking = true;
      }
      return item;
    });
  }, [logs, players, currentTurn]);

  // Filtered entries
  const filteredDispatches = useMemo(() => {
    if (filter === 'all') return dispatches;
    if (filter === 'treasury') {
      return dispatches.filter((d) => d.category === 'treasury' || d.category === 'bank');
    }
    return dispatches.filter((d) => d.category === filter);
  }, [dispatches, filter]);

  // Collapsed spine view for narrow screens or minimized state
  if (collapsed) {
    return (
      <aside
        className="imperial-gazette-spine"
        onClick={onToggleCollapse}
        title="Expand Imperial Gazette (Live Dispatches)"
        role="button"
        tabIndex={0}
      >
        <div className="gazette-spine-content">
          <Newspaper size={18} className="gazette-spine-icon" />
          <span className="gazette-spine-title">THE IMPERIAL GAZETTE</span>
          <span className="gazette-spine-counter">{dispatches.length}</span>
          <ChevronRight size={16} className="gazette-spine-chevron" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="imperial-gazette-panel" aria-label="Imperial Gazette Announcement Column">
      {/* Newspaper Masthead */}
      <header className="gazette-masthead">
        <div className="masthead-top-sub">
          <span>PUBLISHED BY HIGH AUTHORITY</span>
          <span className="masthead-dot">•</span>
          <span>CHRONICLE OF COMMERCE</span>
        </div>

        <div className="masthead-main-row">
          <div className="masthead-brand-crest">
            <Newspaper size={20} />
          </div>
          <div className="masthead-title-wrap">
            <h1 className="gazette-title">THE IMPERIAL GAZETTE</h1>
            <p className="gazette-tagline">The Daily Financial Gazette & Registry of India</p>
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              className="gazette-collapse-btn"
              onClick={onToggleCollapse}
              aria-label="Collapse Gazette"
              title="Collapse announcement column"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        <div className="masthead-edition-bar">
          <span className="edition-item">
            VOL. {Math.max(1, Math.floor((rolls || 1) / 4) + 1)} • NO. {dispatches.length}
          </span>
          <span className="edition-item live-pulse-badge">
            <span className="live-pulse-dot" /> LIVE DISPATCH
          </span>
        </div>

        {/* Vintage Engraved Divider */}
        <div className="gazette-engraved-rule">
          <span className="rule-flourish">❖</span>
        </div>

        {/* Category Filters */}
        <nav className="gazette-filters-nav" aria-label="Gazette news categories">
          <button
            type="button"
            className={`gazette-filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({dispatches.length})
          </button>
          <button
            type="button"
            className={`gazette-filter-tab ${filter === 'deed' ? 'active' : ''}`}
            onClick={() => setFilter('deed')}
          >
            Deeds
          </button>
          <button
            type="button"
            className={`gazette-filter-tab ${filter === 'fate' ? 'active' : ''}`}
            onClick={() => setFilter('fate')}
          >
            Fate
          </button>
          <button
            type="button"
            className={`gazette-filter-tab ${filter === 'rent' ? 'active' : ''}`}
            onClick={() => setFilter('rent')}
          >
            Rent
          </button>
          <button
            type="button"
            className={`gazette-filter-tab ${filter === 'court' ? 'active' : ''}`}
            onClick={() => setFilter('court')}
          >
            Court
          </button>
        </nav>
      </header>

      {/* Live Dispatches Scroll Area */}
      <div className="gazette-feed-scroll">
        {filteredDispatches.length === 0 ? (
          <div className="gazette-empty-state">
            <Scroll size={32} className="gazette-empty-icon" />
            <h3 className="gazette-empty-title">Awaiting Fresh Dispatches</h3>
            <p className="gazette-empty-sub">
              Roll the dice and make your moves. Deeds, court orders, and decrees will be gazetted here in real time.
            </p>
          </div>
        ) : (
          filteredDispatches.map((item, i) => {
            const isFirst = i === 0;
            return (
              <article
                key={item.id}
                className={`gazette-card ${isFirst ? 'is-latest' : ''} ${item.category}`}
                onClick={() => item.tileName && onTileSelect?.(item.tileName)}
                title={item.tileName ? `Inspect ${item.tileName}` : undefined}
              >
                {/* Vintage Rubber Stamp */}
                <div className={`gazette-stamp ${item.stampColor}`}>{item.stamp}</div>

                {/* Card Header Tag */}
                <div className="gazette-card-meta">
                  <span className="gazette-category-tag">
                    {item.category === 'fate' && <HelpCircle size={11} />}
                    {item.category === 'deed' && <Building2 size={11} />}
                    {item.category === 'rent' && <Coins size={11} />}
                    {item.category === 'tax' && <Scale size={11} />}
                    {item.category === 'court' && <ShieldAlert size={11} />}
                    {item.category === 'bank' && <Landmark size={11} />}
                    {item.category === 'treasury' && <Coins size={11} />}
                    <span>{item.category.toUpperCase()}</span>
                  </span>
                  <span className="gazette-timestamp">{item.timestamp}</span>
                </div>

                {/* Story Headline */}
                <h2 className="gazette-card-headline">{item.headline}</h2>

                {/* Narrative Body */}
                <p className="gazette-card-body">{item.body}</p>

                {/* Financial Callout if present */}
                {item.amount !== undefined && item.amount !== 0 && (
                  <div className="gazette-financial-box">
                    <span className="financial-label">CONSIDERATION / DUES</span>
                    <span
                      className={`financial-amount ${
                        item.category === 'rent' || item.category === 'tax' || item.stamp === 'WARRANT'
                          ? 'loss'
                          : 'gain'
                      }`}
                    >
                      {item.category === 'rent' || item.category === 'tax' ? '-' : '+'}
                      {formatINR(item.amount)}
                    </span>
                  </div>
                )}

                {/* Footer player dot & action notice */}
                <footer className="gazette-card-footer">
                  {item.playerName && (
                    <span className="gazette-player-indicator">
                      {item.playerColor && (
                        <i className="gazette-player-swatch" style={{ backgroundColor: item.playerColor }} />
                      )}
                      <span>{item.playerName}</span>
                    </span>
                  )}
                  {item.tileName && <span className="gazette-inspect-hint">Click to inspect deed</span>}
                </footer>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default ImperialGazette;
