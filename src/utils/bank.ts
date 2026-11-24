import { board, type Tile } from '../data/board';

export type CreditRating = 'AAA' | 'A' | 'BBB' | 'Subprime';

export type LoanTierId = 'micro' | 'commercial' | 'syndicate';

export interface LoanTier {
  id: LoanTierId;
  name: string;
  badge: string;
  principal: number;
  installmentPerLap: number;
  totalLaps: number;
  totalRepayment: number;
  totalInterest: number;
  interestPerLap: number;
  apr: number;
  minCreditRating: CreditRating;
  minCapacity: number;
  tagline: string;
  description: string;
  recommendedUse: string;
}

export interface BankLoanState {
  hasLoan: boolean;
  tierId?: LoanTierId | 'legacy';
  tierName: string;
  principal: number;
  installmentPerLap: number;
  lapsPaid: number;
  totalLaps: number;
  remainingLaps: number;
  interestPerLap: number;
  totalScheduledRemaining: number;
  earlyPayoffAmount: number;
  earlyPayoffSavings: number;
}

export interface CreditAssessment {
  score: number;
  rating: CreditRating;
  tierLabel: string;
  summary: string;
  borrowingCapacity: number;
  unmortgagedAssetValue: number;
  buildingImprovementValue: number;
  liquidCash: number;
  factors: { text: string; positive: boolean }[];
}

/**
 * Standard Tiered Loan Offerings:
 * - Micro: ₹2,000 (₹500/lap for 5 laps = ₹2,500 total, 25% APR)
 * - Commercial: ₹5,000 (₹1,200/lap for 5 laps = ₹6,000 total, 20% APR)
 * - Syndicate: ₹10,000 (₹2,300/lap for 5 laps = ₹11,500 total, 15% APR)
 */
export const LOAN_TIERS: LoanTier[] = [
  {
    id: 'micro',
    name: 'Micro Loan',
    badge: 'Quick Capital',
    principal: 2000,
    installmentPerLap: 500,
    totalLaps: 5,
    totalRepayment: 2500,
    totalInterest: 500,
    interestPerLap: 100,
    apr: 25,
    minCreditRating: 'Subprime',
    minCapacity: 2000,
    tagline: 'Emergency liquidity & swift bail resolution',
    description: '₹500 / lap over 5 laps (Total ₹2,500 at 25% APR)',
    recommendedUse: 'Avoid bankruptcy, clear bail, or unmortgage essential properties'
  },
  {
    id: 'commercial',
    name: 'Commercial Loan',
    badge: 'Development Facility',
    principal: 5000,
    installmentPerLap: 1200,
    totalLaps: 5,
    totalRepayment: 6000,
    totalInterest: 1000,
    interestPerLap: 200,
    apr: 20,
    minCreditRating: 'BBB',
    minCapacity: 5000,
    tagline: 'Real estate acquisition & medium-scale development',
    description: '₹1,200 / lap over 5 laps (Total ₹6,000 at 20% APR)',
    recommendedUse: 'Acquire unowned cities or construct multi-house developments'
  },
  {
    id: 'syndicate',
    name: 'Syndicate Loan',
    badge: 'Imperial Sovereign',
    principal: 10000,
    installmentPerLap: 2300,
    totalLaps: 5,
    totalRepayment: 11500,
    totalInterest: 1500,
    interestPerLap: 300,
    apr: 15,
    minCreditRating: 'A',
    minCapacity: 10000,
    tagline: 'Institutional leverage for complete market domination',
    description: '₹2,300 / lap over 5 laps (Total ₹11,500 at 15% APR)',
    recommendedUse: 'Rapid hotel upgrades across full color sets to trigger knockout rents'
  }
];

export const LOAN_TIER_MAP: Record<LoanTierId, LoanTier> = {
  micro: LOAN_TIERS[0],
  commercial: LOAN_TIERS[1],
  syndicate: LOAN_TIERS[2]
};

/**
 * Format currency in Indian Rupees style (e.g. ₹10,000)
 */
