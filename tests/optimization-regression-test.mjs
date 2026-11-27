import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { callApi } from './chaos-test.mjs';
import { MEMORY_ROOMS } from '../api/room.js';

function compile(source, globals = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  runInNewContext(outputText, { exports, ...globals });
  return exports;
}

const fromFile = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const { board } = compile(fromFile('../src/data/board.ts'));
const cards = compile(fromFile('../src/data/cards.ts'));
const app = fromFile('../src/App.tsx');
const { blank, defaults, reducer, buildGameUpdate } = compile(
  app.slice(app.indexOf('const defaults:'), app.indexOf('// TileIcon memoized')) +
    '\nObject.assign(exports, { blank, defaults, reducer, buildGameUpdate });',
  { board, ...cards, money: String }
);
const { submitRoomAction } = compile(fromFile('../src/utils/roomSync.ts'));

const post = (action, body) => callApi('POST', '/api/room?action=' + action, body);
const act = (session, action, fields = {}) => post('action', { ...session, action, ...fields });
const poll = (code, since, headers) => callApi('GET', '/api/room?code=' + code + (since == null ? '' : '&since=' + since), null, headers);
const start = (names, features = {}) => reducer(blank(), {
  type: 'START', players: names.map(name => ({ name })), cash: 15000, features: { ...defaults, ...features }
});
const create = async nickname => {
  const result = await post('create', { nickname });
  assert.equal(result.status, 200);
  return { code: result.data.code, token: result.data.token };
};
const join = async (host, nickname) => {
  const result = await post('join', { code: host.code, nickname });
  assert.equal(result.status, 200);
  return { code: host.code, token: result.data.token };
};

{
  const host = await create('Alice');
  const guest = await join(host, 'Blair');
  await join(host, 'Casey');
  const starting = start(['Alice', 'Blair', 'Casey']);
  await act(host, 'gameState', { state: starting });
  let current = (await poll(host.code, null, { authorization: 'Bearer ' + guest.token })).data;
  const offer = (id, from, to) => ({
    type: 'TRADE_OFFER', offer: { id, from, to, giveCash: 100, wantCash: 0, giveProps: [], wantProps: [], giveJailCard: 0, wantJailCard: 0 }
  });

  const first = buildGameUpdate({ ...current, seat: 0 }, starting, offer(1, 0, 1));
  assert.equal((await act(host, first.action, { state: first.state, expectedVersion: current.stateVersion })).status, 200);
  let conflicts = 0;
  const second = await submitRoomAction(
    () => ({ ...buildGameUpdate(current, starting, offer(2, 1, 2)), expectedVersion: current.stateVersion }),
    async update => {
      const result = await act(guest, update.action, update);
      if (result.status === 409) {
        conflicts += 1;
        return { conflict: true };
      }
      assert.equal(result.status, 200);
      return { conflict: false, data: result.data };
    },
    async () => { current = (await poll(host.code, null, { authorization: 'Bearer ' + guest.token })).data; }
  );
  assert.equal(conflicts, 1);
  assert.deepEqual(second.game.trades.map(trade => trade.id), [1, 2]);

  const key = 'monopoly:room:' + host.code;
  const stored = JSON.parse(MEMORY_ROOMS.get(key));
  stored.lastActive -= 46000;
  stored.lastAction.time = stored.lastActive;
  MEMORY_ROOMS.set(key, JSON.stringify(stored));
  const skipped = await act(guest, 'skipInactive', { expectedVersion: second.stateVersion });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.data.game.turn, 1);
  assert.equal(skipped.data.activeSeat, 1);
  assert.equal((await poll(host.code, skipped.data.stateVersion)).data.unchanged, true);

  const departed = await act(host, 'leave');
  assert.equal(departed.status, 200);
  assert.equal(departed.data.hostSeat, 1);
  assert.equal(departed.data.game.turn, 1);
  assert.equal(departed.data.game.players[0].active, false);
  assert.equal((await act(guest, 'endGame')).status, 200);
  console.log('Passed concurrent trade replay, skip acknowledgement, and in-match host transfer.');
}

{
  const host = await create('Host');
  const firstGuest = await join(host, 'Guest 1');
  const secondGuest = await join(host, 'Guest 2');
  assert.equal((await act(firstGuest, 'leave')).status, 200);
  await join(host, 'Guest 3');
  const snapshot = (await poll(host.code, null, { authorization: 'Bearer ' + secondGuest.token })).data;
  assert.equal(snapshot.seat, 1);
  assert.deepEqual(snapshot.players.map(player => player.index), [0, 1, 2]);
  console.log('Passed lobby seat reassignment.');
}

{
  const game = start(['A', 'B'], { auctions: false });
  game.players[0].pos = 1;
  game.phase = 'RESOLVE_TILE';
  const purchase = reducer(game, { type: 'RESOLVE' });
  assert.equal(purchase.pending.type, 'buy');
  assert.equal(reducer(purchase, { type: 'PASS' }).phase, 'END_TURN');
  assert.equal(reducer(purchase, { type: 'BUY' }).players[0].owned[0], 1);

  const jail = start(['A', 'B']);
  jail.players[0].pos = 24;
  const move = reducer(jail, { type: 'DICE', dice: [3, 3] });
  const detained = reducer(reducer(move, { type: 'TICK' }), { type: 'RESOLVE' });
  assert.equal(reducer(detained, { type: 'END' }).turn, 1);

  const debt = start(['A', 'B']);
  Object.assign(debt.players[0], { pos: 10, jail: 3, cash: 300, owned: [31] });
  const unpaid = reducer(debt, { type: 'DICE', dice: [2, 3] });
  const raised = reducer(unpaid, { type: 'LIQUIDATE', id: 31, mode: 'mortgage' });
  const paid = reducer(raised, { type: 'PAY' });
  assert.equal(paid.players[0].cash, 1300);
  assert.equal(paid.players[0].pos, 15);
  console.log('Passed purchase with auctions disabled and both Jail regressions.');
}

{
  const originalFetch = globalThis.fetch;
  const commands = [];
  const headers = { 'x-upstash-url': 'https://example.invalid', 'x-upstash-token': 'test' };
  try {
    globalThis.fetch = async (_url, { body }) => {
      const args = JSON.parse(body);
      commands.push(args);
      return { ok: true, json: async () => ({ result: '12|0' }) };
    };
    const result = await poll('ABCD', 12, headers);
    assert.deepEqual(result.data, { unchanged: true, stateVersion: 12 });
    assert.deepEqual(commands, [['GET', 'monopoly:ver:ABCD']]);

    globalThis.fetch = async () => { throw new Error('simulated storage outage'); };
    const outage = await poll('ABCD', 12, headers);
    assert.equal(outage.status, 503);
    assert.equal(outage.data.closed, undefined);
    console.log('Passed one-command polling and retryable storage failure.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
