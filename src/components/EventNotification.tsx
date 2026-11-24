import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  HelpCircle,
  Coins,
  Receipt,
  Scale,
  Building2,
  Lock,
  Crown,
  Coffee,
  Award,
  ArrowRight,
  CheckCircle2,
  X,
  ShieldCheck,
  Landmark,
  Scroll,
} from 'lucide-react';
import './EventNotification.css';
import { playBuySound, playRentSound, playJailSound } from '../utils/sound';

export type EventType = 'chance' | 'chest' | 'tax' | 'jail' | 'club' | 'rest' | 'start' | 'buy' | 'rent';

export interface EventCardData {
  type: EventType;
  title: string;
  subtitle?: string;
  amount?: number;
  from?: string;
  to?: string;
  color?: string;
  tileName?: string;
}

export interface EventCardModalProps {
  event: EventCardData | null;
  onClose: () => void;
}

export interface FloatingTransferItem {
  id: string | number;
  text: string;
  type: 'gain' | 'loss';
  x?: number;
  y?: number;
}

export interface FloatingTransferProps {
  transfers: FloatingTransferItem[];
}

function formatINR(val: number): string {
  return '₹' + Math.abs(val).toLocaleString('en-IN');
}

/**
 * EventCardModal
 * Authentic Victorian / Colonial Indian Deed & Vintage Parchment Certificate Aesthetics.
 * Double-line engraved borders, gold foil seals, Playfair Display typography,
 * distressed rubber stamps, and fine intaglio banknote detailing.
 */