export function formatINR(amount: number): string {
  return `₹${Math.max(0, Math.round(amount)).toLocaleString('en-IN')}`;
}

/**
 * Get total deed value of player's unmortgaged properties
 */
export function getUnmortgagedPropertyValue(player: any): number {
  if (!player || !Array.isArray(player.owned)) return 0;
  const mortgaged: number[] = Array.isArray(player.mortgaged) ? player.mortgaged : [];
  return player.owned.reduce((sum: number, tileId: number) => {
    if (mortgaged.includes(tileId)) return sum;
    const tile = board[tileId];
    return sum + (tile?.price || 0);
  }, 0);
}

/**
 * Get total estimated investment value in buildings (houses/hotels)
 */
export function getBuildingValue(player: any): number {
  if (!player || !player.buildings || !Array.isArray(player.owned)) return 0;
  return player.owned.reduce((sum: number, tileId: number) => {
    const tile = board[tileId];
    if (!tile?.set) return sum;
    const count = player.buildings[tileId] || 0;
    if (count <= 0) return sum;
    const cost =
      tile.set === 'Brown' || tile.set === 'Sapphire'
        ? 500
        : tile.set === 'Rose' || tile.set === 'Saffron'
        ? 1000
        : tile.set === 'Ruby' || tile.set === 'Gold'
        ? 1500
        : 2000;
    return sum + count * cost;
  }, 0);
}

/**
 * Calculate realistic borrowing capacity:
 * Based on unmortgaged properties (60% LTV), building investments (50%),
 * and cash reserves (40%), with baseline safety limit.
 */
export function calculateBorrowingCapacity(player: any): number {
  if (!player) return 0;
  const unmortgagedVal = getUnmortgagedPropertyValue(player);
  const buildingVal = getBuildingValue(player);
  const cash = Math.max(0, player.cash || 0);

  // Unmortgaged real estate allows up to 60% loan-to-value collateralization
  const propertyCollateral = unmortgagedVal * 0.6;
  // Building equity provides 50% collateral support
  const improvementEquity = buildingVal * 0.5;
  // Cash reserves provide 40% liquidity support
  const cashSupport = cash * 0.4;
  // Baseline floor for solvent players in good standing
  const baselineAllowance = player.active && (!player.jail || player.jail === 0) ? 2000 : 500;

  let totalCapacity = Math.round(propertyCollateral + improvementEquity + cashSupport + baselineAllowance);

  // If player already has an active loan, deduct outstanding principal from remaining capacity
  if (player.loan) {
    const loanState = getBankLoanState(player);
    totalCapacity = Math.max(0, totalCapacity - loanState.earlyPayoffAmount);
  }

  // Legal encumbrance penalty if currently incarcerated
  if (player.jail && player.jail > 0) {
    totalCapacity = Math.round(totalCapacity * 0.5);
  }

  // Round down to neat hundreds
  return Math.floor(Math.max(0, totalCapacity) / 100) * 100;
}

/**
 * Assess player credit score (300 - 850 range) and rating:
 * AAA, A, BBB, Subprime
 */
