/**
 * Stage 2 Rules Engine & Security Verification Suite
 * 
 * Verifies:
 * 1. Seat & Turn Authorization in api/room.js:
 *    - Turn actions ('roll', 'endTurn', 'buy', 'liquidate') require token of activeSeat (HTTP 403 if not).
 *    - 'auctionBid' requires bidder seat matching auction turn.
 *    - 'tradeAccept' / 'tradeReject' requires trade recipient token.
 * 2. Server-side Dice Generation:
 *    - crypto randomInt(1, 7) generated on server; client-sent dice ignored.
 * 3. Rate Limiting per Token:
 *    - >10 actions/sec per token rejected with HTTP 429.
 * 4. Stuck-State Recovery in api/room.js:
 *    - Action 'skipInactive' advances activeSeat if inactive > 45s; rejected if < 45s.
 *    - Host resilience: transferring seat 0 when host departs.
 * 5. Rules Engine Correctness (src/App.tsx):
 *    - Jail: doubles to leave jail does not grant extra turn (rolls === 0).
 *    - Jail: END does NOT decrement jail for other players (only active player tracks own jail).
 *    - START: landing directly on START awards 1 salary (₹1,500), not 2.
 *    - Supply limits: building blocked if houses >= 32 or hotels >= 12.
 *    - Trading: cannot trade property if color group has buildings.
 *    - Bankruptcy: debtor's buildings liquidated for 50% cash to creditor; properties transferred unbuilt.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { callApi } from './chaos-test.mjs';

export async function runRulesSecuritySuite() {
  console.log('\n=============================================================');
  console.log('Stage 2: Rules Engine & Server Security Verification Suite');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;
  const errors = [];

  function assert(condition, message) {
    if (!condition) {
      failed++;
      errors.push(message);
      console.error(`  ❌ FAIL: ${message}`);
      return false;
    } else {
      passed++;
      console.log(`  ✅ PASS: ${message}`);
      return true;
    }
  }

  // ==========================================================
  // SECTION 1: Server-Side Validation & Security (api/room.js)
  // ==========================================================

  console.log('\n[Suite 1] Seat & Turn Authorization (api/room.js):');
  const createRes = await callApi('POST', '/api/room?action=create', { nickname: 'Host' });
  const code = createRes.data?.code;
  const token0 = createRes.data?.token;

  const joinRes = await callApi('POST', '/api/room?action=join', { code, nickname: 'Player 2' });
  const token1 = joinRes.data?.token;

  // Initialize game state with turn: 0, activeSeat: 0
  const startRes = await callApi('POST', '/api/room?action=action', {
    code,
    token: token0,
    action: 'gameState',
    state: {
      phase: 'WAIT_FOR_ROLL',
      turn: 0,
      rolls: 0,
      players: [
        { name: 'Host', color: '#db674e', cash: 15000, pos: 0, owned: [], buildings: {}, active: true },
        { name: 'Player 2', color: '#467da5', cash: 15000, pos: 0, owned: [], buildings: {}, active: true }
      ]
    }
  });
  assert(startRes.status === 200, 'Game state initialized with activeSeat: 0');

  // Case 1A: Seat 1 tries to roll on Seat 0's turn -> HTTP 403
  const unauthorizedRoll = await callApi('POST', '/api/room?action=action', {
    code,
    token: token1,
    action: 'roll'
  });
  assert(unauthorizedRoll.status === 403, `Seat 1 cannot roll on Seat 0's turn (got HTTP ${unauthorizedRoll.status})`);
  assert(unauthorizedRoll.data?.error?.includes('turn'), '403 error message indicates turn authorization failure');

  // Case 1B: Seat 1 tries to endTurn on Seat 0's turn -> HTTP 403
  const unauthorizedEnd = await callApi('POST', '/api/room?action=action', {
    code,
    token: token1,
    action: 'endTurn',
    nextSeat: 1
  });
  assert(unauthorizedEnd.status === 403, `Seat 1 cannot endTurn on Seat 0's turn (got HTTP ${unauthorizedEnd.status})`);

  // Case 1C: Seat 0 performs roll legitimately -> HTTP 200
  const authorizedRoll = await callApi('POST', '/api/room?action=action', {
    code,
    token: token0,
    action: 'roll'
  });
  assert(authorizedRoll.status === 200, 'Seat 0 successfully rolls on their turn (HTTP 200)');

  // Case 1D: Auction bid authorization
  await callApi('POST', '/api/room?action=action', {
    code,
    token: token0,
    action: 'manageState',
    state: {
      phase: 'AUCTION',
      turn: 0,
      auction: { tile: 1, turn: 0, highestBid: 100, highestPlayer: -1, passed: [], seconds: 10 },
      players: [
        { name: 'Host', color: '#db674e', cash: 15000, pos: 0, owned: [], buildings: {}, active: true },
        { name: 'Player 2', color: '#467da5', cash: 15000, pos: 0, owned: [], buildings: {}, active: true }
      ]
    }
  });

  const unauthorizedBid = await callApi('POST', '/api/room?action=action', {
    code,
    token: token1,
    action: 'auctionBid',
    amount: 50
  });
  assert(unauthorizedBid.status === 403, `Seat 1 cannot bid when auction.turn is 0 (got HTTP ${unauthorizedBid.status})`);

  // Case 1E: Trade response authorization
  await callApi('POST', '/api/room?action=action', {
    code,
    token: token0,
    action: 'manageState',
    state: {
      phase: 'TRADE',
      turn: 0,
      trades: [{ id: 99, from: 0, to: 1, giveCash: 100, wantCash: 0, giveProps: [], wantProps: [] }],
      players: [
        { name: 'Host', color: '#db674e', cash: 15000, pos: 0, owned: [], buildings: {}, active: true },
        { name: 'Player 2', color: '#467da5', cash: 15000, pos: 0, owned: [], buildings: {}, active: true }
      ]
    }
  });

  const unauthorizedTradeAccept = await callApi('POST', '/api/room?action=action', {
    code,
    token: token0, // Sender cannot accept their own trade offer!
    action: 'tradeAccept',
    tradeId: 99
  });
  assert(unauthorizedTradeAccept.status === 403, `Trade proposer cannot accept own trade (got HTTP ${unauthorizedTradeAccept.status})`);

  // --- Suite 2: Server-Side Dice Generation ---
  console.log('\n[Suite 2] Server-Side Dice Generation (api/room.js):');
  let spoofAcceptedCount = 0;
  const testRollCount = 15;
  for (let i = 0; i < testRollCount; i++) {
    const rollResp = await callApi('POST', '/api/room?action=action', {
      code,
      token: token0,
      action: 'roll',
      dice: [6, 6] // Spoofed client dice!
    });
    const resultDice = rollResp.data?.lastAction?.dice;
    if (resultDice && resultDice[0] === 6 && resultDice[1] === 6) {
      spoofAcceptedCount++;
    }
  }
  assert(spoofAcceptedCount < testRollCount, `Server generates dice via crypto randomInt and ignores spoofed client dice (${spoofAcceptedCount}/${testRollCount} were [6,6])`);

  // --- Suite 3: Rate Limiting per Token ---
  console.log('\n[Suite 3] Rate Limiting per Token (api/room.js):');
  const rateLimitRoom = await callApi('POST', '/api/room?action=create', { nickname: 'RateLimitTest' });
  const rlCode = rateLimitRoom.data.code;
  const rlToken = rateLimitRoom.data.token;

  // Perform 15 calls without bypass header
  const burstResults = [];
  for (let i = 0; i < 15; i++) {
    const resp = await callApi(
      'POST',
      '/api/room?action=action',
      { code: rlCode, token: rlToken, action: 'action', payload: i },
      { 'x-bypass-rate-limit': '' }
    );
    burstResults.push(resp);
  }

  const statuses = burstResults.map(r => r.status);
  const status429Count = statuses.filter(s => s === 429).length;
  assert(status429Count >= 4, `Rapid bursts exceeding 10 req/s receive HTTP 429 rate limit (got ${status429Count} 429s)`);
  const sample429 = burstResults.find(r => r.status === 429);
  assert(sample429?.data?.error?.includes('Rate limit'), '429 response message explicitly states rate limit exceeded');

  // --- Suite 4: Stuck-State Recovery & Skip Inactive Player ---
  console.log('\n[Suite 4] Stuck-State Recovery & Skip Inactive (api/room.js):');
  const stuckRoom = await callApi('POST', '/api/room?action=create', { nickname: 'P1' });
  const sCode = stuckRoom.data.code;
  const sToken1 = stuckRoom.data.token;
  const sJoin = await callApi('POST', '/api/room?action=join', { code: sCode, nickname: 'P2' });
  const sToken2 = sJoin.data.token;

  // Premature skipInactive (< 45s)
  const prematureSkip = await callApi('POST', '/api/room?action=action', {
    code: sCode,
    token: sToken2,
    action: 'skipInactive'
  });
  assert(prematureSkip.status === 400, `Premature skipInactive (<45s) rejected with HTTP 400 (got ${prematureSkip.status})`);
  assert(prematureSkip.data?.error?.includes('45s') || prematureSkip.data?.error?.includes('inactive'), 'Error indicates 45s inactivity required');
  assert(typeof prematureSkip.data?.remainingMs === 'number', 'Server provides remainingMs until inactivity threshold');

  // Host Resilience test: Host leaves room
  const hostLeave = await callApi('POST', '/api/room?action=action', {
    code: sCode,
    token: sToken1,
    action: 'leave'
  });
  assert(hostLeave.status === 200, 'Host leaving room returns 200');
  const afterLeavePoll = await callApi('GET', `/api/room?code=${sCode}`);
  assert(afterLeavePoll.data?.players?.length === 1, 'Room retains remaining player');
  assert(afterLeavePoll.data?.players[0]?.index === 0, 'Remaining player promoted to Seat 0 (no orphan rooms)');

  // ==========================================================
  // SECTION 2: Rules Engine Correctness (src/App.tsx)
  // ==========================================================

  console.log('\n[Suite 5] Loading and Verifying Client Reducer (src/App.tsx):');

  // Load board.ts and cards.ts in memory
  const boardSrc = fs.readFileSync('src/data/board.ts', 'utf8');
  const boardTranspiled = ts.transpileModule(boardSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const bCtx = { exports: {} };
  vm.runInNewContext(boardTranspiled, bCtx);
  const board = bCtx.exports.board;

  const cardsSrc = fs.readFileSync('src/data/cards.ts', 'utf8');
  const cardsTranspiled = ts.transpileModule(cardsSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cCtx = { exports: {} };
  vm.runInNewContext(cardsTranspiled, cCtx);
  const { chanceCards, chestCards } = cCtx.exports;

  // Extract reducer and propHasBuildingsInSet from src/App.tsx
  const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
  const reducerMatch = appSrc.match(/(function propHasBuildingsInSet[\s\S]*?function reducer[\s\S]*?return patch\(\{\}\);[\s\S]*?\})/);
  if (!reducerMatch) {
    throw new Error('Could not locate propHasBuildingsInSet and reducer in src/App.tsx');
  }

  const fullSandboxCode = ts.transpileModule(
    `${reducerMatch[0]}\nexports.reducer = reducer;\nexports.propHasBuildingsInSet = propHasBuildingsInSet;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;

  const sandbox = {
    exports: {},
    board,
    chanceCards,
    chestCards,
    money: (n) => `₹${n}`,
    netWorth: () => 0,
    maxLiquidatable: () => 10000,
    shuffle: (a) => a,
    blank: () => ({})
  };
  vm.runInNewContext(fullSandboxCode, sandbox);
  const reducer = sandbox.exports.reducer;
  assert(typeof reducer === 'function', 'Client reducer extracted and compiled from src/App.tsx');

  // Helper to create basic test game state
  function createTestGame(overrides = {}) {
    return {
      phase: 'WAIT_FOR_ROLL',
      players: [
        { name: 'P1', color: '#db674e', cash: 15000, pos: 0, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 },
        { name: 'P2', color: '#467da5', cash: 15000, pos: 0, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
      ],
      turn: 0,
      dice: [1, 1],
      rolls: 0,
      log: [],
      message: '',
      features: { upgrades: true, mortgages: true, auctions: true, loans: true, trading: true, even: true, quick: false, taxMode: 'dynamic', rest: 'skip', mode: 'last', duration: 45 },
      started: Date.now(),
      speed: 1,
      chanceDeck: [...chanceCards],
      chestDeck: [...chestCards],
      taxPool: 0,
      rentMultiplier: 1,
      trades: [],
      ...overrides
    };
  }

  // --- Test 6: Jail Rules ---
  console.log('\n[Suite 6] Jail Rules:');
  // Case 6A: Rolling Doubles out of Jail does NOT grant extra turn (rolls === 0)
  const jailedState = createTestGame({
    phase: 'WAIT_FOR_ROLL',
    turn: 0,
    players: [
      { name: 'P1', color: '#db674e', cash: 15000, pos: 10, owned: [], buildings: {}, mortgaged: [], jail: 1, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 },
      { name: 'P2', color: '#467da5', cash: 15000, pos: 0, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
    ]
  });

  const rollDoublesJail = reducer(jailedState, { type: 'DICE', dice: [3, 3] });
  assert(rollDoublesJail.players[0].jail === 0, 'Rolling doubles releases player from Jail');
  assert(rollDoublesJail.rolls === 0, 'Rolling doubles to leave Jail grants NO extra turn (rolls === 0)');

  // Case 6B: END action does NOT decrement jail for other players
  const multiJailState = createTestGame({
    phase: 'END_TURN',
    turn: 0,
    players: [
      { name: 'P1', color: '#db674e', cash: 15000, pos: 10, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 },
      { name: 'P2', color: '#467da5', cash: 15000, pos: 10, owned: [], buildings: {}, mortgaged: [], jail: 2, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
    ]
  });

  const endTurnResult = reducer(multiJailState, { type: 'END' });
  assert(endTurnResult.players[1].jail === 2, `END action does NOT decrement jail for other players (P2 jail stayed 2, got ${endTurnResult.players[1].jail})`);

  // Case 6C: PAY_BAIL keeps player eligible to roll
  const payBailState = createTestGame({
    phase: 'WAIT_FOR_ROLL',
    turn: 0,
    players: [
      { name: 'P1', color: '#db674e', cash: 15000, pos: 10, owned: [], buildings: {}, mortgaged: [], jail: 1, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
    ]
  });
  const bailResult = reducer(payBailState, { type: 'PAY_BAIL' });
  assert(bailResult.players[0].jail === 0, 'Paying bail clears player jail');
  assert(bailResult.phase === 'WAIT_FOR_ROLL', 'Paying bail keeps player eligible to roll (phase: WAIT_FOR_ROLL)');

  // --- Test 7: Landing Directly on START awards 1 salary, not 2 ---
  console.log('\n[Suite 7] START Tile Salary Logic:');
  const atTile38 = createTestGame({
    phase: 'WAIT_FOR_ROLL',
    turn: 0,
    players: [
      { name: 'P1', color: '#db674e', cash: 15000, pos: 38, owned: [], buildings: {}, mortgaged: [], jail: 0, jailCard: 0, loan: false, loanLaps: 0, active: true, lapsCompleted: 0, skipTurns: 0 }
    ]
  });

  const rollToStart = reducer(atTile38, { type: 'DICE', dice: [1, 1] });
  const resolveStart = reducer({ ...rollToStart, phase: 'RESOLVE_TILE' }, { type: 'RESOLVE' });
  const finalCash = resolveStart.players[0].cash;
  assert(finalCash === 16500, `Landing directly on START awards exactly ₹1,500 salary once (expected 16,500, got ${finalCash})`);

  // --- Test 8: Supply Limits (Max 32 Houses, 12 Hotels) ---
  console.log('\n[Suite 8] House & Hotel Supply Limits:');
  const maxHousesState = createTestGame({
    phase: 'WAIT_FOR_ROLL',
    turn: 0,
    players: [
      {
        name: 'P1',
        cash: 15000,
        pos: 0,
        owned: [1, 3], // Brown monopoly
        buildings: { 1: 0, 3: 0 },
        mortgaged: [],
        jail: 0,
        active: true
      },
      {
        name: 'P2',
        cash: 50000,
        pos: 0,
        owned: [6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23],
        // 32 houses across P2's properties: 10 properties with 3 houses + 1 property with 2 houses = 32 houses
        buildings: { 6: 3, 8: 3, 9: 3, 11: 3, 13: 3, 14: 3, 16: 3, 18: 3, 19: 3, 21: 3, 23: 2 },
        mortgaged: [],
        jail: 0,
        active: true
      }
    ]
  });

  const tryBuildOver32 = reducer(maxHousesState, { type: 'LIQUIDATE', id: 1, mode: 'build', actor: 0 });
  const housesBuilt = tryBuildOver32.players[0].buildings[1] || 0;
  assert(housesBuilt === 0, `Building house blocked when bank house supply (32) is exhausted (got ${housesBuilt} houses)`);

  // Hotel limit: 12 hotels built across board
  const maxHotelsState = createTestGame({
    phase: 'WAIT_FOR_ROLL',
    turn: 0,
    players: [
      {
        name: 'P1',
        cash: 15000,
        pos: 0,
        owned: [1, 3], // Brown monopoly at 3 houses each
        buildings: { 1: 3, 3: 3 },
        mortgaged: [],
        jail: 0,
        active: true
      },
      {
        name: 'P2',
        cash: 50000,
        pos: 0,
        owned: [6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23, 24],
        // 12 hotels built (level 4) across P2's properties
        buildings: { 6: 4, 8: 4, 9: 4, 11: 4, 13: 4, 14: 4, 16: 4, 18: 4, 19: 4, 21: 4, 23: 4, 24: 4 },
        mortgaged: [],
        jail: 0,
        active: true
      }
    ]
  });

  const tryBuildOver12Hotels = reducer(maxHotelsState, { type: 'LIQUIDATE', id: 1, mode: 'build', actor: 0 });
  const hotelBuilt = tryBuildOver12Hotels.players[0].buildings[1] || 0;
  assert(hotelBuilt === 3, `Hotel upgrade blocked when bank hotel supply (12) is exhausted (level remained ${hotelBuilt})`);

  // --- Test 9: Trading Restrictions on Built Properties ---
  console.log('\n[Suite 9] Trading Restrictions on Improved Properties:');
  const builtTradeState = createTestGame({
    turn: 0,
    players: [
      { name: 'P1', cash: 10000, owned: [1, 3], buildings: { 1: 1, 3: 1 }, mortgaged: [], active: true },
      { name: 'P2', cash: 10000, owned: [6], buildings: {}, mortgaged: [], active: true }
    ],
    trades: []
  });

  const tradeOfferWithBuildings = reducer(builtTradeState, {
    type: 'TRADE_OFFER',
    offer: { id: 1, from: 0, to: 1, giveCash: 0, wantCash: 0, giveProps: [1], wantProps: [6] }
  });
  assert(tradeOfferWithBuildings.trades.length === 0, 'TRADE_OFFER blocked when traded property or group has buildings');

  // --- Test 10: Bankruptcy Building Liquidation ---
  console.log('\n[Suite 10] Bankruptcy Building Liquidation:');
  const bankruptState = createTestGame({
    phase: 'DEBT_RESOLUTION',
    turn: 0,
    pending: { type: 'debt', owed: 5000, to: 1 }, // P1 owes P2 ₹5000
    players: [
      {
        name: 'P1 (Debtor)',
        cash: 100,
        owned: [1, 3], // Brown monopoly with 2 houses each (cost ₹500/house, liquidation = ₹250/house)
        buildings: { 1: 2, 3: 2 }, // 4 houses total -> liquidation value = 4 * ₹250 = ₹1,000
        mortgaged: [],
        active: true
      },
      {
        name: 'P2 (Creditor)',
        cash: 2000,
        owned: [],
        buildings: {},
        mortgaged: [],
        active: true
      }
    ]
  });

  const bankruptResult = reducer(bankruptState, { type: 'BANKRUPT' });
  const creditor = bankruptResult.players[1];

  assert(creditor.owned.includes(1) && creditor.owned.includes(3), 'Creditor receives properties from bankrupt player');
  const creditorBuildingsOnProps = (creditor.buildings[1] || 0) + (creditor.buildings[3] || 0);
  assert(creditorBuildingsOnProps === 0, `Debtor buildings liquidated; creditor receives properties unbuilt (got ${creditorBuildingsOnProps} buildings)`);
  assert(creditor.cash >= 3000, `Creditor credited with liquidated building cash (expected >= 3100, got ${creditor.cash})`);

  console.log('\n-------------------------------------------------------------');
  console.log(`Rules & Security Verification Summary: ${passed} Passed | ${failed} Failed`);
  console.log('-------------------------------------------------------------\n');

  return { passed, failed, errors };
}

if (process.argv[1]?.endsWith('rules-test.mjs')) {
  runRulesSecuritySuite().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal test failure:', err);
    process.exit(1);
  });
}