export function EventCardModal({ event, onClose }: EventCardModalProps) {
  useEffect(() => {
    if (!event) return;

    // Play appropriate sound feedback safely
    try {
      if (event.type === 'buy') {
        playBuySound(true);
      } else if (event.type === 'rent') {
        playRentSound(true);
      } else if (event.type === 'jail') {
        playJailSound(true);
      } else if (event.type === 'start' || event.type === 'club' || (event.amount && event.amount > 0)) {
        playBuySound(true);
      }
    } catch {
      // Audio autoplay fallback
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [event, onClose]);

  if (!event) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const renderCardContent = () => {
    switch (event.type) {
      case 'chance':
      case 'chest': {
        const isChance = event.type === 'chance';
        return (
          <div className="chance-chest-card parchment-certificate" onClick={(e) => e.stopPropagation()}>
            {/* Engraved Double Border & Corner Ornaments */}
            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close card"
            >
              <X size={16} />
            </button>

            <div className="card-certificate-header">
              <div className="certificate-authority">GOVERNMENT OF INDIA • IMPERIAL GAZETTE</div>
              <div className="certificate-type-banner">
                {isChance ? 'ROYAL CHANCE DISPATCH' : 'IMPERIAL PROVIDENT CHEST'}
              </div>
            </div>

            {/* Wax / Gold Embossed Seal */}
            <div className="gold-embossed-seal">
              <div className="seal-coined-edge" />
              <div className="seal-center">
                {isChance ? <Sparkles size={28} /> : <Award size={28} />}
              </div>
            </div>

            {/* Main Card Decree */}
            <h3 className="parchment-main-title">{event.title}</h3>

            {event.subtitle && <p className="parchment-proclamation">{event.subtitle}</p>}

            {/* Intaglio Banknote Currency Box */}
            {event.amount !== undefined && event.amount !== 0 && (
              <div className="intaglio-financial-box">
                <span className="intaglio-label">
                  {event.amount > 0 ? 'TREASURY DISBURSEMENT' : 'STATUTORY LEVY'}
                </span>
                <span className={`intaglio-amount ${event.amount > 0 ? 'credit' : 'debit'}`}>
                  {event.amount > 0 ? '+' : '-'}
                  {formatINR(event.amount)}
                </span>
              </div>
            )}

            {(event.from || event.to) && (
              <div className="parchment-parties-notice">
                {event.from && <span>Disbursed by: {event.from}</span>}
                {event.from && event.to && <span className="dot-sep">•</span>}
                {event.to && <span>Payee: {event.to}</span>}
              </div>
            )}

            {/* Vintage Distressed Rubber Stamp */}
            <div className="vintage-rubber-stamp approved">
              {isChance ? 'SANCTIONED' : 'EXECUTED'}
            </div>

            <button type="button" className="regal-action-btn" onClick={onClose} autoFocus>
              <span>Acknowledge & Continue</span>
              <ArrowRight size={16} />
            </button>
          </div>
        );
      }

      case 'tax': {
        const amount = event.amount ?? 0;
        return (
          <div className="tax-invoice-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close invoice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="vintage-rubber-stamp red-tax-stamp">PAID & SETTLED</div>

            <div className="tax-invoice-header">
              <div className="certificate-authority">BOARD OF INLAND REVENUE & ASSESSMENTS</div>
              <h2 className="parchment-main-title">{event.title}</h2>
              <div className="tax-invoice-no">STATUTORY NOTICE NO. #TAX-{Math.abs(amount).toString().padStart(4, '0')}-IND</div>
            </div>

            <div className="tax-details-table">
              <div className="tax-details-row">
                <span className="tax-label">Assessment Subject</span>
                <span className="tax-value">{event.tileName || 'Real Estate & Wealth Capital'}</span>
              </div>
              <div className="tax-details-row">
                <span className="tax-label">Statutory Levy Rate</span>
                <span className="tax-value">
                  {event.subtitle || 'Standard municipal property tax assessment'}
                </span>
              </div>
              <div className="tax-details-row">
                <span className="tax-label">Beneficiary Account</span>
                <span className="tax-value">Municipal Tax Jackpot Pool</span>
              </div>
            </div>

            <div className="intaglio-financial-box">
              <span className="intaglio-label">TOTAL STATUTORY ASSESSMENT PAID</span>
              <span className="intaglio-amount debit">-{formatINR(amount)}</span>
            </div>

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <Receipt size={16} />
              <span>Collect Tax Quittance</span>
            </button>
          </div>
        );
      }

      case 'jail': {
        const isVisiting = event.title.toLowerCase().includes('visit');
        return (
          <div className="jail-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close court notice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className={`vintage-rubber-stamp ${isVisiting ? 'navy-stamp' : 'red-tax-stamp'}`}>
              {isVisiting ? 'VISITOR PASS' : 'REMAND ORDER'}
            </div>

            <div className="certificate-authority">
              {isVisiting ? 'DEPARTMENT OF CIVIL CORRECTIONS' : "HIGH COURT OF JUDICATURE • MAGISTRATE'S BENCH"}
            </div>

            <div className="jail-court-emblem">
              {isVisiting ? <ShieldCheck size={32} /> : <Lock size={32} />}
            </div>

            <h2 className="parchment-main-title">{event.title}</h2>

            <p className="parchment-proclamation">
              {event.subtitle ||
                (isVisiting
                  ? 'Safe passage granted. Authorized visitor permit active throughout the penitentiary.'
                  : 'By order of the Magistrate: Proceed directly to detention. Do not pass START, do not collect ₹1,500.')}
            </p>

            <div className="jail-conditions-box">
              {isVisiting ? (
                <div>• Safe transit passage permitted without detention or fine.</div>
              ) : (
                <>
                  <div>• Bail Option: Remit ₹500 standard court bail prior to roll.</div>
                  <div>• Doubles Rule: Throw doubles on any of the next 3 rounds for acquittal.</div>
                  <div>• Imperial Pardon: Present a "Get Out of Jail Free" card at any time.</div>
                </>
              )}
            </div>

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <span>{isVisiting ? 'Proceed on Transit' : 'Comply with Order'}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        );
      }

      case 'club': {
        return (
          <div className="club-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close club notice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="vintage-rubber-stamp gold-stamp">HONORARY</div>

            <div className="certificate-authority">THE ROYAL IMPERIAL CLUB • GOVERNOR GENERAL'S LODGE</div>

            <div className="gold-embossed-seal">
              <div className="seal-coined-edge" />
              <div className="seal-center">
                <Crown size={28} />
              </div>
            </div>

            <h2 className="parchment-main-title">{event.title || 'The Royal Imperial Club'}</h2>

            <p className="parchment-proclamation">
              {event.subtitle ||
                'Welcome to the sovereign members sanctuary. Honorary hospitality dividend collected from all table participants.'}
            </p>

            {event.amount !== undefined && event.amount !== 0 && (
              <div className="intaglio-financial-box">
                <span className="intaglio-label">CLUB DIVIDEND ALLOCATION</span>
                <span className="intaglio-amount credit">+{formatINR(event.amount)}</span>
              </div>
            )}

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <Sparkles size={16} />
              <span>Accept Hospitality</span>
            </button>
          </div>
        );
      }

      case 'rest': {
        const hasJackpot = event.amount !== undefined && event.amount > 0;
        return (
          <div className="rest-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close rest notice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="vintage-rubber-stamp approved">
              {hasJackpot ? 'JACKPOT' : 'SANCTUARY'}
            </div>

            <div className="certificate-authority">DAK BUNGALOW TRAVELERS' HAVEN • GRAND TRUNK HIGHWAY</div>

            <div className="gold-embossed-seal">
              <div className="seal-coined-edge" />
              <div className="seal-center">
                <Coffee size={28} />
              </div>
            </div>

            <h2 className="parchment-main-title">{event.title || 'Dak Bungalow Rest House'}</h2>

            <p className="parchment-proclamation">
              {event.subtitle ||
                'A tranquil roadside sanctuary safe from tenancy demands. Savor refreshment along your journey.'}
            </p>

            {hasJackpot && (
              <div className="intaglio-financial-box">
                <span className="intaglio-label">MUNICIPAL ACCUMULATED JACKPOT</span>
                <span className="intaglio-amount credit">+{formatINR(event.amount!)}</span>
              </div>
            )}

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <span>{hasJackpot ? 'Claim Jackpot & Proceed' : 'Resume Journey'}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        );
      }

      case 'start': {
        const salary = event.amount ?? 1500;
        return (
          <div className="start-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close START notice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="vintage-rubber-stamp approved">DISBURSED</div>

            <div className="certificate-authority">IMPERIAL TREASURY OF INDIA • CIRCUIT CLEARANCE</div>

            <div className="gold-embossed-seal">
              <div className="seal-coined-edge" />
              <div className="seal-center">
                <Landmark size={28} />
              </div>
            </div>

            <h2 className="parchment-main-title">{event.title || 'Circuit Completed at START'}</h2>

            <p className="parchment-proclamation">
              {event.subtitle ||
                'Full commercial circuit of India successfully completed. Sovereign salary approved by the Imperial Treasury.'}
            </p>

            <div className="intaglio-financial-box">
              <span className="intaglio-label">SOVEREIGN CIRCUIT SALARY</span>
              <span className="intaglio-amount credit">+{formatINR(salary)}</span>
            </div>

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <CheckCircle2 size={16} />
              <span>Collect Stipend & Advance</span>
            </button>
          </div>
        );
      }

      case 'buy': {
        const headerColor = event.color || '#1d3326';
        return (
          <div className="buy-deed-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close deed"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="buy-deed-header" style={{ backgroundColor: headerColor }}>
              <div className="buy-deed-pretitle">IMPERIAL INDENTURE OF CONVEYANCE</div>
              <h2 className="buy-deed-title">{event.tileName || event.title}</h2>
            </div>

            <div className="buy-deed-body">
              <div className="vintage-rubber-stamp green-stamp">REGISTERED</div>

              <div className="gold-embossed-seal">
                <div className="seal-coined-edge" />
                <div className="seal-center">
                  <Building2 size={28} />
                </div>
              </div>

              <p className="parchment-proclamation">
                {event.subtitle ||
                  'Be it known by all presents: the absolute title and municipal deed to this prime property is officially registered in your portfolio.'}
              </p>

              {event.amount !== undefined && (
                <div className="intaglio-financial-box">
                  <span className="intaglio-label">TREASURY CONSIDERATION REMITTED</span>
                  <span className="intaglio-amount debit">-{formatINR(event.amount)}</span>
                </div>
              )}

              <button type="button" className="regal-action-btn" onClick={onClose}>
                <CheckCircle2 size={16} />
                <span>Affix Seal & Enroll Deed</span>
              </button>
            </div>
          </div>
        );
      }

      case 'rent': {
        const amount = event.amount ?? 0;
        return (
          <div className="rent-card parchment-certificate">
            <button
              type="button"
              className="modal-corner-close-btn"
              onClick={onClose}
              aria-label="Close rent notice"
            >
              <X size={16} />
            </button>

            <div className="parchment-border-frame" />
            <div className="parchment-corner top-left">❖</div>
            <div className="parchment-corner top-right">❖</div>
            <div className="parchment-corner bottom-left">❖</div>
            <div className="parchment-corner bottom-right">❖</div>

            <div className="vintage-rubber-stamp navy-stamp">DISCHARGED</div>

            <div className="certificate-authority">LANDLORD TENANCY TRIBUNAL • QUITTANCE VOUCHER</div>

            <div className="gold-embossed-seal">
              <div className="seal-coined-edge" />
              <div className="seal-center">
                <Receipt size={28} />
              </div>
            </div>

            <h2 className="parchment-main-title">{event.title || 'Tenancy Dues Quittance'}</h2>

            <div className="rent-flow-box">
              <span className="rent-flow-party">{event.from || 'Tenant'}</span>
              <span className="rent-flow-arrow">
                <ArrowRight size={16} />
              </span>
              <span className="rent-flow-party">{event.to || 'Landlord'}</span>
            </div>

            {event.tileName && (
              <p className="parchment-proclamation">
                Lodging and tenancy dues on <strong>{event.tileName}</strong>
              </p>
            )}

            {event.subtitle && <p className="parchment-proclamation">{event.subtitle}</p>}

            <div className="intaglio-financial-box">
              <span className="intaglio-label">TENANCY RENT CONSIDERATION</span>
              <span className="intaglio-amount debit">-{formatINR(amount)}</span>
            </div>

            <button type="button" className="regal-action-btn" onClick={onClose}>
              <CheckCircle2 size={16} />
              <span>File Quittance & Advance</span>
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="event-modal-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true">
      <div className="event-modal-container">{renderCardContent()}</div>
    </div>
  );
}

/**
 * FloatingTransfer
 * Renders elegant vintage banknote certificates that float up and fade out for real-time payment feedback.
 */
export function FloatingTransfer({ transfers }: FloatingTransferProps) {
  if (!transfers || transfers.length === 0) return null;

  return (
    <div className="floating-transfers-host" aria-live="polite">
      {transfers.map((item, index) => {
        const isGain = item.type === 'gain';
        const style: React.CSSProperties = {
          left: item.x !== undefined ? `${item.x}px` : '50%',
          top: item.y !== undefined ? `${item.y}px` : `calc(38% + ${index * 44}px)`,
        };

        return (
          <div
            key={item.id}
            className={`floating-transfer-chip ${isGain ? 'gain' : 'loss'}`}
            style={style}
          >
            <span className="floating-chip-seal">❖</span>
            <span className="floating-chip-text">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export { ImperialGazette } from './ImperialGazette';
export type { GazetteDispatch, GazetteCategory, ImperialGazetteProps } from './ImperialGazette';

export default EventCardModal;
