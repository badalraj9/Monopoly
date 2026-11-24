/**
 * Stage 2 Verification Test Suite for api/room.js
 * 
 * Verifies:
 * 1. Seat & Turn Authorization (HTTP 403 on turn mismatch, auction bidder mismatch, trade recipient mismatch).
 * 2. Server-Side Dice Generation (crypto randomInt(1, 7); client-sent forged dice ignored).
 * 3. Rate Limiting per Token (max 10 actions/sec per player token; HTTP 429 on violation).
 * 4. Stuck-State Recovery:
 *    - Auto-clear stuck rollInFlight > 5000ms.
 *    - Action 'skipInactive': advance activeSeat after 45s inactivity.
 *    - Host resilience: seat 0 transferred when host leaves.
 */

import { callApi } from './chaos-test.mjs';

export async function runStage2Tests() {
  console.log('\n======================================================');
  console.log('Running Stage 2: Server-Side Validation & Security Suite');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      failed++;
      console.error(`  ❌ FAIL: ${message}`);
      return false;
    } else {
      passed++;
      console.log(`  ✅ PASS: ${message}`);
      return true;
    }
  }

  // Setup: Create room with Host (seat 0), Player 2 (seat 1), Player 3 (seat 2)
  const createRes = await callApi('POST', '/api/room?action=create', { nickname: 'Host' });
  const code = createRes.data?.code;
  const tokenHost = createRes.data?.token;

  const join2 = await callApi('POST', '/api/room?action=join', { code, nickname: 'Player 2' });
  const tokenP2 = join2.data?.token;

  const join3 = await callApi('POST', '/api/room?action=join', { code, nickname: 'Player 3' });
  const tokenP3 = join3.data?.token;

  // Initial gameState: active turn is 0 (Host)
  const game = {
    turn: 0,
    phase: 'WAIT_FOR_ROLL',
    rolls: 0,
    players: [
      { name: 'Host', active: true, cash: 15000, pos: 0, owned: [] },
      { name: 'Player 2', active: true, cash: 15000, pos: 0, owned: [] },
      { name: 'Player 3', active: true, cash: 15000, pos: 0, owned: [] }
    ],
    auction: { turn: 1, bid: 100 },
    trades: [{ id: 'trade-1', from: 0, to: 1, giveProps: [1], wantCash: 500 }]
  };

  await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenHost,
    action: 'gameState',
    state: game
  });

  // --- Suite 1: Seat & Turn Authorization ---
  console.log('\n[Suite 1] Seat & Turn Authorization:');

  // Player 2 attempts 'roll' when turn is Host (0) -> 403
  const rogueRoll = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP2,
    action: 'roll'
  });
  assert(rogueRoll.status === 403, 'Unauthorized roll by non-active player rejected with 403');
  assert(rogueRoll.data?.error === 'Not your turn to act.', 'Error message: Not your turn to act.');

  // Player 3 attempts 'endTurn' when turn is Host (0) -> 403
  const rogueEnd = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP3,
    action: 'endTurn',
    nextSeat: 1
  });
  assert(rogueEnd.status === 403, 'Unauthorized endTurn by non-active player rejected with 403');

  // Host (seat 0) rolls -> succeeds (200)
  const hostRoll = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenHost,
    action: 'roll'
  });
  assert(hostRoll.status === 200, 'Authorized roll by active turn player succeeds with 200');

  // Auction Bid: auction.turn is 1 (Player 2). Player 3 attempts to bid -> 403
  const rogueBid = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP3,
    action: 'auctionBid',
    bid: 200
  });
  assert(rogueBid.status === 403, 'Auction bid by wrong bidder seat rejected with 403');

  // Trade response: trade recipient is seat 1 (Player 2). Player 3 attempts to accept -> 403
  const rogueTrade = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP3,
    action: 'tradeAccept',
    tradeId: 'trade-1'
  });
  assert(rogueTrade.status === 403, 'Trade response by non-recipient seat rejected with 403');

  // --- Suite 2: Server-Side Dice Generation ---
  console.log('\n[Suite 2] Server-Side Dice Generation:');
  // Client attempts to forge dice as [6, 6]
  let forgedMatches = 0;
  for (let i = 0; i < 20; i++) {
    const rollReq = await callApi('POST', '/api/room?action=action', {
      code,
      token: tokenHost,
      action: 'roll',
      dice: [6, 6] // Forged dice
    });
    const rolledDice = rollReq.data?.lastAction?.dice;
    if (rolledDice && rolledDice[0] === 6 && rolledDice[1] === 6) {
      forgedMatches++;
    }
  }
  // If dice were client-trusted, forgedMatches would be 20/20.
  // With true random crypto dice, p(both 6) = 1/36 (~2.7%). In 20 rolls, probability of 20 consecutive [6,6] is (1/36)^20 ≈ 0.
  assert(forgedMatches < 10, `Client-sent forged dice ignored; server generates crypto dice (${forgedMatches}/20 rolled [6,6])`);

  // --- Suite 3: Rate Limiting per Token ---
  console.log('\n[Suite 3] Rate Limiting per Token:');
  // Create dedicated player for rate limit test (do not send bypass header)
  const rlRoom = await callApi('POST', '/api/room?action=create', { nickname: 'Speedy' }, { 'x-bypass-rate-limit': '' });
  const rlCode = rlRoom.data?.code;
  const rlToken = rlRoom.data?.token;

  const rlRequests = [];
  for (let i = 0; i < 15; i++) {
    rlRequests.push(
      callApi('POST', '/api/room?action=action', {
        code: rlCode,
        token: rlToken,
        action: 'roll'
      }, { 'x-bypass-rate-limit': '' })
    );
  }
  const rlResponses = await Promise.all(rlRequests);
  const rateLimited = rlResponses.filter(r => r.status === 429);
  assert(rateLimited.length > 0, `Rate limit triggered HTTP 429 on rapid burst (${rateLimited.length} requests throttled)`);
  assert(rateLimited[0]?.data?.error === 'Rate limit exceeded, please slow down.', '429 error message verified');

  // --- Suite 4: Stuck-State Recovery ---
  console.log('\n[Suite 4] Stuck-State Recovery:');

  // 4a. Auto-clear stuck rollInFlight older than 5,000ms
  // Simulate stuck roll in room
  const stuckRoom = await callApi('POST', '/api/room?action=create', { nickname: 'StuckHost' });
  const stuckCode = stuckRoom.data?.code;
  const stuckToken = stuckRoom.data?.token;

  // Artificially simulate stuck roll in storage
  const memoryStore = globalThis.__monopoly_store?.store;
  if (memoryStore) {
    const raw = memoryStore.get(`monopoly:room:${stuckCode}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.rollInFlight = true;
      parsed.rollStartTime = Date.now() - 10000; // 10s ago (> 5000ms)
      memoryStore.set(`monopoly:room:${stuckCode}`, JSON.stringify(parsed));
    }
  }

  // Fetch room; getRoomFromStorage should auto-clear stuck roll
  const clearedPoll = await callApi('GET', `/api/room?code=${stuckCode}`);
  assert(clearedPoll.status === 200, 'Room fetched successfully');
  const memRawAfter = memoryStore ? JSON.parse(memoryStore.get(`monopoly:room:${stuckCode}`) || '{}') : {};
  assert(memRawAfter.rollInFlight === false, 'Stuck rollInFlight (> 5000ms) was automatically cleared');

  // 4b. Action 'skipInactive':
  // Inactive < 45s -> 400
  const skipTooSoon = await callApi('POST', '/api/room?action=action', {
    code: stuckCode,
    token: stuckToken,
    action: 'skipInactive'
  });
  assert(skipTooSoon.status === 400, 'skipInactive rejected with 400 when inactive < 45s');

  // Set lastActive to 50s ago
  if (memoryStore) {
    const raw = memoryStore.get(`monopoly:room:${stuckCode}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.lastActive = Date.now() - 50000;
      parsed.activeSeat = 0;
      parsed.seats = [
        { token: stuckToken, name: 'StuckHost', index: 0 },
        { token: 'token-p2', name: 'Player 2', index: 1 }
      ];
      memoryStore.set(`monopoly:room:${stuckCode}`, JSON.stringify(parsed));
    }
  }

  const skipSuccess = await callApi('POST', '/api/room?action=action', {
    code: stuckCode,
    token: stuckToken,
    action: 'skipInactive'
  });
  assert(skipSuccess.status === 200, 'skipInactive succeeds after 45s inactivity');
  assert(skipSuccess.data?.activeSeat === 1, 'Active seat advanced to next player (seat 0 -> seat 1)');

  // 4c. Host resilience: Host leaves, seat 0 transferred
  const leaveRes = await callApi('POST', '/api/room?action=action', {
    code: stuckCode,
    token: stuckToken,
    action: 'leave'
  });
  assert(leaveRes.status === 200, 'Host leave action succeeds with 200');
  assert(leaveRes.data?.players?.[0]?.name === 'Player 2', 'Seat 0 transferred to next remaining player (Player 2)');
  assert(leaveRes.data?.players?.[0]?.index === 0, 'New host correctly occupies seat 0');

  console.log('\n------------------------------------------------------');
  console.log(`Stage 2 Test Summary: ${passed} Passed | ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  return { passed, failed };
}

if (process.argv[1]?.endsWith('stage2-test.mjs')) {
  runStage2Tests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal Stage 2 test failure:', err);
    process.exit(1);
  });
}
