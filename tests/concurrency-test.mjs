/**
 * Concurrency & Redis Hygiene Test Suite for api/room.js
 * 
 * Verifies:
 * 1. Atomic CAS / OCC: Conflicting simultaneous writes with the same expectedVersion
 *    must result in exactly one winner (200) and the loser rejected with HTTP 409 (VERSION_CONFLICT).
 * 2. Stale expectedVersion: Rejected with 409.
 * 3. Matching expectedVersion: Succeeds with 200 and increments stateVersion.
 * 4. Token Security: Session tokens are private; never exposed in public GET /api/room or players array.
 * 5. Cheap unchanged check: GET /api/room?code=CODE&since=V returns { unchanged: true, stateVersion: V }.
 * 6. Code validation: Invalid room codes (length != 4 or invalid chars) rejected with 400.
 * 7. Session reconnect: Resuming with valid token succeeds; invalid token returns 403/404.
 */

import { callApi } from './chaos-test.mjs';

export async function runConcurrencyTests() {
  console.log('\n======================================================');
  console.log('Running Concurrency & Redis Hygiene Verification Suite');
  console.log('======================================================\n');

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

  // --- Test 1: Room Creation & Token Security ---
  console.log('\n[Suite 1] Room Creation & Token Security:');
  const createRes = await callApi('POST', '/api/room?action=create', { nickname: 'Host' });
  assert(createRes.status === 200, 'Host room creation returns 200');
  const code = createRes.data?.code;
  const tokenHost = createRes.data?.token;
  assert(Boolean(code && code.length === 4), `Valid 4-character room code generated: ${code}`);
  assert(Boolean(tokenHost), 'Host received private session token');

  // Verify public GET /api/room does NOT leak tokens
  const publicPoll = await callApi('GET', `/api/room?code=${code}`);
  assert(publicPoll.status === 200, 'Public GET /api/room returns 200');
  const leakedTokens = (publicPoll.data?.players || []).filter(p => p.token);
  assert(leakedTokens.length === 0, 'Public players list does NOT leak any session tokens');

  // Join Player 2 & Player 3
  const joinRes1 = await callApi('POST', '/api/room?action=join', { code, nickname: 'Player 2' });
  const tokenP2 = joinRes1.data?.token;
  assert(joinRes1.status === 200 && Boolean(tokenP2), 'Player 2 joins successfully with private token');

  const joinRes2 = await callApi('POST', '/api/room?action=join', { code, nickname: 'Player 3' });
  const tokenP3 = joinRes2.data?.token;
  assert(joinRes2.status === 200 && Boolean(tokenP3), 'Player 3 joins successfully with private token');

  const joinTokensLeaked = (joinRes2.data?.players || []).filter(p => p.token && p.index !== joinRes2.data.seat);
  assert(joinTokensLeaked.length === 0, 'Join response does NOT leak other players session tokens');

  // --- Test 2: Cheap Since Check ---
  console.log('\n[Suite 2] Cheap Since Check (Redis Hygiene):');
  const initialPoll = await callApi('GET', `/api/room?code=${code}`);
  const baseVersion = initialPoll.data?.stateVersion;
  assert(typeof baseVersion === 'number' && baseVersion > 0, `Base stateVersion is numeric: ${baseVersion}`);

  const unchangedPoll = await callApi('GET', `/api/room?code=${code}&since=${baseVersion}`);
  assert(unchangedPoll.status === 200, 'Since poll returns 200');
  assert(unchangedPoll.data?.unchanged === true, 'Since poll returns unchanged: true when version matches');
  assert(unchangedPoll.data?.game === undefined, 'Unchanged response avoids transmitting heavy game payload');

  // --- Test 3: Simultaneous Conflicting Writes with OCC ---
  console.log('\n[Suite 3] Atomic CAS / Simultaneous Writes:');
  console.log(`Firing 2 concurrent actions with identical expectedVersion: ${baseVersion}...`);

  const [resA, resB] = await Promise.all([
    callApi('POST', '/api/room?action=action', {
      code,
      token: tokenP2,
      action: 'action',
      payload: { bid: 100, by: 'Player 2' },
      expectedVersion: baseVersion
    }),
    callApi('POST', '/api/room?action=action', {
      code,
      token: tokenP3,
      action: 'action',
      payload: { bid: 150, by: 'Player 3' },
      expectedVersion: baseVersion
    })
  ]);

  console.log(`Action A response: status=${resA.status}`, resA.data);
  console.log(`Action B response: status=${resB.status}`, resB.data);

  const statuses = [resA.status, resB.status];
  const hasWinner = statuses.includes(200);
  const hasConflict = statuses.includes(409);

  assert(hasWinner, 'One simultaneous action successfully won with 200');
  assert(hasConflict, 'Competing simultaneous action was rejected with HTTP 409 conflict');

  const conflictRes = resA.status === 409 ? resA : resB;
  assert(conflictRes.data?.code === 'VERSION_CONFLICT', 'Conflict response returned code: VERSION_CONFLICT');
  assert(typeof conflictRes.data?.currentVersion === 'number', 'Conflict response returned authoritative currentVersion');

  // Check new version after simultaneous writes
  const afterConflictPoll = await callApi('GET', `/api/room?code=${code}`);
  const newVersion = afterConflictPoll.data?.stateVersion;
  assert(newVersion === baseVersion + 1, `stateVersion strictly incremented by exactly 1: ${baseVersion} -> ${newVersion}`);

  // --- Test 4: Stale ExpectedVersion Rejection ---
  console.log('\n[Suite 4] Stale ExpectedVersion Rejection:');
  const staleRes = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP3,
    action: 'action',
    payload: { bid: 200, by: 'Player 3' },
    expectedVersion: baseVersion // Stale version!
  });
  assert(staleRes.status === 409, 'Stale expectedVersion was rejected with HTTP 409');
  assert(staleRes.data?.code === 'VERSION_CONFLICT', 'Stale response contains code: VERSION_CONFLICT');

  // --- Test 5: Sequential Valid Write ---
  console.log('\n[Suite 5] Sequential Valid Write with Correct Version:');
  const validRes = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenP3,
    action: 'action',
    payload: { bid: 250, by: 'Player 3' },
    expectedVersion: newVersion // Correct version
  });
  assert(validRes.status === 200, 'Valid expectedVersion write succeeds with 200');
  assert(validRes.data?.stateVersion === newVersion + 1, `Version incremented to ${newVersion + 1}`);

  // --- Test 6: Room Code Validation ---
  console.log('\n[Suite 6] Room Code Format Validation:');
  const invalidCode1 = await callApi('GET', '/api/room?code=INVALID_LONG');
  assert(invalidCode1.status === 400, 'Invalid room code length rejected with 400');

  const invalidCode2 = await callApi('GET', '/api/room?code=ab!2');
  assert(invalidCode2.status === 400, 'Invalid room code characters rejected with 400');

  // --- Test 7: Session Resume Recovery ---
  console.log('\n[Suite 7] Session Resume Recovery:');
  const resumeRes = await callApi('POST', '/api/room?action=resume', {
    code,
    token: tokenP2
  });
  assert(resumeRes.status === 200, 'Resume with valid token succeeds with 200');
  assert(resumeRes.data?.seat === 1, 'Resume restores correct seat index (Player 2 = seat 1)');
  assert(resumeRes.data?.token === tokenP2, 'Resume returns player own token');

  const badResume = await callApi('POST', '/api/room?action=resume', {
    code,
    token: '00000000-0000-0000-0000-000000000000'
  });
  assert(badResume.status === 403 || badResume.status === 404, `Invalid token resume rejected with 403/404 (got ${badResume.status})`);

  console.log('\n------------------------------------------------------');
  console.log(`Concurrency Test Summary: ${passed} Passed | ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  return { passed, failed, errors };
}

if (process.argv[1]?.endsWith('concurrency-test.mjs')) {
  runConcurrencyTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal concurrency test failure:', err);
    process.exit(1);
  });
}