export function calculateCreditAssessment(player: any, netWorth?: number): CreditAssessment {
  if (!player) {
    return {
      score: 300,
      rating: 'Subprime',
      tierLabel: 'High Risk',
      summary: 'No active profile available.',
      borrowingCapacity: 0,
      unmortgagedAssetValue: 0,
      buildingImprovementValue: 0,
      liquidCash: 0,
      factors: []
    };
  }

  const unmortgagedVal = getUnmortgagedPropertyValue(player);
  const buildingVal = getBuildingValue(player);
  const cash = player.cash || 0;
  const ownedCount = Array.isArray(player.owned) ? player.owned.length : 0;
  const mortgagedCount = Array.isArray(player.mortgaged) ? player.mortgaged.length : 0;
  const capacity = calculateBorrowingCapacity(player);

  let score = 560; // Neutral baseline
  const factors: { text: string; positive: boolean }[] = [];

  // Liquidity Assessment
  if (cash >= 10000) {
    score += 110;
    factors.push({ text: 'Substantial cash reserves (₹10,000+)', positive: true });
  } else if (cash >= 4000) {
    score += 65;
    factors.push({ text: 'Healthy liquid working capital', positive: true });
  } else if (cash >= 1500) {
    score += 25;
    factors.push({ text: 'Sufficient cash for day-to-day operations', positive: true });
  } else if (cash < 500) {
    score -= 80;
    factors.push({ text: 'Critically depressed cash balance (< ₹500)', positive: false });
  }

  // Real Estate Collateral
  if (unmortgagedVal >= 12000) {
    score += 120;
    factors.push({ text: 'Extensive prime real estate portfolio (₹12,000+ unencumbered)', positive: true });
  } else if (unmortgagedVal >= 5000) {
    score += 75;
    factors.push({ text: 'Solid asset portfolio backing', positive: true });
  } else if (unmortgagedVal >= 1500) {
    score += 35;
    factors.push({ text: 'Unmortgaged property collateral on hand', positive: true });
  } else if (ownedCount === 0) {
    score -= 30;
    factors.push({ text: 'No property deeds owned', positive: false });
  }

  // Improvements & Monopolies
  if (buildingVal >= 4000) {
    score += 55;
    factors.push({ text: 'Substantial property developments & revenue generation', positive: true });
  } else if (buildingVal > 0) {
    score += 25;
    factors.push({ text: 'Developed property improvements', positive: true });
  }

  // Mortgages / Distress
  if (mortgagedCount > 0) {
    const penalty = Math.min(120, mortgagedCount * 35);
    score -= penalty;
    factors.push({ text: `${mortgagedCount} encumbered / mortgaged title deeds`, positive: false });
  }

  // Legal / Incarceration
  if (player.jail && player.jail > 0) {
    score -= 140;
    factors.push({ text: 'Currently detained in Jail (judicial sanction)', positive: false });
  }

  // Existing debt
  if (player.loan) {
    score -= 60;
    factors.push({ text: 'Active institutional loan commitment outstanding', positive: false });
  }

  // Lap track record
  const laps = player.lapsCompleted || 0;
  if (laps >= 5) {
    score += 35;
    factors.push({ text: 'Long-standing board presence & track record', positive: true });
  }

  // Clamp score to standard FICO/CIBIL bounds
  score = Math.min(850, Math.max(300, Math.round(score)));

  let rating: CreditRating;
  let tierLabel: string;
  let summary: string;

  if (score >= 760) {
    rating = 'AAA';
    tierLabel = 'Prime Sovereign';
    summary = 'Flawless credit profile. Unrestricted access to all institutional facilities at prime rates.';
  } else if (score >= 660) {
    rating = 'A';
    tierLabel = 'Investment Grade';
    summary = 'Strong credit standing with robust asset coverage and solid liquidity.';
  } else if (score >= 520) {
    rating = 'BBB';
    tierLabel = 'Commercial Grade';
    summary = 'Standard commercial risk. Eligible for micro and commercial facilities.';
  } else {
    rating = 'Subprime';
    tierLabel = 'Speculative / High Risk';
    summary = 'Elevated default probability. Restricted to collateralized micro facilities.';
  }

  return {
    score,
    rating,
    tierLabel,
    summary,
    borrowingCapacity: capacity,
    unmortgagedAssetValue: unmortgagedVal,
    buildingImprovementValue: buildingVal,
    liquidCash: cash,
    factors
  };
}

/**
 * Determine the active loan state for a player, including early payoff discount calculations.
 * Early payoff saves remaining future interest!
 */
