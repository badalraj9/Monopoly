import { callApi } from './chaos-test.mjs';
import { MEMORY_ROOMS } from '../api/room.js';
import { startRoomServer } from '../server/index.js';
import { EventEmitter } from 'node:events';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  } else {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// In-Memory WebSocket Mock Socket
class MockWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1; // OPEN
    this.sentMessages = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
  }

  send(data) {
    if (this.readyState !== 1) return;
    try {
      this.sentMessages.push(JSON.parse(data));
    } catch {
      this.sentMessages.push(data);
    }
  }

  ping() {}

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3; // CLOSED
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close');
  }

  // Helper to send message from client to server
  clientSend(obj) {
    this.emit('message', Buffer.from(JSON.stringify(obj)));
  }

  async waitForMessage(predicate, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const idx = this.sentMessages.findIndex(predicate);
      if (idx !== -1) {
        return this.sentMessages.splice(idx, 1)[0];
      }
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('Timeout waiting for message');
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('Running End Game & Immediate Resource Release Test Suite');
  console.log('======================================================\n');

  // --- Suite 1: HTTP API (api/room.js) ---
  console.log('[Suite 1] HTTP Serverless End Game & Resource Release:');

  const createRes = await callApi('POST', '/api/room?action=create', { nickname: 'Host' });
  assert(createRes.status === 200, 'Host created room');
  const code = createRes.data?.code;
  const tokenHost = createRes.data?.token;

  const joinRes = await callApi('POST', '/api/room?action=join', { code, nickname: 'Guest' });
  assert(joinRes.status === 200, 'Guest joined room');
  const tokenGuest = joinRes.data?.token;

  // Guest attempts to end the game -> should be rejected with 403
  const guestEndRes = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenGuest,
    action: 'endGame'
  });
  assert(guestEndRes.status === 403, 'Non-host endGame action rejected with HTTP 403');
  assert(guestEndRes.data?.error?.includes('host'), 'Error indicates only host can end game');

  // Verify room is still intact and accessible
  const pollBefore = await callApi('GET', `/api/room?code=${code}`);
  assert(pollBefore.status === 200, 'Room still active and accessible via GET before close');

  // Host calls endGame
  const hostEndRes = await callApi('POST', '/api/room?action=action', {
    code,
    token: tokenHost,
    action: 'endGame'
  });
  assert(hostEndRes.status === 200, 'Host endGame succeeds with HTTP 200');
  assert(hostEndRes.data?.closed === true, 'Response confirms closed: true');
  assert(hostEndRes.data?.success === true, 'Response confirms success: true');

  // Subsequent GET polling returns 404 with closed: true
  const pollAfter = await callApi('GET', `/api/room?code=${code}`);
  assert(pollAfter.status === 404, 'GET polling after close returns HTTP 404');
  assert(pollAfter.data?.closed === true, 'GET response includes closed: true');
  assert(pollAfter.data?.error?.includes('closed by the host'), 'GET error mentions closed by the host');

  // Verify resources deleted from MEMORY_ROOMS
  assert(!MEMORY_ROOMS.has(code), `Room code ${code} deleted from MEMORY_ROOMS`);
  assert(!MEMORY_ROOMS.has(`monopoly:room:${code}`), `Room key deleted from MEMORY_ROOMS`);
  assert(!MEMORY_ROOMS.has(`monopoly:ver:${code}`), `Ver key deleted from MEMORY_ROOMS`);
  assert(!MEMORY_ROOMS.has(`monopoly:token:${tokenHost}`), `Host token deleted from MEMORY_ROOMS`);
  assert(!MEMORY_ROOMS.has(`monopoly:token:${tokenGuest}`), `Guest token deleted from MEMORY_ROOMS`);

  // Attempting to join closed room returns 404
  const joinClosed = await callApi('POST', '/api/room?action=join', { code, nickname: 'Latecomer' });
  assert(joinClosed.status === 404, 'Joining closed room returns HTTP 404');


  // --- Suite 2: WebSocket Server (server/index.js) ---
  console.log('\n[Suite 2] WebSocket Server End Game & Immediate Teardown:');

  // Use a mock wss to feed connections directly into startRoomServer
  const wss = startRoomServer(0); // port 0 or bind

  const hostSocket = new MockWebSocket();
  wss.emit('connection', hostSocket);

  hostSocket.clientSend({ type: 'create', nickname: 'WSHost' });
  const hostJoined = await hostSocket.waitForMessage(m => m.type === 'joined');
  assert(hostJoined.seat === 0, 'WSHost joined as seat 0');
  const wsCode = hostJoined.code;

  const guestSocket = new MockWebSocket();
  wss.emit('connection', guestSocket);

  guestSocket.clientSend({ type: 'join', code: wsCode, nickname: 'WSGuest' });
  const guestJoined = await guestSocket.waitForMessage(m => m.type === 'joined');
  assert(guestJoined.seat === 1, 'WSGuest joined as seat 1');

  // Guest tries to end the game -> rejected
  guestSocket.clientSend({ action: 'endGame' });
  const guestRejected = await guestSocket.waitForMessage(m => m.type === 'rejected');
  assert(guestRejected.reason?.includes('host'), 'Guest endGame rejected by server');
  assert(!guestSocket.closed, 'Guest socket remains open after rejection');

  // Host sends endGame
  hostSocket.clientSend({ action: 'endGame' });

  // Both clients receive roomClosed broadcast
  const hostClosedMsg = await hostSocket.waitForMessage(m => m.type === 'roomClosed');
  assert(hostClosedMsg.reason?.includes('ended the game'), 'Host received roomClosed broadcast');

  const guestClosedMsg = await guestSocket.waitForMessage(m => m.type === 'roomClosed');
  assert(guestClosedMsg.reason?.includes('ended the game'), 'Guest received roomClosed broadcast');

  // Wait a tick for close to propagate
  await new Promise(r => setTimeout(r, 50));

  assert(hostSocket.closed, 'Host socket closed gracefully by server');
  assert(guestSocket.closed, 'Guest socket closed gracefully by server');
  assert(hostSocket.closeCode === 1000, 'Host socket closed with code 1000');
  assert(guestSocket.closeCode === 1000, 'Guest socket closed with code 1000');
  assert(hostSocket.closeReason === 'Room ended by host', 'Close reason is Room ended by host');

  wss.close();

  console.log(`\n------------------------------------------------------`);
  console.log(`End Game Suite: ${passed} Passed | ${failed} Failed`);
  console.log(`------------------------------------------------------\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
