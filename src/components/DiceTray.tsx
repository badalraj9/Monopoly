import { memo, useEffect, useState } from 'react';
import './DiceTray.css';

const pipMap: Record<number, [number, number][]> = {
  1: [[18, 18]],
  2: [[9, 9], [27, 27]],
  3: [[9, 9], [18, 18], [27, 27]],
  4: [[9, 9], [27, 9], [9, 27], [27, 27]],
  5: [[9, 9], [27, 9], [18, 18], [9, 27], [27, 27]],
  6: [[9, 8], [27, 8], [9, 18], [27, 18], [9, 28], [27, 28]],
};

const Face = memo(function Face({ value }: { value: number }) {
  const pips = pipMap[value] || pipMap[1];
  return (
    <svg viewBox="0 0 36 36" aria-label={`${value} pips`} role="img">
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.2" fill={value === 1 ? '#9E2A2B' : '#181715'} />
      ))}
    </svg>
  );
});

type RollPhase = 'idle' | 'tumbling' | 'settling' | 'settled';

function DiceTray({
  dice,
  rolling,
  speed = 1,
  consecutiveDoubles = 0,
}: {
  dice: [number, number];
  rolling: boolean;
  speed?: 1 | 2;
  consecutiveDoubles?: number;
}) {
  const [visual, setVisual] = useState<[number, number]>(dice);
  const [rollPhase, setRollPhase] = useState<RollPhase>('idle');

  useEffect(() => {
    if (!rolling) {
      setVisual(dice);
      setRollPhase('idle');
      return;
    }

    setRollPhase('tumbling');

    const tumbleDuration = Math.round(360 / speed);
    const settleDuration = Math.round(440 / speed);
    const update1 = Math.round(120 / speed);
    const update2 = Math.round(240 / speed);

    let step = 0;
    let rafId: number | undefined;
    let settleTimerId: number | undefined;
    let idleTimerId: number | undefined;

    const startTime = performance.now();

    const frame = (now: number) => {
      const elapsed = now - startTime;

      if (elapsed < tumbleDuration) {
        // Reduced from 6 unthrottled timeouts to 2 rAF-synced visual pip updates
        if (step === 0 && elapsed >= update1) {
          step = 1;
          setVisual([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
        } else if (step === 1 && elapsed >= update2) {
          step = 2;
          setVisual([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
        }
        rafId = requestAnimationFrame(frame);
      } else {
        // Tumble finished: land on actual dice values and enter settling phase
        setVisual(dice);
        setRollPhase('settling');

        // Allow CSS settling animation (440ms / speed) to fully complete before switching to settled
        settleTimerId = window.setTimeout(() => {
          setRollPhase('settled');

          idleTimerId = window.setTimeout(() => {
            setRollPhase('idle');
          }, Math.round(300 / speed));
        }, settleDuration);
      }
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
      }
      if (settleTimerId !== undefined) {
        clearTimeout(settleTimerId);
      }
      if (idleTimerId !== undefined) {
        clearTimeout(idleTimerId);
      }
    };
  }, [rolling, dice[0], dice[1], speed]);

  const state = consecutiveDoubles >= 3 ? 'jail' : consecutiveDoubles > 0 ? 'doubles' : '';
  const animClass =
    rollPhase === 'tumbling'
      ? 'tumbling'
      : rollPhase === 'settling'
      ? 'settling'
      : rollPhase === 'settled'
      ? 'settled'
      : '';

  const tumbleCycle = Math.round(280 / speed);
  const settleDuration = Math.round(440 / speed);

  return (
    <div className={`dice-tray ${state}`}>
      <div
        className={`physical-die die-left ${animClass}`}
        style={
          {
            '--tumble-cycle': `${tumbleCycle}ms`,
            '--settle-duration': `${settleDuration}ms`,
          } as React.CSSProperties
        }
      >
        <Face value={visual[0]} />
      </div>
      <div
        className={`physical-die die-right ${animClass}`}
        style={
          {
            '--tumble-cycle': `${tumbleCycle}ms`,
            '--settle-duration': `${settleDuration}ms`,
          } as React.CSSProperties
        }
      >
        <Face value={visual[1]} />
      </div>
      <div className="dice-total">TOTAL: {dice[0] + dice[1]}</div>
      {!!consecutiveDoubles && (
        <div className="doubles-badge">
          {consecutiveDoubles >= 3 ? '3× DOUBLES · GO TO JAIL' : 'DOUBLES · ROLL AGAIN'}
        </div>
      )}
    </div>
  );
}

export default memo(DiceTray);