export function getBankLoanState(player: any): BankLoanState {
  if (!player || !player.loan) {
    return {
      hasLoan: false,
      tierName: 'None',
      principal: 0,
      installmentPerLap: 0,
      lapsPaid: 0,
      totalLaps: 0,
      remainingLaps: 0,
      interestPerLap: 0,
      totalScheduledRemaining: 0,
      earlyPayoffAmount: 0,
      earlyPayoffSavings: 0
    };
  }

  const rawTierId = player.loanTier as LoanTierId | undefined;
  const knownTier = rawTierId && LOAN_TIER_MAP[rawTierId] ? LOAN_TIER_MAP[rawTierId] : null;

  let principal: number;
  let installmentPerLap: number;
  let totalLaps: number;
  let totalRepayment: number;
  let tierName: string;
  let tierId: LoanTierId | 'legacy';

  if (knownTier) {
    tierId = knownTier.id;
    tierName = knownTier.name;
    principal = knownTier.principal;
    installmentPerLap = knownTier.installmentPerLap;
    totalLaps = knownTier.totalLaps;
    totalRepayment = knownTier.totalRepayment;
  } else {
    // Legacy loan default (from App.tsx: ₹10,000 loan, ₹2,000/lap for 6 laps = ₹12,000 total)
    tierId = 'legacy';
    tierName = 'Imperial Reserve Facility';
    principal = 10000;
    installmentPerLap = 2000;
    totalLaps = 6;
    totalRepayment = 12000;
  }

  const lapsPaid = Math.min(totalLaps, Math.max(0, player.loanLaps || 0));
  const remainingLaps = Math.max(0, totalLaps - lapsPaid);
  const totalInterest = totalRepayment - principal;
  const interestPerLap = totalLaps > 0 ? totalInterest / totalLaps : 0;
  const principalPerLap = totalLaps > 0 ? principal / totalLaps : 0;

  // Early payoff saves all remaining unaccrued interest!
  // The player only pays the remaining principal balance.
  const earlyPayoffAmount = Math.round(remainingLaps * principalPerLap);
  const totalScheduledRemaining = remainingLaps * installmentPerLap;
  const earlyPayoffSavings = Math.max(0, totalScheduledRemaining - earlyPayoffAmount);

  return {
    hasLoan: true,
    tierId,
    tierName,
    principal,
    installmentPerLap,
    lapsPaid,
    totalLaps,
    remainingLaps,
    interestPerLap,
    totalScheduledRemaining,
    earlyPayoffAmount,
    earlyPayoffSavings
  };
}

/**
 * Early payoff calculations helper:
 * Returns the exact payoff cost and interest saved.
 */
export function calculateEarlyPayoff(playerOrLoan: any): {
  payoffAmount: number;
  savings: number;
  remainingLaps: number;
  scheduledRemaining: number;
  canAfford: boolean;
} {
  const state =
    playerOrLoan && typeof playerOrLoan.earlyPayoffAmount === 'number'
      ? (playerOrLoan as BankLoanState)
      : getBankLoanState(playerOrLoan);

  const cash = playerOrLoan?.cash || 0;
  return {
    payoffAmount: state.earlyPayoffAmount,
    savings: state.earlyPayoffSavings,
    remainingLaps: state.remainingLaps,
    scheduledRemaining: state.totalScheduledRemaining,
    canAfford: cash >= state.earlyPayoffAmount
  };
}

/**
 * Check if a player is eligible to borrow a specific tier
 */
export function checkLoanEligibility(
  tier: LoanTier,
  player: any,
  assessment: CreditAssessment
): { eligible: boolean; reason?: string } {
  if (!player) return { eligible: false, reason: 'No player selected' };
  if (player.loan) return { eligible: false, reason: 'Active loan must be settled before drawing new facilities' };
  if (assessment.borrowingCapacity < tier.principal) {
    return {
      eligible: false,
      reason: `Borrowing capacity insufficient (${formatINR(assessment.borrowingCapacity)} / ${formatINR(tier.principal)})`
    };
  }

  // Credit rating restrictions
  const ratingHierarchy: Record<CreditRating, number> = {
    Subprime: 0,
    BBB: 1,
    A: 2,
    AAA: 3
  };

  if (ratingHierarchy[assessment.rating] < ratingHierarchy[tier.minCreditRating]) {
    return {
      eligible: false,
      reason: `Requires minimum ${tier.minCreditRating} credit rating (Current: ${assessment.rating})`
    };
  }

  return { eligible: true };
}
