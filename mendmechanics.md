# MEND: Mechanics, Transitions, State & Multiplayer

> **Purpose**: Step-by-step instructions for an agent to fix every mechanics, transition, navigation, state-management, multiplayer, and accessibility problem in this project.
>
> **Codebase**: React 18 + TypeScript + Vite. Single-file app at `src/App.tsx` (~70 KB). CSS at `src/style.css` (~53 KB). WebSocket server at `server/index.js`. Custom WS implementation at `server/websocket.js`. Dice component at `src/components/DiceTray.tsx` + `DiceTray.css`. Game data at `src/data/board.ts` and `src/data/cards.ts`. Audio at `src/utils/sound.ts`.
>
> **Rules**: Do not break existing game logic. All Monopoly rules currently work correctly — preserve them. Focus on the interactive experience layer on top of the working logic.

---

## TABLE OF CONTENTS

1. [P0 — Break Up the Monolith](#1-p0--break-up-the-monolith)
2. [P0 — Add a Router and Navigation History](#2-p0--add-a-router-and-navigation-history)
3. [P0 — Token Movement: Replace setInterval with Smooth Animation](#3-p0--token-movement-replace-setinterval-with-smooth-animation)
4. [P0 — Exit Animations for All Overlays](#4-p0--exit-animations-for-all-overlays)
5. [P1 — Dice Rolling: Real Tumble Physics](#5-p1--dice-rolling-real-tumble-physics)
6. [P1 — WebSocket Auto-Reconnect with Backoff](#6-p1--websocket-auto-reconnect-with-backoff)
7. [P1 — WebSocket Heartbeat / Keep-Alive](#7-p1--websocket-heartbeat--keep-alive)
8. [P1 — Server-Side State Authority (Close the gameState Hole)](#8-p1--server-side-state-authority-close-the-gamestate-hole)
9. [P1 — Loading States and Optimistic UI](#9-p1--loading-states-and-optimistic-ui)
10. [P2 — Confirmation Dialogs (Replace Native confirm)](#10-p2--confirmation-dialogs-replace-native-confirm)
11. [P2 — Audio Feedback for Game Events](#11-p2--audio-feedback-for-game-events)
12. [P2 — Auction Timer Visual Countdown](#12-p2--auction-timer-visual-countdown)
13. [P2 — Phase Transition Feedback (Landing Animations)](#13-p2--phase-transition-feedback-landing-animations)
14. [P3 — Accessibility Pass](#14-p3--accessibility-pass)
15. [P3 — Undo / Confirmation for Destructive Actions](#15-p3--undo--confirmation-for-destructive-actions)
16. [P3 — Player Name Validation](#16-p3--player-name-validation)
17. [P3 — localStorage Error Handling](#17-p3--localstorage-error-handling)

---

## 1. P0 — Break Up the Monolith

### What's wrong
`src/App.tsx` is a single 42-line file (heavily packed, ~70 KB) containing:
- All type definitions (`Features`, `TradeOffer`, `Player`, `Game`)
- The entire game reducer (~500 lines of logic inside one function)
- Helper functions (`maxLiquidatable`, `netWorth`, `money`, `initialGame`)
- Inline SVG icon components (`TileIcon`, `DieFace`)
- The full `App` component with ~40 `useState` hooks, ~12 `useEffect` hooks, WebSocket connection logic, and the entire JSX render tree (lobby, room lobby, setup modal, game board, sidebar, assets drawer, trade modal, rules modal, deed card overlay)

This causes:
- Every single state change re-renders the entire component tree
- Frame drops during animations because React reconciles thousands of DOM nodes
- Impossible to reason about which effects depend on what

### How to fix

#### Step 1: Extract types
Create `src/types.ts`. Move `Features`, `TradeOffer`, `Player`, `Game`, and the `Card`/`Tile` re-exports there.

#### Step 2: Extract the reducer
Create `src/reducer.ts`. Move the `reducer` function, `initialGame`, `maxLiquidatable`, `netWorth`, `money`, `shuffle`, `blank`, `defaults`, `colors`, and `KEY` constant there. Export them.

#### Step 3: Extract the WebSocket/room hook
Create `src/hooks/useRoom.ts`. Move all WebSocket logic into a custom hook:
```ts
export function useRoom(game: Game, dispatch: Dispatch) {
  // All the socketRef, remoteRef, roomSeatRef, roomRef, lastStateVersion, autoResumeStarted refs
  // The connectRoom function
  // The useEffects that sync game state to WebSocket
  // The auto-resume useEffect
  // Return: { room, roomSeat, nick, setNick, joinCode, setJoinCode, roomError, roomLink, connectionState, connectRoom, rollPending, setRollPending, socketRef }
}
```

#### Step 4: Extract view components
Create these files, each receiving only the props they need:

| File | Extracts |
|------|----------|
| `src/views/Lobby.tsx` | The entire `if (!game.players.length \|\| homeView) return <main className="lobby">...` block |
| `src/views/SetupModal.tsx` | The `{setup && <div className="overlay">...}` block |
| `src/views/RoomLobby.tsx` | The `{room && !room.game?.players?.length && ...}` block |
| `src/views/GameBoard.tsx` | The `<section className="board-area">` with the board grid and hub |
| `src/views/Sidebar.tsx` | The `<aside className="sidebar">` |
| `src/views/AssetsDrawer.tsx` | The `{drawer && ...}` block |
| `src/views/TradeModal.tsx` | The `{tradeOpen && ...}` block |
| `src/views/RulesModal.tsx` | The `{rulesOpen && ...}` block |
| `src/views/DeedCard.tsx` | The `{place && <div className="place-overlay">...}` block |

#### Step 5: Memoize expensive components
Wrap `GameBoard`, `Sidebar`, and each player card in `React.memo`. Use `useMemo` for the derived values (`activePlayers`, `coords`, `setTiles`, `buildReason`, etc.) that are currently recomputed on every render at the top of the `App` component body.

#### Step 6: Verify
Run `npm run build` — zero type errors, zero regressions. Play a full local game and a 2-player WebSocket game to confirm nothing broke.

---

## 2. P0 — Add a Router and Navigation History

### What's wrong
There is no router. The entire app is one URL. The browser back button exits the site. Views are toggled with boolean flags (`homeView`, `setup`, `drawer`, `tradeOpen`, `rulesOpen`, `selectedTile`, `inspectedPlayer`). No deep links, no history entries.

### How to fix

#### Step 1: Install React Router
```
npm install react-router-dom
```

#### Step 2: Define routes
In `src/main.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/join/:code" element={<App />} />
        <Route path="/game" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
```

#### Step 3: Use `useNavigate` for view transitions
In `App.tsx` (or the extracted hook), replace the boolean flag navigation:

| Current pattern | Replace with |
|----------------|--------------|
| `setHomeView(true)` | `navigate('/')` |
| `setHomeView(false)` after game starts | `navigate('/game')` |
| Joining a room with code | URL already handles `/join/:code` |

#### Step 4: Handle back button for modals
Modals (`setup`, `drawer`, `tradeOpen`, `rulesOpen`, `selectedTile`) should push history entries so back closes them:
```ts
// When opening a modal:
window.history.pushState({ modal: 'rules' }, '');

// Listen for popstate:
useEffect(() => {
  const handler = (e: PopStateEvent) => {
    if (rulesOpen) { setRulesOpen(false); e.preventDefault(); }
    if (drawer) { setDrawer(false); e.preventDefault(); }
    // etc.
  };
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}, [rulesOpen, drawer, tradeOpen, selectedTile]);
```

#### Step 5: Handle the existing `/join/:code` URL parsing
Currently done manually with:
```js
const c = new URLSearchParams(location.search).get('room') || location.pathname.match(/^\/join\/([A-Z0-9]{4})$/i)?.[1];
```
Replace with `useParams()` from React Router for the `/join/:code` route.

---

## 3. P0 — Token Movement: Replace setInterval with Smooth Animation

### What's wrong
In the `useEffect` that handles `game.phase === 'MOVING'` (around line 36 of `App.tsx`), the token moves using:
```js
movementTimer = window.setInterval(() => {
  step++;
  setVisualPos(v => ({...v, [game.turn]: (game.moveFrom! + step) % 40}));
  if (step >= (game.moveSteps || 1)) { /* ... */ }
}, 380 / game.speed);
```

This produces a discrete staircase jump — the token teleports from tile to tile with no interpolation.

### How to fix

#### Approach: CSS transition on transform with tile coordinates

**Step 1**: Create a utility that maps tile index (0–39) to pixel coordinates on the board:
```ts
// src/utils/tileCoords.ts
export function tileToPixel(tileIndex: number, boardSize: number): { x: number; y: number } {
  const tileSize = boardSize / 11;
  const cornerSize = tileSize * 1.35;
  // Calculate x, y based on which edge the tile is on (bottom: 0-10, left: 11-20, top: 21-30, right: 31-39)
  // Return center coordinates of each tile
}
```

**Step 2**: Replace the `setInterval` step loop with a single state update that sets the final position, and use CSS `transition` on the pawn token's `transform` property:
```css
.pawn-token {
  transition: transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot spring */
}
```

**Step 3**: For multi-step movement (e.g., moving 7 tiles), animate through each intermediate tile using a staggered approach:
```ts
// Instead of setInterval, queue position updates with requestAnimationFrame
const animateSteps = async (from: number, steps: number) => {
  for (let i = 1; i <= steps; i++) {
    const pos = (from + i) % 40;
    setVisualPos(v => ({ ...v, [game.turn]: pos }));
    await new Promise(r => setTimeout(r, 280 / game.speed));
  }
  dispatch({ type: 'TICK' });
};
```

**Step 4**: Add a vertical hop to each step using a keyframe:
```css
@keyframes tile-hop {
  0%   { transform: translateY(0) scale(1); }
  40%  { transform: translateY(-8px) scale(1.1); }
  100% { transform: translateY(0) scale(1); }
}
.pawn-token.stepping {
  animation: tile-hop 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

**Step 5**: After the final tile, add a "landing" effect — a brief scale pulse and a subtle shadow expansion:
```css
.pawn-token.landed {
  animation: land-bounce 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes land-bounce {
  0%   { transform: scale(1.15); filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3)); }
  100% { transform: scale(1); filter: drop-shadow(0 1px 0px rgba(0,0,0,0.15)); }
}
```

---

## 4. P0 — Exit Animations for All Overlays

### What's wrong
Every modal/overlay has an entrance animation but **disappears instantly** on close. The CSS has `@keyframes veil-in`, `card-arrive`, `drawer-arrive`, `rules-in` for entrances — but closing sets the boolean to `false`, which immediately unmounts the component.

### How to fix

#### Approach: Delayed unmount pattern

**Step 1**: Create a reusable hook:
```ts
// src/hooks/useDelayedUnmount.ts
export function useDelayedUnmount(isOpen: boolean, delayMs = 200) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animState, setAnimState] = useState<'entering' | 'visible' | 'exiting'>('entering');

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setAnimState('entering');
      requestAnimationFrame(() => setAnimState('visible'));
    } else if (shouldRender) {
      setAnimState('exiting');
      const timer = setTimeout(() => setShouldRender(false), delayMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  return { shouldRender, animState };
}
```

**Step 2**: Apply to every overlay. Example for the deed card:
```tsx
const { shouldRender: showDeed, animState: deedAnim } = useDelayedUnmount(selectedTile !== null, 220);

{shouldRender && (
  <div className={`place-overlay ${deedAnim === 'exiting' ? 'exiting' : ''}`}>
    ...
  </div>
)}
```

**Step 3**: Add exit CSS for each overlay type:
```css
/* Veil (background overlay) */
.place-overlay.exiting { animation: veil-out 200ms ease-out forwards; }
@keyframes veil-out { to { opacity: 0; } }

/* Card (deed, trade, rules modals) */
.place-overlay.exiting .place-card,
.place-overlay.exiting .trade-modal,
.place-overlay.exiting .rules-modal {
  animation: card-leave 220ms cubic-bezier(0.55, 0, 1, 0.45) forwards;
}
@keyframes card-leave {
  to { opacity: 0; transform: translateY(8px) scale(0.97); }
}

/* Drawer (assets) */
.drawer-back.exiting { animation: veil-out 180ms ease-out forwards; }
.drawer-back.exiting .assets-drawer {
  animation: drawer-leave 220ms ease-in forwards;
}
@keyframes drawer-leave {
  to { transform: translateX(20px); opacity: 0; }
}
```

**Step 4**: Apply this to ALL closeable overlays:
- `place-overlay` (deed card) — `selectedTile !== null`
- `drawer-back` (assets drawer) — `drawer`
- `rules-overlay` (rules modal) — `rulesOpen`
- `trade-modal` overlay — `tradeOpen`
- `setup-modal` overlay — `setup`
- `room-lobby-overlay` — room lobby card
- `trade-notice` (incoming trade notification) — `game.trades.filter(...).length > 0`

---

## 5. P1 — Dice Rolling: Real Tumble Physics

### What's wrong
In `src/components/DiceTray.tsx`, the "rolling" effect is:
1. A `setInterval` randomizing the face value every `80/speed` ms (visual flicker)
2. A CSS animation `die-tumble` that runs `infinite alternate` during tumbling

The rotation animation has no relationship to the face value — it's purely decorative. The flicker is jarring, not fun.

### How to fix

**Step 1**: Replace the random flicker with a decreasing-frequency cascade:
```ts
useEffect(() => {
  if (!rolling) { setVisual(dice); setTumbling(false); return; }
  setTumbling(true);

  // Start fast, slow down — like a real die losing momentum
  const intervals = [60, 70, 85, 105, 130, 170, 220, 300, 420];
  let step = 0;
  let timer: number;

  const tick = () => {
    if (step < intervals.length) {
      setVisual([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      timer = window.setTimeout(tick, intervals[step] / speed);
      step++;
    } else {
      setVisual(dice); // Land on actual value
      setTimeout(() => setTumbling(false), 300 / speed);
    }
  };
  tick();

  return () => clearTimeout(timer);
}, [rolling, dice[0], dice[1], speed]);
```

**Step 2**: Replace the CSS animation with a rotation that decelerates:
```css
.physical-die.tumbling {
  animation: die-spin var(--roll-duration, 760ms) cubic-bezier(0.12, 0.8, 0.3, 1) both;
}
@keyframes die-spin {
  0%   { transform: rotate(-25deg) scale(0.85); box-shadow: 2px 2px 0 #181715; }
  30%  { transform: rotate(20deg) scale(1.08); box-shadow: 5px 5px 0 #181715; }
  60%  { transform: rotate(-8deg) scale(1.02); }
  85%  { transform: rotate(3deg) scale(1.0); }
  100% { transform: rotate(0deg) scale(1); box-shadow: 3px 3px 0 #181715; }
}
```

**Step 3**: Add a subtle "land" effect when the die settles:
```css
.physical-die.settled {
  animation: die-land 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes die-land {
  0% { transform: translateY(-3px); }
  50% { transform: translateY(1px); }
  100% { transform: translateY(0); }
}
```

**Step 4**: Add a third state to `DiceTray`: `tumbling` → `settling` → `idle`, so the CSS transitions chain properly.

---

## 6. P1 — WebSocket Auto-Reconnect with Backoff

### What's wrong
In `App.tsx`, the WebSocket `onclose` handler just shows an error message:
```js
ws.onclose = () => {
  setRollPending(false);
  setConnectionState('Disconnected. Reconnect to your room.');
  setRoomError('Room connection closed. Reconnect with your saved player token.');
};
```

No automatic reconnection. Mobile users who switch apps or lose signal for 2 seconds are permanently disconnected.

### How to fix

**Step 1**: Create a reconnection manager (or add to the `useRoom` hook after extraction):
```ts
const reconnectAttempts = useRef(0);
const maxReconnectAttempts = 8;
const reconnectTimer = useRef<number>();

const getBackoffDelay = (attempt: number) => {
  // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, 16s, 30s, 30s
  return Math.min(500 * Math.pow(2, attempt), 30000);
};

const scheduleReconnect = () => {
  if (reconnectAttempts.current >= maxReconnectAttempts) {
    setConnectionState('Could not reconnect. Please refresh the page.');
    return;
  }
  const delay = getBackoffDelay(reconnectAttempts.current);
  setConnectionState(`Reconnecting in ${Math.ceil(delay / 1000)}s... (attempt ${reconnectAttempts.current + 1})`);
  reconnectTimer.current = window.setTimeout(() => {
    reconnectAttempts.current++;
    connectRoom('resume');
  }, delay);
};
```

**Step 2**: Modify the `onclose` handler:
```js
ws.onclose = () => {
  if (socketRef.current !== ws) return;
  setRollPending(false);
  // Only auto-reconnect if we had a valid session
  const code = localStorage.getItem('business-room-code');
  const token = code ? localStorage.getItem(`business-player-token:${code}`) : null;
  if (token) {
    scheduleReconnect();
  } else {
    setConnectionState('Disconnected.');
    setRoomError('Room connection closed.');
  }
};
```

**Step 3**: Reset the counter on successful connection:
```js
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'joined') {
    reconnectAttempts.current = 0; // Reset on success
    // ... rest of handler
  }
};
```

**Step 4**: Add a visual reconnection indicator in the UI — a slim banner at the top:
```tsx
{connectionState.includes('Reconnecting') && (
  <div className="reconnect-banner">
    <span className="reconnect-spinner" /> {connectionState}
  </div>
)}
```
```css
.reconnect-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  height: 32px; display: flex; align-items: center; justify-content: center;
  gap: 8px; background: #d4a34d; color: #2c1a04;
  font: 500 10px 'DM Mono', monospace; letter-spacing: 0.04em;
  animation: banner-in 300ms ease-out;
}
.reconnect-spinner {
  width: 12px; height: 12px; border: 2px solid #2c1a0455;
  border-top-color: #2c1a04; border-radius: 50%;
  animation: spin 800ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

**Step 5**: Clean up reconnection timer on unmount:
```ts
useEffect(() => {
  return () => { if (reconnectTimer.current) clearTimeout(reconnectTimer.current); };
}, []);
```

---

## 7. P1 — WebSocket Heartbeat / Keep-Alive

### What's wrong
The server (`server/index.js`) and the custom WebSocket implementation (`server/websocket.js`) have no ping/pong heartbeat. Mobile carriers and corporate firewalls routinely kill idle WebSocket connections after 30–60 seconds.

### How to fix

**Step 1**: Add server-side pings in `server/index.js`:
```js
// After wss.on('connection', socket => { ... }):
const pingInterval = setInterval(() => {
  if (socket.readyState === 1) {
    socket.ping(); // Send WebSocket ping frame
  }
}, 25000); // Every 25 seconds

socket.on('close', () => {
  clearInterval(pingInterval);
  // ... existing close handler
});
```

**Step 2**: Add a `ping()` method to the `Peer` class in `server/websocket.js`:
```js
// In class Peer:
ping() { if (this.readyState === OPEN) this.socket.write(frame(9)); } // opcode 9 = ping
```

The `read()` method already handles opcode 9 (ping) by responding with pong (opcode 10), so the client side already works.

**Step 3**: Add a client-side stale connection detector. If no message arrives in 35 seconds, consider the connection dead:
```ts
const lastMessageTime = useRef(Date.now());

// In ws.onmessage:
lastMessageTime.current = Date.now();

// Stale connection check:
const staleCheck = setInterval(() => {
  if (Date.now() - lastMessageTime.current > 35000 && ws.readyState === WebSocket.OPEN) {
    ws.close(); // Force close — will trigger onclose → auto-reconnect
  }
}, 10000);
```

---

## 8. P1 — Server-Side State Authority (Close the gameState Hole)

### What's wrong
In `server/index.js` line 73:
```js
if (msg.action === 'gameState' && msg.state && typeof msg.state === 'object') {
  room.game = msg.state;
}
```
Any player can send an arbitrary game state and the server accepts it blindly. Only `manageState`, `tradeState`, and `leaveState` have validation.

### How to fix

**Step 1**: Add validation to `gameState`. At minimum, verify:
```js
if (msg.action === 'gameState' && msg.state && typeof msg.state === 'object') {
  // Only the active seat can send full game state
  if (seat.index !== room.activeSeat) {
    return send(socket, { type: 'rejected', reason: 'Only the active player can update game state.' });
  }

  const before = room.game;
  const next = msg.state;

  // If a game already exists, validate invariants:
  if (before && before.players?.length) {
    // Player count must not change
    if (next.players?.length !== before.players.length) {
      return send(socket, { type: 'rejected', reason: 'Player count mismatch.' });
    }

    // No player's cash can increase by more than a reasonable amount per action
    // (START salary is 1500, max card is 2000, loan is 10000)
    for (let i = 0; i < next.players.length; i++) {
      const cashDelta = (next.players[i]?.cash || 0) - (before.players[i]?.cash || 0);
      if (cashDelta > 12000) {
        return send(socket, { type: 'rejected', reason: 'Suspicious cash increase detected.' });
      }
    }

    // Total properties across all players + unowned must equal total property count
    const totalOwned = next.players.reduce((sum, p) => sum + (p.owned?.length || 0), 0);
    if (totalOwned > 28) { // 22 properties + 4 transports + 2 utilities
      return send(socket, { type: 'rejected', reason: 'Invalid property count.' });
    }
  }

  room.game = next;
}
```

**Step 2**: Long-term, consider moving all game logic server-side so the server runs the reducer and clients only send actions (`{type: 'BUY'}`, `{type: 'PASS'}`, etc.) rather than full states. This is a large refactor but is the only way to fully prevent cheating.

---

## 9. P1 — Loading States and Optimistic UI

### What's wrong
When rolling dice in multiplayer, `setRollPending(true)` disables the button but shows no visual feedback. No spinner, no animation, nothing. The user clicks and sees a frozen disabled button for however long the round-trip takes.

### How to fix

**Step 1**: Add a loading spinner to the roll button when pending:
```tsx
<button className="primary roll" disabled={rollPending || !canAct} onClick={rollHandler}>
  {rollPending ? (
    <>
      <span className="btn-spinner" /> Rolling...
    </>
  ) : (
    <>
      <Dice5 size={18} /> Roll dice <span>SPACE</span>
    </>
  )}
</button>
```

**Step 2**: CSS for the spinner:
```css
.btn-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
  display: inline-block;
}
```

**Step 3**: For property management actions in multiplayer (build, mortgage, etc.), add a brief `pending` state to the button that was clicked:
```tsx
const [pendingAction, setPendingAction] = useState<string | null>(null);

// On click:
setPendingAction(`build-${id}`);
dispatch({ type: 'LIQUIDATE', id, mode: 'build', actor: manager });

// In useEffect watching game state changes:
useEffect(() => { setPendingAction(null); }, [game]);
```

---

## 10. P2 — Confirmation Dialogs (Replace Native confirm)

### What's wrong
Player removal uses `window.confirm()`:
```js
if (confirm(`Remove ${q.name} from this game...`)) dispatch({ type: 'LEAVE_PLAYER', player: i });
```
This is a native browser dialog — unstyled, blocks the thread, can't be themed.

### How to fix

**Step 1**: Create a reusable `ConfirmDialog` component:
```tsx
// src/components/ConfirmDialog.tsx
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel
}: {
  open: boolean; title: string; message: string;
  confirmLabel?: string; cancelLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="place-overlay confirm-overlay" onClick={onCancel}>
      <section className="confirm-card" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>{cancelLabel || 'Cancel'}</button>
          <button className={danger ? 'primary danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </section>
    </div>
  );
}
```

**Step 2**: Add state for the confirm dialog:
```ts
const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);
```

**Step 3**: Replace every `confirm()` call:
```tsx
// Before:
if (confirm(`Remove ${q.name}...`)) dispatch({ type: 'LEAVE_PLAYER', player: i });

// After:
setConfirmAction({
  title: 'Remove player',
  message: `Remove ${q.name} from this game and return their assets to the Bank?`,
  action: () => dispatch({ type: 'LEAVE_PLAYER', player: i }),
});
```

**Step 4**: Also add confirmation for:
- Declaring bankruptcy (`dispatch({ type: 'BANKRUPT' })`)
- Taking a bank loan

---

## 11. P2 — Audio Feedback for Game Events

### What's wrong
Only dice rolling has audio (`src/utils/sound.ts`). Every other game event is silent.

### How to fix

**Step 1**: Extend `sound.ts` with additional synthesized sounds:
```ts
export function playBuySound(enabled = true) { /* Short ascending chime — two quick triangle wave notes at 400Hz and 600Hz */ }
export function playRentSound(enabled = true) { /* Brief descending tone — 500Hz down to 300Hz, 100ms */ }
export function playJailSound(enabled = true) { /* Low thud — 80Hz sine wave, 200ms with quick decay */ }
export function playAuctionTickSound(enabled = true) { /* Soft click — very short noise burst, 20ms */ }
export function playWinSound(enabled = true) { /* Ascending arpeggio — 400, 500, 600, 800Hz, 80ms each */ }
export function playErrorSound(enabled = true) { /* Two quick low beeps — 200Hz, 60ms, gap, 200Hz, 60ms */ }
```

**Step 2**: Hook them into the game phases:
- `RESOLVE_TILE` when buying → `playBuySound()`
- Rent payment → `playRentSound()`
- Go to Jail / `gotojail` tile → `playJailSound()`
- `AUCTION` phase, each tick → `playAuctionTickSound()`
- `GAME_OVER` → `playWinSound()`
- Bankruptcy → `playErrorSound()`

**Step 3**: All sounds must respect the `muted` state variable.

---

## 12. P2 — Auction Timer Visual Countdown

### What's wrong
The auction timer shows `10s`, `9s`... in plain monospace text with no visual urgency. The `AUCTION_TICK` action decrements `seconds` by 1 every second via `setTimeout`.

### How to fix

**Step 1**: Add a circular progress ring or linear progress bar:
```tsx
<div className="auction-timer-ring">
  <svg viewBox="0 0 36 36">
    <circle className="timer-bg" cx="18" cy="18" r="15.9" fill="none" stroke="#d8d4c9" strokeWidth="2" />
    <circle className="timer-fg" cx="18" cy="18" r="15.9" fill="none" stroke="#b56643" strokeWidth="2.5"
      strokeDasharray="100" strokeDashoffset={100 - (game.auction.seconds / 10) * 100}
      strokeLinecap="round" transform="rotate(-90 18 18)"
      style={{ transition: 'stroke-dashoffset 1s linear' }} />
  </svg>
  <span>{game.auction.seconds}</span>
</div>
```

**Step 2**: Add urgency styling when seconds <= 3:
```css
.auction-timer-ring.urgent .timer-fg { stroke: #9e2a2b; }
.auction-timer-ring.urgent span { color: #9e2a2b; animation: pulse-urgent 500ms ease infinite; }
@keyframes pulse-urgent { 50% { transform: scale(1.15); } }
```

---

## 13. P2 — Phase Transition Feedback (Landing Animations)

### What's wrong
When a token lands on a tile, the phase goes `MOVING → RESOLVE_TILE` (via `TICK` after a timeout) → auto-dispatches `RESOLVE` after 180ms. The user sees no visual event for landing — no card flip, no highlight pulse, no dramatic reveal.

### How to fix

**Step 1**: Increase the `RESOLVE_TILE` delay from 180ms to 600ms to give time for a landing effect.

**Step 2**: When `phase === 'RESOLVE_TILE'`, add a class to the landed tile:
```tsx
className={`tile ... ${game.phase === 'RESOLVE_TILE' && p?.pos === t.id ? 'landing' : ''}`}
```

```css
.tile.landing {
  animation: tile-pulse 500ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 10;
}
@keyframes tile-pulse {
  0% { box-shadow: inset 0 0 0 2px #b36b43, 0 0 0 0 rgba(179,107,67,0.4); }
  50% { box-shadow: inset 0 0 0 2px #b36b43, 0 0 0 8px rgba(179,107,67,0.15); }
  100% { box-shadow: inset 0 0 0 2px #b36b43, 0 0 0 0 rgba(179,107,67,0); }
}
```

**Step 3**: For Chance/Community Chest tiles, consider a brief "card flip" animation on the hub message text when the card text appears.

---

## 14. P3 — Accessibility Pass

### What's wrong
- No ARIA live regions — screen readers can't follow game events
- No focus trapping in modals
- No keyboard navigation for the board
- Color-only ownership indicators
- Microscopic touch targets on mobile (28px tiles)
- No skip links

### How to fix

**Step 1**: Add an ARIA live region for game announcements:
```tsx
<div aria-live="assertive" aria-atomic="true" className="sr-only">
  {game.message}
</div>
```
```css
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
```

**Step 2**: Add focus trapping to modals. Use a simple focus-trap utility:
```ts
// When modal opens, find all focusable elements inside it and trap Tab/Shift+Tab
useEffect(() => {
  if (!isOpen) return;
  const modal = modalRef.current;
  if (!modal) return;
  const focusable = modal.querySelectorAll('button, input, select, [tabindex]');
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  first?.focus();
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  modal.addEventListener('keydown', handler);
  return () => modal.removeEventListener('keydown', handler);
}, [isOpen]);
```

**Step 3**: Add `role="dialog"` and `aria-modal="true"` to all modal overlays (the rules modal already has this, others don't).

**Step 4**: Add `aria-label` attributes to ownership dots showing the owner name and player icons.

**Step 5**: For mobile touch targets, add a tile tap zone that's larger than the visual tile:
```css
.tile::after {
  content: '';
  position: absolute;
  inset: -4px; /* Expand touch target */
  z-index: -1;
}
```

---

## 15. P3 — Undo / Confirmation for Destructive Actions

### What's wrong
Clicking "Buy" immediately purchases. Clicking "Declare bankruptcy" immediately bankrupts. No undo, no confirmation (except the native `confirm()` for leaving, which is also bad — see section 10).

### How to fix

**Step 1**: For buying a property, add a 3-second undo toast:
```tsx
const [undoAction, setUndoAction] = useState<{ timeout: number; undo: () => void } | null>(null);

// Instead of immediately dispatching BUY:
const handleBuy = () => {
  dispatch({ type: 'BUY' });
  const timeout = window.setTimeout(() => setUndoAction(null), 3000);
  setUndoAction({ timeout, undo: () => { clearTimeout(timeout); dispatch({ type: 'UNDO_BUY' }); setUndoAction(null); } });
};
```

This requires adding an `UNDO_BUY` action to the reducer that reverses the purchase.

**Step 2**: For bankruptcy, **always** show a custom confirmation dialog (see section 10) with danger styling.

---

## 16. P3 — Player Name Validation

### What's wrong
In the setup modal, player name inputs have no validation. Players can enter empty strings, whitespace only, or duplicate names.

### How to fix

**Step 1**: In the `start()` function, validate names:
```ts
const start = () => {
  const trimmedNames = names.slice(0, count).map(n => n.trim());
  if (trimmedNames.some(n => !n)) {
    setRoomError('Every player needs a name.');
    return;
  }
  if (new Set(trimmedNames).size !== trimmedNames.length) {
    setRoomError('Player names must be unique.');
    return;
  }
  // ... existing start logic
};
```

**Step 2**: Add inline validation to the name input fields:
```tsx
<input
  value={name}
  onChange={e => setNames(names.map((x, j) => j === i ? e.target.value : x))}
  maxLength={20}
  className={name.trim() === '' ? 'name-error' : ''}
/>
```

---

## 17. P3 — localStorage Error Handling

### What's wrong
```js
try { localStorage.setItem(KEY, JSON.stringify(game)) } catch {}
```
Errors are swallowed silently. If localStorage is full, the game stops saving with no warning.

### How to fix

```ts
useEffect(() => {
  if (!game.players.length) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(game));
  } catch (e) {
    console.warn('Could not save game state:', e);
    // Show a non-blocking warning
    if (!saveWarningShown.current) {
      saveWarningShown.current = true;
      dispatch({ type: 'LOG', message: '⚠ Auto-save unavailable. Your progress may not persist on refresh.' });
    }
  }
}, [game]);
```

---

## ORDER OF IMPLEMENTATION

Work through these in this order to minimize conflicts:

1. **Break up the monolith** (Section 1) — everything else becomes easier after this
2. **Exit animations** (Section 4) — small, self-contained, big visual impact
3. **Token movement** (Section 3) — the single biggest UX improvement
4. **Dice physics** (Section 5) — high-impact, contained change
5. **Router** (Section 2) — structural but doesn't touch game logic
6. **WebSocket reconnect + heartbeat** (Sections 6 & 7) — multiplayer reliability
7. **Confirmation dialogs** (Section 10) — replace `confirm()`
8. **Loading states** (Section 9) — multiplayer feedback
9. **Phase transitions** (Section 13) — polish
10. **Audio** (Section 11) — polish
11. **Auction timer** (Section 12) — polish
12. **Server authority** (Section 8) — security
13. **Accessibility** (Section 14) — compliance
14. **Undo** (Section 15) — nice-to-have
15. **Name validation** (Section 16) — minor
16. **localStorage handling** (Section 17) — minor
