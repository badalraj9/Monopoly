import React, { useEffect, useMemo, useCallback } from 'react';
import {
  Landmark,
  X,
  ShieldCheck,
  AlertCircle,
  TrendingUp,
  Banknote,
  Coins,
  Sparkles,
  Clock,
  ArrowRight,
  Percent,
  CheckCircle2,
  Info
} from 'lucide-react';
import {
  LOAN_TIERS,
  type LoanTier,
  formatINR,
  calculateCreditAssessment,
  getBankLoanState,
  calculateEarlyPayoff,
  checkLoanEligibility
} from '../utils/bank';
import './BankModal.css';

export interface BankModalProps {
  isOpen: boolean;
  player: any;
  netWorth: number;
  onBorrow: (tier: LoanTier | any) => void;
  onRepayEarly: (amount: number) => void;
  onClose: () => void;
}

export const BankModal: React.FC<BankModalProps> = React.memo(function BankModal({
  isOpen,
  player,
  netWorth,
  onBorrow,
  onRepayEarly,
  onClose
}) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const assessment = useMemo(() => {
    return calculateCreditAssessment(player, netWorth);
  }, [player, netWorth]);

  const loanState = useMemo(() => {
    return getBankLoanState(player);
  }, [player]);

  const earlyPayoff = useMemo(() => {
    return calculateEarlyPayoff(player);
  }, [player]);

  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleRepayEarly = useCallback(() => {
    onRepayEarly(earlyPayoff.payoffAmount);
  }, [onRepayEarly, earlyPayoff.payoffAmount]);

  if (!isOpen || !player) return null;

  const playerCash = player.cash || 0;
  const ratingBadgeClass = `rating-${assessment.rating.toLowerCase()}`;

  return (
    <div className="bank-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="bank-dialog-title">
      <div className="bank-dialog" onClick={handleDialogClick}>
        {/* Editorial Header */}
        <header className="bank-header">
          <div className="bank-crest-area">
            <div className="bank-crest">
              <Landmark size={24} strokeWidth={1.75} />
            </div>
            <div className="bank-titles">
              <div className="bank-eyebrow">CHARTERED EST. 1875 · CENTRAL RESERVE FACILITY</div>
              <h2 id="bank-dialog-title" className="bank-title">Imperial Reserve Bank</h2>
              <p className="bank-subtitle">
                Official Treasury & Sovereign Lending Desk for {player.name}
              </p>
            </div>
          </div>
          <button
            className="bank-close-btn"
            onClick={onClose}
            aria-label="Close Bank dialog"
            title="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="bank-body">
          {/* Credit Assessment & Capacity Summary */}
          <section className="bank-section credit-dossier-card">
            <div className="credit-top-row">
              <div className="credit-badge-wrap">
                <span className={`credit-rating-badge ${ratingBadgeClass}`}>
                  <ShieldCheck size={14} />
                  <span>RATING {assessment.rating}</span>
                </span>
                <span className="credit-standing-label">{assessment.tierLabel}</span>
              </div>
              <div className="credit-score-stat">
                <span className="stat-label">CREDIT SCORE</span>
                <span className="stat-score-value">
                  <b>{assessment.score}</b> / 850
                </span>
              </div>
            </div>

            {/* Score visual meter bar */}
            <div className="credit-meter" aria-hidden="true">
              <div
                className={`credit-meter-fill ${ratingBadgeClass}`}
                style={{ width: `${Math.round(((assessment.score - 300) / (850 - 300)) * 100)}%` }}
              />
            </div>

            <p className="credit-summary-text">{assessment.summary}</p>

            {/* Key Financial Ledger */}
            <div className="bank-ledger-grid">
              <div className="ledger-cell highlight">
                <span className="ledger-label">
                  <TrendingUp size={12} />
                  MAX BORROWING CAPACITY
                </span>
                <span className="ledger-value capacity-value">{formatINR(assessment.borrowingCapacity)}</span>
                <span className="ledger-caption">Based on unmortgaged deeds & cash</span>
              </div>

              <div className="ledger-cell">
                <span className="ledger-label">
                  <Coins size={12} />
                  LIQUID CASH ON HAND
                </span>
                <span className="ledger-value">{formatINR(playerCash)}</span>
                <span className="ledger-caption">Immediately available</span>
              </div>

              <div className="ledger-cell">
                <span className="ledger-label">
                  <Banknote size={12} />
                  UNMORTGAGED COLLATERAL
                </span>
                <span className="ledger-value">{formatINR(assessment.unmortgagedAssetValue)}</span>
                <span className="ledger-caption">60% Loan-to-Value support</span>
              </div>

              <div className="ledger-cell">
                <span className="ledger-label">
                  <Landmark size={12} />
                  TOTAL NET WORTH
                </span>
                <span className="ledger-value">{formatINR(netWorth)}</span>
                <span className="ledger-caption">Full portfolio equity</span>
              </div>
            </div>
          </section>

          {/* Active Loan Commitment (if player has an active loan) */}
          {loanState.hasLoan && (
            <section className="bank-section active-loan-card">
              <div className="active-loan-header">
                <div className="active-loan-title-group">
                  <span className="active-loan-tag">
                    <Clock size={12} />
                    ACTIVE CREDIT FACILITY
                  </span>
                  <h3>{loanState.tierName}</h3>
                </div>
                <div className="active-loan-amount-badge">
                  <span>OUTSTANDING DUE</span>
                  <b>{formatINR(loanState.totalScheduledRemaining)}</b>
                </div>
              </div>

              <div className="active-loan-details">
                <div className="active-loan-schedule">
                  <div className="schedule-item">
                    <span>Installment per Lap:</span>
                    <b>{formatINR(loanState.installmentPerLap)}</b>
                  </div>
                  <div className="schedule-item">
                    <span>Remaining Laps:</span>
                    <b>
                      {loanState.remainingLaps} of {loanState.totalLaps} laps
                    </b>
                  </div>
                  <div className="schedule-item">
                    <span>Next Due:</span>
                    <b>Upon passing START</b>
                  </div>
                </div>

                {/* Progress bar of laps paid */}
                <div className="loan-lap-progress">
                  <div className="progress-labels">
                    <span>Repayment Progress</span>
                    <span>
                      {loanState.lapsPaid} / {loanState.totalLaps} laps settled
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${Math.round((loanState.lapsPaid / loanState.totalLaps) * 100)}%`
                      }}
                    />
                  </div>
                </div>

                {/* Early Payoff Discount Box */}
                <div className="early-payoff-box">
                  <div className="early-payoff-info">
                    <div className="payoff-badge">
                      <Sparkles size={13} />
                      <span>EARLY SETTLEMENT PRIVILEGE</span>
                    </div>
                    <h4>Settle Early & Save Interest</h4>
                    <p>
                      Repaying in full now waives all remaining interest charges! Pay only the outstanding
                      principal balance of <strong>{formatINR(earlyPayoff.payoffAmount)}</strong> and save{' '}
                      <span className="savings-highlight">{formatINR(earlyPayoff.savings)}</span>.
                    </p>
                  </div>

                  <div className="early-payoff-action">
                    <button
                      className="primary early-payoff-btn"
                      disabled={!earlyPayoff.canAfford}
                      onClick={handleRepayEarly}
                    >
                      <Sparkles size={14} />
                      Repay Early for {formatINR(earlyPayoff.payoffAmount)}
                    </button>
                    {!earlyPayoff.canAfford && (
                      <span className="insufficient-cash-warning">
                        <AlertCircle size={11} />
                        Requires {formatINR(earlyPayoff.payoffAmount)} (Short by{' '}
                        {formatINR(earlyPayoff.payoffAmount - playerCash)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Tiered Loan Offerings */}
          <section className="bank-section loan-offerings-section">
            <div className="section-title-row">
              <div>
                <span className="section-eyebrow">CENTRAL DESK LIQUIDITY</span>
                <h3 className="section-heading">Available Lending Facilities</h3>
              </div>
              <span className="section-meta-note">
                Deductions processed automatically upon crossing START
              </span>
            </div>

            <div className="loan-tiers-grid">
              {LOAN_TIERS.map((tier) => {
                const eligibility = checkLoanEligibility(tier, player, assessment);
                const isSelectedForActive =
                  loanState.hasLoan &&
                  (loanState.tierId === tier.id ||
                    (tier.id === 'syndicate' && loanState.tierId === 'legacy'));

                return (
                  <article
                    key={tier.id}
                    className={`loan-tier-card ${tier.id} ${
                      !eligibility.eligible ? 'tier-locked' : 'tier-eligible'
                    } ${isSelectedForActive ? 'tier-active' : ''}`}
                  >
                    <div className="tier-header">
                      <div className="tier-badge-line">
                        <span className="tier-badge">{tier.badge}</span>
                        <span className="tier-apr-pill">
                          <Percent size={10} />
                          {tier.apr}% APR
                        </span>
                      </div>
                      <h4 className="tier-name">{tier.name}</h4>
                      <p className="tier-tagline">{tier.tagline}</p>
                    </div>

                    <div className="tier-amount-block">
                      <span className="tier-principal-label">PRINCIPAL DRAW</span>
                      <span className="tier-principal">{formatINR(tier.principal)}</span>
                    </div>

                    <div className="tier-terms-table">
                      <div className="term-row">
                        <span>Installment:</span>
                        <b>{formatINR(tier.installmentPerLap)} / lap</b>
                      </div>
                      <div className="term-row">
                        <span>Term Duration:</span>
                        <b>{tier.totalLaps} laps</b>
                      </div>
                      <div className="term-row">
                        <span>Total Repayment:</span>
                        <b>{formatINR(tier.totalRepayment)}</b>
                      </div>
                      <div className="term-row interest-row">
                        <span>Total Interest:</span>
                        <span className="interest-amt">+{formatINR(tier.totalInterest)}</span>
                      </div>
                    </div>

                    <div className="tier-use-tip">
                      <Info size={11} />
                      <span>{tier.recommendedUse}</span>
                    </div>

                    <div className="tier-action-footer">
                      {isSelectedForActive ? (
                        <div className="tier-active-status">
                          <CheckCircle2 size={13} />
                          <span>Currently Active Facility</span>
                        </div>
                      ) : (
                        <>
                          <button
                            className="primary draw-loan-btn"
                            disabled={!eligibility.eligible}
                            onClick={() => onBorrow(tier)}
                          >
                            <span>Draw {formatINR(tier.principal)}</span>
                            <ArrowRight size={13} />
                          </button>
                          {!eligibility.eligible && eligibility.reason && (
                            <span className="tier-ineligible-reason">
                              {eligibility.reason}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Central Bank Charter & Regulations */}
          <footer className="bank-regulatory-strip">
            <div className="regulatory-text">
              <ShieldCheck size={14} className="reg-icon" />
              <div>
                <strong>Imperial Reserve Lending Charter & Regulations:</strong>
                <span>
                  {' '}
                  All facilities are secured under sovereign banking authority. Installment deductions
                  are executed automatically upon crossing the START space. Early repayment incurs zero
                  prepayment penalties and extinguishes all future unaccrued interest obligations.
                </span>
              </div>
            </div>
          </footer>
        </div>

        {/* Modal Bottom Actions */}
        <footer className="bank-modal-actions">
          <span className="bank-footnote">
            BANKING PROTOCOL SECURED · 0% EARLY PREPAYMENT PENALTY
          </span>
          <button className="secondary bank-done-btn" onClick={onClose}>
            Back to Game Table
          </button>
        </footer>
      </div>
    </div>
  );
});

export default BankModal;
