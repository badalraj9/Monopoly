import { useEffect, useState } from 'react';
import './DiceTray.css';

const pipMap: Record<number, [number, number][]> = {
  1: [[18, 18]],
  2: [[9, 9], [27, 27]],
  3: [[9, 9], [18, 18], [27, 27]],
  4: [[9, 9], [27, 9], [9, 27], [27, 27]],
  5: [[9, 9], [27, 9], [18, 18], [9, 27], [27, 27]],
  6: [[9, 8], [27, 8], [9, 18], [27, 18], [9, 28], [27, 28]],
};

function Face({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 36 36" aria-label={`${value} pips`} role="img">
      {pipMap[value].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.2" fill={value === 1 ? '#9E2A2B' : '#181715'} />
      ))}
    </svg>
  );
}

type RollPhase = 'idle' | 'tumbling' | 'settling' | 'settled';

export default function DiceTray({
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

    // Decelerating tumble physics cascade (fast ~60ms -> steps to ~80ms, ~110ms, ~160ms, ~240ms, ~320ms)
    const intervals = [60, 80, 110, 160, 240, 320];
    let step = 0;
    let timerId: number | undefined;

    const tick = () => {
      if (step < intervals.length) {
        setVisual([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
        const delay = intervals[step] / speed;
        step++;
        timerId = window.setTimeout(tick, delay);
      } else {
        // Land on actual values with weight impact
        setVisual(dice);
        setRollPhase('settling');

        timerId = window.setTimeout(() => {
          setRollPhase('settled');

          timerId = window.setTimeout(() => {
            setRollPhase('idle');
          }, 320 / speed);
        }, 120 / speed);
      }
    };

    tick();

    return () => {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [rolling, dice[0], dice[1], speed]);

  const state = consecutiveDoubles >= 3 ? 'jail' : consecutiveDoubles > 0 ? 'doubles' : '';
  const animClass =
    rollPhase === 'tumbling'
      ? 'tumbling'
      : rollPhase === 'settling'
      ? 'settling settled'
      : rollPhase === 'settled'
      ? 'settled'
      : '';

  const rollDuration = Math.round(970 / speed);
  const settleDuration = Math.round(440 / speed);

  return (
    <div className={`dice-tray ${state}`}>
      <div
        className={`physical-die die-left ${animClass}`}
        style={{ '--roll-duration': `${rollDuration}ms`, '--settle-duration': `${settleDuration}ms` } as React.CSSProperties}
      >
        <Face value={visual[0]} />
      </div>
      <div
        className={`physical-die die-right ${animClass}`}
        style={{ '--roll-duration': `${rollDuration}ms`, '--settle-duration': `${settleDuration}ms` } as React.CSSProperties}
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
