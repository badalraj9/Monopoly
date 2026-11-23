import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer } from './websocket.js';

export function startRoomServer(port = Number(process.env.PORT || 8787)) {
const wss = new WebSocketServer({ host: '0.0.0.0', port });
const rooms = new Map();
const propertyPrices = Object.fromEntries([[1,600],[3,600],[6,1000],[8,1000],[9,1200],[11,1400],[13,1400],[14,1600],[16,1800],[18,1800],[19,2000],[21,2200],[23,2200],[24,2400],[26,2600],[27,2600],[29,2800],[31,3000],[32,3000],[34,3200],[37,3500],[39,4000]]);
const upgradeCost = id => id <= 3 ? 500 : id <= 9 ? 500 : id <= 14 ? 1000 : id <= 19 ? 1000 : id <= 24 ? 1500 : id <= 29 ? 1500 : 2000;
const code = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''); };
const send = (socket, data) => socket.readyState === 1 && socket.send(JSON.stringify(data));
const broadcast = (room, data) => room.seats.forEach(seat => send(seat.socket, data));
function snapshot(room) {
  return { type: 'room', code: room.code, players: room.seats.map(({ name, index, socket }) => ({ name, index, online: socket?.readyState === 1 })), activeSeat: room.activeSeat, game: room.game, stateVersion: room.stateVersion };
}
function enqueue(room, task) {
  room.queue = room.queue.then(task).catch(error => console.error('room queue:', error));
}
wss.on('connection', socket => {
  socket.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(socket, { type: 'error', message: 'Invalid message.' }); }
    if (msg.type === 'create' || msg.type === 'join' || msg.type === 'resume') {
      let room, seat;
      if (msg.type === 'resume') {
        for (const candidate of rooms.values()) {
          if (msg.code && candidate.code !== String(msg.code).toUpperCase()) continue;
          seat = candidate.seats.find(s => s.token === msg.token);
          if (seat) { room = candidate; break; }
        }
        if (!seat) return send(socket, { type: 'error', message: 'That player session has expired.' });
        if (seat.socket && seat.socket !== socket) seat.socket.close();
        seat.socket = socket;
      } else if (msg.type === 'create') {
        let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
        room = { code: roomCode, seats: [], activeSeat: 0, game: null, queue: Promise.resolve(), rollInFlight: false, rollId: 0, stateVersion: 0, lastActive: Date.now() };
        rooms.set(roomCode, room);
      } else {
        room = rooms.get(String(msg.code || '').toUpperCase());
        if (!room) return send(socket, { type: 'error', message: 'Room not found.' });
        if (room.game?.players?.length) return send(socket, { type: 'error', message: 'This game has already started. Reconnect with your player token.' });
        if (room.seats.length >= 6) return send(socket, { type: 'error', message: 'This room already has six players.' });
      }
      if (msg.type !== 'resume') {
        const token = randomUUID();
        seat = { token, name: String(msg.nickname || 'Player').trim().slice(0, 24) || 'Player', index: room.seats.length, socket };
        room.seats.push(seat);
      }
      seat.socket = socket;
      socket.roomCode = room.code; socket.playerToken = seat.token;
      room.lastActive = Date.now(); room.stateVersion++;
      send(socket, { ...snapshot(room), type: 'joined', playerToken: seat.token, seat: seat.index, invite: `${msg.origin || ''}/join/${room.code}` });
      broadcast(room, snapshot(room));
      return;
    }
    const room = rooms.get(socket.roomCode);
    if (!room) return send(socket, { type: 'error', message: 'Join a room first.' });
    const seat = room.seats.find(s => s.token === socket.playerToken);
    if (!seat) return send(socket, { type: 'error', message: 'Player seat is no longer active.' });
    enqueue(room, async () => {
      room.lastActive = Date.now();
      const turnActions = new Set(['roll', 'resolve', 'buy', 'pass', 'endTurn', 'jailChoice', 'gameState']);
      if (turnActions.has(msg.action) && seat.index !== room.activeSeat) {
        return send(socket, { type: 'rejected', reason: 'Only the active player can take a turn action.' });
      }
      if (!turnActions.has(msg.action) && !new Set(['inspect', 'upgrade', 'mortgage', 'unmortgage', 'loan', 'trade', 'gameState', 'manageState', 'auctionState', 'tradeState', 'leaveState']).has(msg.action)) {
        return send(socket, { type: 'rejected', reason: 'Unknown room action.' });
      }
      if (msg.action === 'endTurn' && Number.isInteger(msg.nextSeat)) {
        room.activeSeat = msg.nextSeat;
        if (msg.state && typeof msg.state === 'object') room.game = msg.state;
        room.rollInFlight = false;
      }
      if (msg.action === 'gameState' && msg.state && typeof msg.state === 'object') { room.game = msg.state; if (msg.state.phase !== 'WAIT_FOR_ROLL') room.rollInFlight = false; }
      if (msg.action === 'leaveState') {
        const before = room.game, next = msg.state, oldPlayer = before?.players?.[seat.index], newPlayer = next?.players?.[seat.index];
        if (!before || !next || !oldPlayer?.active || newPlayer?.active || newPlayer.owned.length || newPlayer.cash !== 0 || next.players.some((player,i) => i !== seat.index && JSON.stringify(player) !== JSON.stringify(before.players[i]))) return send(socket, { type: 'rejected', reason: 'A player can only leave their own seat.' });
        room.game = next; room.activeSeat = next.turn; room.rollInFlight = false;
      }
      if (msg.action === 'auctionState') {
        if (room.game?.phase !== 'AUCTION' || room.game.auction?.turn !== seat.index || msg.state?.phase === undefined) return send(socket, { type: 'rejected', reason: 'It is not your auction action.' });
        room.game = msg.state;
      }
      if (msg.action === 'tradeState') {
        const before = room.game, next = msg.state;
        if (!before || !next || next.turn !== before.turn || next.phase !== before.phase || JSON.stringify(next.dice) !== JSON.stringify(before.dice)) return send(socket, { type: 'rejected', reason: 'Room state changed; refresh and try again.' });
        const added = next.trades.filter(t => !before.trades.some(old => old.id === t.id));
        const removed = before.trades.filter(t => !next.trades.some(current => current.id === t.id));
        if (added.length === 1 && removed.length === 0) {
          const offer = added[0], from = before.players[offer.from], to = before.players[offer.to];
          if (offer.from !== seat.index || !from || !to || from.cash < offer.giveCash || to.cash < offer.wantCash || offer.giveProps.some(id => !from.owned.includes(id)) || offer.wantProps.some(id => !to.owned.includes(id))) return send(socket, { type: 'rejected', reason: 'That offer is no longer available.' });
        } else if (added.length === 0 && removed.length === 1) {
          const offer = removed[0];
          if (offer.to !== seat.index && offer.from !== seat.index) return send(socket, { type: 'rejected', reason: 'Only a trade participant can close this offer.' });
          if (next.players.some((player,i) => i !== offer.from && i !== offer.to && JSON.stringify(player) !== JSON.stringify(before.players[i]))) return send(socket, { type: 'rejected', reason: 'A trade cannot alter another seat.' });
          if (next.players[offer.from].owned.length + next.players[offer.to].owned.length !== before.players[offer.from].owned.length + before.players[offer.to].owned.length) return send(socket, { type: 'rejected', reason: 'Trade property transfer is invalid.' });
        } else return send(socket, { type: 'rejected', reason: 'Invalid trade update.' });
        room.game = next;
      }
      if (msg.action === 'roll') {
        if (room.rollInFlight || room.game?.phase !== 'WAIT_FOR_ROLL') return send(socket, { type: 'rejected', reason: 'The current turn is not ready for a roll.' });
        room.rollInFlight = true;
        const dice = [randomInt(1, 7), randomInt(1, 7)];
        const consecutiveDoubles = dice[0] === dice[1] ? (room.game.rolls || 0) + 1 : 0;
        broadcast(room, { type: 'action', action: 'dice', by: seat.index, dice, consecutiveDoubles, rollId: ++room.rollId, activeSeat: room.activeSeat, stateVersion: ++room.stateVersion });
        return;
      }
      if (msg.action === 'manageState') {
        const before = room.game, next = msg.state, oldPlayer = before?.players?.[seat.index], newPlayer = next?.players?.[seat.index];
        if (!before || !next || !oldPlayer || !newPlayer || next.turn !== before.turn || next.phase !== before.phase || JSON.stringify(next.dice) !== JSON.stringify(before.dice) || next.players.length !== before.players.length || next.players.some((p,i) => i !== seat.index && JSON.stringify(p) !== JSON.stringify(before.players[i]))) return send(socket, { type: 'rejected', reason: 'Room state changed; refresh and try again.' });
        if (JSON.stringify(newPlayer.owned) !== JSON.stringify(oldPlayer.owned) || newPlayer.pos !== oldPlayer.pos || newPlayer.active !== oldPlayer.active || newPlayer.loan !== oldPlayer.loan || newPlayer.name !== oldPlayer.name) return send(socket, { type: 'rejected', reason: 'Only property management is allowed outside your turn.' });
        const levels = new Set([...Object.keys(oldPlayer.buildings), ...Object.keys(newPlayer.buildings)]);
        const changedLevels = [...levels].filter(id => (oldPlayer.buildings[id] || 0) !== (newPlayer.buildings[id] || 0));
        const mortgagesAdded = newPlayer.mortgaged.filter(id => !oldPlayer.mortgaged.includes(id));
        const mortgagesRemoved = oldPlayer.mortgaged.filter(id => !newPlayer.mortgaged.includes(id));
        const changedMortgage = mortgagesAdded.length + mortgagesRemoved.length;
        if (changedLevels.length + changedMortgage !== 1) return send(socket, { type: 'rejected', reason: 'Only one owned asset can be changed per action.' });
        const id = Number(changedLevels[0] ?? mortgagesAdded[0] ?? mortgagesRemoved[0]);
        if (!oldPlayer.owned.includes(id) || !propertyPrices[id]) return send(socket, { type: 'rejected', reason: 'You can only manage a property you own.' });
        const delta = newPlayer.cash - oldPlayer.cash;
        if (changedLevels.length) {
          const diff = (newPlayer.buildings[id] || 0) - (oldPlayer.buildings[id] || 0), cost = upgradeCost(id);
          if (Math.abs(diff) !== 1 || (diff > 0 && (oldPlayer.cash < cost || oldPlayer.mortgaged.includes(id))) || delta !== (diff > 0 ? -cost : Math.floor(cost / 2))) return send(socket, { type: 'rejected', reason: 'Invalid building transaction.' });
        } else if (mortgagesAdded.length) {
          if (delta !== Math.floor(propertyPrices[id] / 2) || (oldPlayer.buildings[id] || 0) > 0 || oldPlayer.mortgaged.includes(id)) return send(socket, { type: 'rejected', reason: 'Invalid mortgage transaction.' });
        } else if (delta !== -Math.floor(propertyPrices[id] * .55) || !oldPlayer.mortgaged.includes(id)) return send(socket, { type: 'rejected', reason: 'Invalid unmortgage transaction.' });
        room.game = next;
      }
      if (msg.action === 'loan' && room.game?.players?.[seat.index]?.loan) return send(socket, { type: 'rejected', reason: 'This player has already taken a loan.' });
      const event = { type: 'action', action: msg.action, payload: msg.payload, by: seat.index, nickname: seat.name, activeSeat: room.activeSeat, game: room.game };
      broadcast(room, { ...event, stateVersion: ++room.stateVersion });
    });
  });
  socket.on('close', () => {
    const room = rooms.get(socket.roomCode);
    if (room) { room.lastActive = Date.now(); room.stateVersion++; broadcast(room, { ...snapshot(room), type: 'presence', disconnected: socket.playerToken }); }
  });
});
setInterval(() => { const now = Date.now(); for (const [key, room] of rooms) { const empty = room.seats.every(seat => seat.socket?.readyState !== 1); const finished = room.game?.phase === 'GAME_OVER'; if ((empty || finished) && now - room.lastActive >= 30 * 60 * 1000) rooms.delete(key); } }, 60 * 1000).unref();
console.log(`Business room server listening on ws://0.0.0.0:${port}`);
return wss;
}
if (process.argv[1]?.toLowerCase().replaceAll('\\','/').endsWith('/server/index.js')) startRoomServer();
