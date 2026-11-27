import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer } from './websocket.js';
import { initRedis, saveRoom, getRoom, getRoomCodeByToken, deleteRoom, loadAllPersistedRooms, getRedisClient } from './redis.js';
import { advanceTurnForInactivity, removePlayerFromGame } from '../src/utils/playerDeparture.js';

export function startRoomServer(port = Number(process.env.PORT || 8787)) {
  initRedis();
  const wss = new WebSocketServer({ host: '0.0.0.0', port });
  const rooms = new Map();

  // Load existing rooms from Redis persistence upon server start
  loadAllPersistedRooms().then(persisted => {
    for (const r of persisted) {
      if (!rooms.has(r.code)) {
        rooms.set(r.code, {
          ...r,
          seats: r.seats.map(s => ({ ...s, socket: null })),
          queue: Promise.resolve()
        });
      }
    }
    if (persisted.length) {
      console.log(`[Redis] Restored ${persisted.length} room(s) from persistence.`);
    }
  }).catch(err => console.warn('[Redis] Restore rooms warning:', err?.message || err));

  const propertyPrices = Object.fromEntries([[1,600],[3,600],[6,1000],[8,1000],[9,1200],[11,1400],[13,1400],[14,1600],[16,1800],[18,1800],[19,2000],[21,2200],[23,2200],[24,2400],[26,2600],[27,2600],[29,2800],[31,3000],[32,3000],[34,3200],[37,3500],[39,4000]]);
  const upgradeCost = id => id <= 3 ? 500 : id <= 9 ? 500 : id <= 14 ? 1000 : id <= 19 ? 1000 : id <= 24 ? 1500 : id <= 29 ? 1500 : 2000;
  const code = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''); };
  const send = (socket, data) => socket?.readyState === 1 && socket.send(JSON.stringify(data));
  const broadcast = (room, data) => room.seats.forEach(seat => send(seat.socket, data));
  function snapshot(room) {
    return { type: 'room', code: room.code, players: room.seats.map(({ name, index, socket }) => ({ name, index, online: socket?.readyState === 1 })), activeSeat: room.activeSeat, hostSeat: room.hostSeat ?? 0, game: room.game, stateVersion: room.stateVersion, lastAction: room.lastAction };
  }
  function recordAction(room, action, seat) {
    room.lastAction = { action, by: seat.index, nickname: seat.name, time: Date.now() };
    room.stateVersion += 1;
  }
  function clearRollInFlight(room) {
    room.rollInFlight = false;
    room.rollingSeat = null;
    if (room.rollWatchdog) {
      clearTimeout(room.rollWatchdog);
      room.rollWatchdog = null;
    }
  }
  function enqueue(room, task) {
    room.queue = room.queue.then(task).catch(error => console.error('room queue:', error));
  }

  wss.on('connection', socket => {
    const pingInterval = setInterval(() => {
      if (socket.readyState === 1 && typeof socket.ping === 'function') {
        try { socket.ping(); } catch {}
      }
    }, 25000);

    socket.on('message', async raw => {
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
          if (!seat && msg.token) {
            const roomCode = String(msg.code || await getRoomCodeByToken(msg.token) || '').toUpperCase();
            if (roomCode) {
              let candidate = rooms.get(roomCode);
              if (!candidate) {
                const loaded = await getRoom(roomCode);
                if (loaded) {
                  candidate = { ...loaded, seats: loaded.seats.map(s => ({ ...s, socket: null })), queue: Promise.resolve() };
                  rooms.set(candidate.code, candidate);
                }
              }
              if (candidate) {
                seat = candidate.seats.find(s => s.token === msg.token);
                if (seat) room = candidate;
              }
            }
          }
          if (!seat) return send(socket, { type: 'error', message: 'That player session has expired.' });
          if (seat.socket && seat.socket !== socket) seat.socket.close();
          seat.socket = socket;
        } else if (msg.type === 'create') {
          let roomCode;
          do { roomCode = code(); } while (rooms.has(roomCode) || (await getRoom(roomCode)));
          room = { code: roomCode, seats: [], activeSeat: 0, game: null, queue: Promise.resolve(), rollInFlight: false, rollId: 0, stateVersion: 0, lastActive: Date.now() };
          rooms.set(roomCode, room);
        } else {
          const roomCode = String(msg.code || '').toUpperCase();
          room = rooms.get(roomCode);
          if (!room) {
            const restored = await getRoom(roomCode);
            if (restored) {
              room = { ...restored, seats: restored.seats.map(s => ({ ...s, socket: null })), queue: Promise.resolve() };
              rooms.set(room.code, room);
            }
          }
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
        await saveRoom(room);
        send(socket, { ...snapshot(room), type: 'joined', playerToken: seat.token, seat: seat.index, invite: `${msg.origin || ''}/join/${room.code}` });
        broadcast(room, snapshot(room));
        return;
      }
      const room = rooms.get(socket.roomCode);
      if (!room) return send(socket, { type: 'error', message: 'Join a room first.' });
      const seat = room.seats.find(s => s.token === socket.playerToken);
      if (!seat) return send(socket, { type: 'error', message: 'Player seat is no longer active.' });
      enqueue(room, async () => {
        if (rooms.get(room.code) !== room || !room.seats.includes(seat)) return;
        room.lastActive = Date.now();
        const action = msg.action || msg.type;
        if (action === 'endGame' || action === 'closeRoom') {
          if (seat.index !== (room.hostSeat ?? 0)) {
            return send(socket, { type: 'rejected', reason: 'Only the host can end the game.' });
          }
          broadcast(room, {
            type: 'roomClosed',
            reason: 'The host has ended the game and closed the room.'
          });
          clearRollInFlight(room);
          if (room.watchdog) {
            clearTimeout(room.watchdog);
            room.watchdog = null;
          }
          if (room.timer) {
            clearTimeout(room.timer);
            room.timer = null;
          }
          if (room.interval) {
            clearInterval(room.interval);
            room.interval = null;
          }
          rooms.delete(room.code);
          try {
            await deleteRoom(room.code);
            const client = getRedisClient();
            if (client) {
              for (const s of room.seats) {
                if (s.token) {
                  await client.del(`monopoly:token:${s.token}`).catch(() => {});
                }
              }
            }
          } catch (err) {
            console.warn(`[Redis] delete storage keys error for ${room.code}:`, err?.message || err);
          }
          for (const s of room.seats) {
            if (s.socket && (s.socket.readyState === 1 || s.socket.readyState === 0)) {
              try {
                s.socket.close(1000, 'Room ended by host');
              } catch {}
            }
          }
          return;
        }

        if (action === 'skipInactive') {
          if (!room.game?.players?.length || room.game.phase === 'GAME_OVER' ||
              Date.now() - (room.lastAction?.time ?? room.game.started ?? Date.now()) < 45000) {
            return send(socket, { type: 'rejected', reason: 'Player has not been inactive long enough (45s required).' });
          }
          room.game = advanceTurnForInactivity(room.game);
          room.activeSeat = room.game.turn;
          clearRollInFlight(room);
          recordAction(room, action, seat);
          await saveRoom(room);
          broadcast(room, { ...snapshot(room), type: 'action', action });
          return;
        }
        if (action === 'leave' || action === 'leaveState') {
          if (!room.game?.players?.[seat.index]?.active) {
            return send(socket, { type: 'rejected', reason: 'This seat has already left the game.' });
          }
          room.game = removePlayerFromGame(room.game, seat.index);
          room.seats = room.seats.filter(player => player !== seat);
          if (room.activeSeat !== room.game.turn) clearRollInFlight(room);
          room.activeSeat = room.game.turn;
          if ((room.hostSeat ?? 0) === seat.index) room.hostSeat = room.seats[0]?.index;
          recordAction(room, 'leave', seat);
          if (room.seats.length) {
            await saveRoom(room);
            broadcast(room, { ...snapshot(room), type: 'action', action: 'leave' });
          } else {
            rooms.delete(room.code);
            await deleteRoom(room.code);
          }
          await getRedisClient()?.del(`monopoly:token:${seat.token}`).catch(() => {});
          send(socket, { type: 'roomClosed', reason: 'You left the match.' });
          socket.close();
          return;
        }
        if (action === 'auctionTick') {
          if (seat.index !== (room.hostSeat ?? 0) || room.game?.phase !== 'AUCTION' ||
              !msg.state || msg.expectedVersion !== room.stateVersion) {
            return send(socket, { type: 'rejected', reason: 'This auction has already changed.' });
          }
          room.game = msg.state;
          recordAction(room, action, seat);
          await saveRoom(room);
          broadcast(room, { ...snapshot(room), type: 'action', action });
          return;
        }

        const turnActions = new Set(['roll', 'resolve', 'buy', 'pass', 'endTurn', 'jailChoice', 'gameState']);
        if (turnActions.has(msg.action) && seat.index !== room.activeSeat) {
          return send(socket, { type: 'rejected', reason: 'Only the active player can take a turn action.' });
        }
        if (!turnActions.has(msg.action) && !new Set(['inspect', 'upgrade', 'mortgage', 'unmortgage', 'loan', 'trade', 'gameState', 'manageState', 'auctionState', 'tradeState']).has(msg.action)) {
          return send(socket, { type: 'rejected', reason: 'Unknown room action.' });
        }
        if (msg.action === 'endTurn' && Number.isInteger(msg.nextSeat)) {
          room.activeSeat = msg.nextSeat;
          if (msg.state && typeof msg.state === 'object') room.game = msg.state;
          clearRollInFlight(room);
        }
        if (msg.action === 'gameState' && msg.state && typeof msg.state === 'object') { room.game = msg.state; if (msg.state.phase !== 'WAIT_FOR_ROLL') clearRollInFlight(room); }
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
          room.rollingSeat = seat.index;
          if (room.rollWatchdog) clearTimeout(room.rollWatchdog);
          room.rollWatchdog = setTimeout(() => {
            if (room.rollInFlight) {
              clearRollInFlight(room);
            }
          }, 5000);
          const dice = [randomInt(1, 7), randomInt(1, 7)];
          const consecutiveDoubles = dice[0] === dice[1] ? (room.game.rolls || 0) + 1 : 0;
          recordAction(room, 'dice', seat);
          broadcast(room, { type: 'action', action: 'dice', by: seat.index, dice, consecutiveDoubles, rollId: ++room.rollId, activeSeat: room.activeSeat, stateVersion: room.stateVersion, lastAction: room.lastAction });
          await saveRoom(room);
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
        recordAction(room, msg.action, seat);
        await saveRoom(room);
        broadcast(room, { ...event, stateVersion: room.stateVersion, lastAction: room.lastAction });
      });
    });

    socket.on('close', () => {
      clearInterval(pingInterval);
      const room = rooms.get(socket.roomCode);
      if (room) {
        const seat = room.seats.find(s => s.token === socket.playerToken);
        if (!seat || seat.socket !== socket) return;
        if (room.rollInFlight && (seat.index === room.activeSeat || seat.index === room.rollingSeat)) {
          clearRollInFlight(room);
        }
        room.lastActive = Date.now();
        room.stateVersion++;
        saveRoom(room);
        broadcast(room, { ...snapshot(room), type: 'presence', disconnected: socket.playerToken });
      }
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, room] of rooms) {
      const empty = room.seats.every(seat => seat.socket?.readyState !== 1);
      const finished = room.game?.phase === 'GAME_OVER';
      if ((empty || finished) && now - room.lastActive >= 30 * 60 * 1000) {
        rooms.delete(key);
        deleteRoom(key);
      }
    }
  }, 60 * 1000).unref();

  console.log(`Business room server listening on ws://0.0.0.0:${port}`);
  return wss;
}

if (process.argv[1]?.toLowerCase().replaceAll('\\','/').endsWith('/server/index.js')) startRoomServer();
