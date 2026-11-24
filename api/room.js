import { randomUUID, randomInt } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

const ROOM_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'monopoly:room:';
const TOKEN_PREFIX = 'monopoly:token:';
const ROOMS_SET_KEY = 'monopoly:rooms';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ==========================================
// 1. Storage Clients (Upstash REST, Native TCP, In-Memory)
// ==========================================

// --- Upstash REST Client (Stateless HTTP Fetch, Ideal for Serverless) ---
function cleanToken(token) {
  if (!token) return '';
  let t = String(token).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (t.toLowerCase().startsWith('bearer ')) {
    t = t.slice(7).trim();
  }
  return t;
}

class UpstashRestClient {
  constructor(urlStr, token) {
    this.url = String(urlStr || '').trim().replace(/\/+$/, '');
    this.token = cleanToken(token);
  }

  async _fetch(command, ...args) {
    if (!this.token) {
      throw new Error('Upstash REST token is missing. Please set UPSTASH_REDIS_REST_TOKEN.');
    }
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify([command, ...args]),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Upstash HTTP ${res.status}: ${res.statusText} ${errBody}`.trim());
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  async get(key) {
    return this._fetch('GET', key);
  }

  async set(key, value, ...options) {
    return this._fetch('SET', key, value, ...options);
  }

  async del(key) {
    return this._fetch('DEL', key);
  }

  async sadd(key, member) {
    return this._fetch('SADD', key, member);
  }

  async srem(key, member) {
    return this._fetch('SREM', key, member);
  }

  async smembers(key) {
    const res = await this._fetch('SMEMBERS', key);
    return Array.isArray(res) ? res : [];
  }
}

// --- RESP Parser & Native TCP/TLS Redis Client ---
class RespParser {
  constructor() {
    this.buf = Buffer.alloc(0);
  }
  append(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
  }
  parseOne() {
    if (this.buf.length === 0) return undefined;
    const idx = this.buf.indexOf('\r\n');
    if (idx === -1) return undefined;
    const type = String.fromCharCode(this.buf[0]);
    const line = this.buf.subarray(1, idx).toString('utf8');

    if (type === '+' || type === ':') {
      this.buf = this.buf.subarray(idx + 2);
      return type === ':' ? parseInt(line, 10) : line;
    }
    if (type === '-') {
      this.buf = this.buf.subarray(idx + 2);
      return new Error(line);
    }
    if (type === '$') {
      const len = parseInt(line, 10);
      if (len === -1) {
        this.buf = this.buf.subarray(idx + 2);
        return null;
      }
      if (this.buf.length < idx + 2 + len + 2) return undefined;
      const data = this.buf.subarray(idx + 2, idx + 2 + len).toString('utf8');
      this.buf = this.buf.subarray(idx + 2 + len + 2);
      return data;
    }
    if (type === '*') {
      const count = parseInt(line, 10);
      if (count === -1) {
        this.buf = this.buf.subarray(idx + 2);
        return null;
      }
      const savedBuf = this.buf;
      this.buf = this.buf.subarray(idx + 2);
      const arr = [];
      for (let i = 0; i < count; i++) {
        const item = this.parseOne();
        if (item === undefined) {
          this.buf = savedBuf;
          return undefined;
        }
        arr.push(item);
      }
      return arr;
    }
    this.buf = this.buf.subarray(idx + 2);
    return undefined;
  }
}

function encodeRespCommand(...args) {
  let s = `*${args.length}\r\n`;
  for (const a of args) {
    const str = String(a ?? '');
    const b = Buffer.from(str, 'utf8');
    s += `$${b.length}\r\n${str}\r\n`;
  }
  return s;
}

class NativeRedisClient extends EventEmitter {
  constructor(urlStr) {
    super();
    this.urlStr = urlStr;
    this.url = new URL(urlStr);
    this.socket = null;
    this.parser = new RespParser();
    this.queue = [];
    this.connected = false;
    this.connecting = false;
  }

  async connect() {
    if (this.connected) return;
    if (this.connecting) {
      return new Promise((resolve, reject) => {
        this.once('ready', resolve);
        this.once('error', reject);
      });
    }
    this.connecting = true;
    const isTls = this.url.protocol === 'rediss:';
    const port = Number(this.url.port || 6379);
    const host = this.url.hostname || '127.0.0.1';

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        this._cleanup();
        reject(new Error('Redis connection timeout'));
      }, 3000);

      const onConnect = async () => {
        clearTimeout(connectTimeout);
        this.connecting = false;
        this.connected = true;
        this.parser = new RespParser();

        try {
          const password = this.url.password || process.env.REDIS_PASSWORD;
          const username = this.url.username && this.url.username !== 'default' ? this.url.username : null;
          if (password && username) {
            await this.cmd('AUTH', username, password);
          } else if (password) {
            await this.cmd('AUTH', password);
          }
          this.emit('ready');
          resolve();
        } catch (err) {
          console.warn('[Redis] Auth warning:', err?.message || err);
          resolve();
        }
      };

      try {
        const socket = isTls
          ? tls.connect({ host, port, servername: host })
          : net.connect({ host, port });

        this.socket = socket;
        socket.setNoDelay(true);

        socket.once(isTls ? 'secureConnect' : 'connect', onConnect);

        socket.on('data', chunk => {
          this.parser.append(chunk);
          while (true) {
            const res = this.parser.parseOne();
            if (res === undefined) break;
            const pending = this.queue.shift();
            if (pending) {
              if (res instanceof Error) pending.reject(res);
              else pending.resolve(res);
            }
          }
        });

        socket.on('error', err => {
          clearTimeout(connectTimeout);
          this._cleanup();
          this.emit('error', err);
          reject(err);
        });

        socket.on('close', () => {
          this._cleanup();
        });
      } catch (err) {
        clearTimeout(connectTimeout);
        this._cleanup();
        reject(err);
      }
    });
  }

  _cleanup() {
    this.connected = false;
    this.connecting = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }
    while (this.queue.length > 0) {
      const pending = this.queue.shift();
      pending?.reject(new Error('Redis connection closed'));
    }
  }

  async cmd(...args) {
    if (!this.connected) {
      await this.connect();
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.queue.findIndex(q => q.resolve === resolve);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error('Redis command timeout'));
        }
      }, 5000);

      this.queue.push({
        resolve: val => { clearTimeout(timeout); resolve(val); },
        reject: err => { clearTimeout(timeout); reject(err); }
      });

      try {
        this.socket.write(encodeRespCommand(...args));
      } catch (err) {
        clearTimeout(timeout);
        const idx = this.queue.findIndex(q => q.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(err);
      }
    });
  }

  async get(key) { return this.cmd('GET', key); }
  async set(key, value, ...options) { return this.cmd('SET', key, value, ...options); }
  async del(key) { return this.cmd('DEL', key); }
  async sadd(key, member) { return this.cmd('SADD', key, member); }
  async srem(key, member) { return this.cmd('SREM', key, member); }
  async smembers(key) {
    const res = await this.cmd('SMEMBERS', key);
    return Array.isArray(res) ? res : [];
  }
}

// --- In-Memory Fallback Client (Warm Serverless & Local Persistence) ---
class InMemoryClient {
  constructor() {
    if (!globalThis.__monopoly_store) {
      globalThis.__monopoly_store = {
        store: new Map(),
        sets: new Map()
      };
    }
    this.store = globalThis.__monopoly_store.store;
    this.sets = globalThis.__monopoly_store.sets;
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async set(key, value) {
    this.store.set(key, String(value));
    return 'OK';
  }
  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }
  async sadd(key, member) {
    let s = this.sets.get(key);
    if (!s) { s = new Set(); this.sets.set(key, s); }
    s.add(String(member));
    return 1;
  }
  async srem(key, member) {
    const s = this.sets.get(key);
    if (!s) return 0;
    return s.delete(String(member)) ? 1 : 0;
  }
  async smembers(key) {
    const s = this.sets.get(key);
    return s ? Array.from(s) : [];
  }
}

// ==========================================
// 2. Storage Singleton Resolution
// ==========================================
let storageClient = null;

function getStorage(req) {
  // Check headers passed from frontend in-game settings
  if (req && req.headers) {
    const headerUrl = req.headers['x-upstash-url'];
    const headerToken = req.headers['x-upstash-token'];
    if (headerUrl && headerToken) {
      return new UpstashRestClient(headerUrl, headerToken);
    }
  }

  if (storageClient) return storageClient;

  let upstashUrl = 
    process.env.UPSTASH_REDIS_REST_URL || 
    process.env.UPSTASH_REST_URL || 
    process.env.KV_REST_API_URL || 
    process.env.REDIS_REST_URL || 
    '';
  let upstashToken = 
    process.env.UPSTASH_REDIS_REST_TOKEN || 
    process.env.UPSTASH_REST_TOKEN || 
    process.env.KV_REST_API_TOKEN || 
    process.env.REDIS_TOKEN || 
    process.env.REDIS_REST_TOKEN || 
    process.env.UPSTASH_TOKEN || 
    '';
  const genericRedisUrl = process.env.REDIS_URL || process.env.REDIS_URI || process.env.KV_URL || '';

  // Check if REDIS_URL is an HTTP/HTTPS REST endpoint
  if (!upstashUrl && (genericRedisUrl.startsWith('http://') || genericRedisUrl.startsWith('https://'))) {
    upstashUrl = genericRedisUrl;
  }

  // Parse token from URL if present
  if (upstashUrl) {
    try {
      const parsed = new URL(upstashUrl);
      if (parsed.password && !upstashToken) {
        upstashToken = decodeURIComponent(parsed.password);
      }
      if (parsed.username && parsed.username !== 'default' && !upstashToken) {
        upstashToken = decodeURIComponent(parsed.username);
      }
      upstashUrl = `${parsed.protocol}//${parsed.host}`;
    } catch {}
  }

  // If URL is set, ensure token is present; otherwise warn and use memory fallback
  if (upstashUrl) {
    const cleaned = cleanToken(upstashToken);
    if (!cleaned) {
      console.warn('[Storage] UPSTASH_REDIS_REST_URL is configured, but UPSTASH_REDIS_REST_TOKEN is missing or empty. Please set UPSTASH_REDIS_REST_TOKEN in Vercel and redeploy.');
      storageClient = new InMemoryClient();
      return storageClient;
    }
    storageClient = new UpstashRestClient(upstashUrl, cleaned);
    return storageClient;
  }

  if (genericRedisUrl.startsWith('redis://') || genericRedisUrl.startsWith('rediss://')) {
    try {
      storageClient = new NativeRedisClient(genericRedisUrl);
      return storageClient;
    } catch (err) {
      console.warn('[Redis] Native client setup failed, using memory fallback:', err?.message || err);
    }
  }

  storageClient = new InMemoryClient();
  return storageClient;
}

// --- High-level Room Operations ---
async function saveRoomToStorage(room, req) {
  if (!room || !room.code) return;
  const storage = getStorage(req);
  const roomKey = `${KEY_PREFIX}${room.code.toUpperCase()}`;

  const payload = JSON.stringify({
    code: room.code.toUpperCase(),
    seats: room.seats.map(s => ({
      token: s.token,
      name: s.name,
      index: s.index
    })),
    activeSeat: room.activeSeat ?? 0,
    game: room.game ?? null,
    rollInFlight: Boolean(room.rollInFlight),
    rollId: room.rollId || 0,
    stateVersion: room.stateVersion || 0,
    lastAction: room.lastAction || null,
    lastActive: room.lastActive || Date.now()
  });

  try {
    await storage.set(roomKey, payload, 'EX', ROOM_TTL_SECONDS);
    await storage.sadd(ROOMS_SET_KEY, room.code.toUpperCase());

    for (const seat of room.seats) {
      if (seat.token) {
        await storage.set(`${TOKEN_PREFIX}${seat.token}`, room.code.toUpperCase(), 'EX', ROOM_TTL_SECONDS);
      }
    }
  } catch (err) {
    console.warn(`[Storage] saveRoom failed for ${room.code}:`, err?.message || err);
    // If external storage fails, write to local in-memory fallback
    const fallback = new InMemoryClient();
    await fallback.set(roomKey, payload);
    for (const seat of room.seats) {
      if (seat.token) await fallback.set(`${TOKEN_PREFIX}${seat.token}`, room.code.toUpperCase());
    }
  }
}

async function getRoomFromStorage(code, req) {
  if (!code) return null;
  const roomCode = String(code).toUpperCase().trim();
  const roomKey = `${KEY_PREFIX}${roomCode}`;
  const storage = getStorage(req);

  try {
    const raw = await storage.get(roomKey);
    if (raw) {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch (err) {
    console.warn(`[Storage] getRoom failed for ${roomCode}:`, err?.message || err);
  }

  // Fallback check in memory
  try {
    const fallback = new InMemoryClient();
    const memRaw = await fallback.get(roomKey);
    if (memRaw) return typeof memRaw === 'string' ? JSON.parse(memRaw) : memRaw;
  } catch {}

  return null;
}

  return null;
}

async function getRoomCodeByTokenFromStorage(token, req) {
  if (!token) return null;
  const storage = getStorage(req);
  try {
    const code = await storage.get(`${TOKEN_PREFIX}${token}`);
    if (code) return String(code).toUpperCase();
  } catch {}

  try {
    const fallback = new InMemoryClient();
    const code = await fallback.get(`${TOKEN_PREFIX}${token}`);
    if (code) return String(code).toUpperCase();
  } catch {}

  return null;
}

function generateRoomCode() {
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return result;
}

// ==========================================
// 3. HTTP Request / Response Helpers
// ==========================================

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(data);
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

function getQueryParams(req) {
  if (req.query && typeof req.query === 'object') {
    return req.query;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const result = {};
    for (const [key, value] of url.searchParams.entries()) {
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

async function getRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ==========================================
// 4. Main Serverless Handler
// ==========================================

export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    if (typeof res.status === 'function') {
      return res.status(204).end();
    }
    res.statusCode = 204;
    return res.end();
  }

  const query = getQueryParams(req);
  const method = req.method ? req.method.toUpperCase() : 'GET';

  // ----------------------------------------------------
  // GET /api/room?code=ABCD&since=V (Polling endpoint)
  // ----------------------------------------------------
  if (method === 'GET') {
    const code = String(query.code || '').trim().toUpperCase();
    if (!code) {
      return sendJson(res, 400, { error: 'Room code is required.' });
    }

    const room = await getRoomFromStorage(code, req);
    if (!room) {
      return sendJson(res, 404, { error: 'Room not found.' });
    }

    const sinceParam = query.since;
    if (sinceParam !== undefined && sinceParam !== null && sinceParam !== '') {
      const sinceNum = parseInt(sinceParam, 10);
      if (!isNaN(sinceNum) && sinceNum === (room.stateVersion || 0)) {
        return sendJson(res, 200, {
          unchanged: true,
          stateVersion: room.stateVersion || 0
        });
      }
    }

    const players = (room.seats || []).map(s => ({
      name: s.name,
      index: s.index,
      online: true
    }));

    return sendJson(res, 200, {
      code: room.code,
      stateVersion: room.stateVersion || 0,
      game: room.game || null,
      players,
      activeSeat: room.activeSeat ?? 0,
      lastAction: room.lastAction || null
    });
  }

  // ----------------------------------------------------
  // POST /api/room?action=create | join | resume | action
  // ----------------------------------------------------
  if (method === 'POST') {
    const body = await getRequestBody(req);
    const action = String(query.action || body.action || body.type || '').trim();

    // 1. POST /api/room?action=create
    if (action === 'create') {
      let code;
      let attempts = 0;
      do {
        code = generateRoomCode();
        attempts++;
      } while (attempts < 10 && (await getRoomFromStorage(code, req)));

      const token = randomUUID();
      const hostName = String(body.nickname || body.name || 'Player 1').trim().slice(0, 24) || 'Player 1';

      const room = {
        code,
        seats: [
          { token, name: hostName, index: 0 }
        ],
        activeSeat: 0,
        game: null,
        stateVersion: 1,
        lastAction: {
          action: 'create',
          by: 0,
          nickname: hostName,
          time: Date.now()
        },
        lastActive: Date.now()
      };

      await saveRoomToStorage(room, req);

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        code: room.code,
        token,
        seat: 0,
        players,
        game: null,
        activeSeat: 0,
        stateVersion: room.stateVersion
      });
    }

    // 2. POST /api/room?action=join
    if (action === 'join') {
      const code = String(body.code || query.code || '').trim().toUpperCase();
      if (!code) {
        return sendJson(res, 400, { error: 'Room code is required.' });
      }

      const room = await getRoomFromStorage(code, req);
      if (!room) {
        return sendJson(res, 404, { error: 'Room not found.' });
      }

      // Check if this player is rejoining with existing token
      if (body.token) {
        const existing = room.seats.find(s => s.token === body.token);
        if (existing) {
          const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
          return sendJson(res, 200, {
            code: room.code,
            token: existing.token,
            seat: existing.index,
            game: room.game,
            players,
            activeSeat: room.activeSeat ?? 0,
            stateVersion: room.stateVersion || 0
          });
        }
      }

      if (room.seats.length >= 6) {
        return sendJson(res, 400, { error: 'This room already has six players.' });
      }

      if (room.game?.players?.length) {
        return sendJson(res, 400, { error: 'This game has already started. Reconnect with your player token.' });
      }

      const token = randomUUID();
      const seatIndex = room.seats.length;
      const nickname = String(body.nickname || body.name || `Player ${seatIndex + 1}`).trim().slice(0, 24) || `Player ${seatIndex + 1}`;

      const newSeat = { token, name: nickname, index: seatIndex };
      room.seats.push(newSeat);
      room.stateVersion = (room.stateVersion || 0) + 1;
      room.lastActive = Date.now();
      room.lastAction = {
        action: 'join',
        by: seatIndex,
        nickname,
        time: Date.now()
      };

      await saveRoomToStorage(room, req);

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        code: room.code,
        token,
        seat: seatIndex,
        game: room.game,
        players,
        activeSeat: room.activeSeat ?? 0,
        stateVersion: room.stateVersion
      });
    }

    // 3. POST /api/room?action=resume
    if (action === 'resume') {
      const token = body.token || query.token;
      if (!token) {
        return sendJson(res, 400, { error: 'Player token is required to resume.' });
      }

      let code = String(body.code || query.code || '').trim().toUpperCase();
      if (!code) {
        code = await getRoomCodeByTokenFromStorage(token, req);
      }

      if (!code) {
        return sendJson(res, 404, { error: 'Room session not found for this token.' });
      }

      const room = await getRoomFromStorage(code, req);
      if (!room) {
        return sendJson(res, 404, { error: 'Room not found.' });
      }

      const seat = room.seats.find(s => s.token === token);
      if (!seat) {
        return sendJson(res, 403, { error: 'That player session has expired or is invalid.' });
      }

      room.lastActive = Date.now();
      await saveRoomToStorage(room, req);

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        code: room.code,
        token: seat.token,
        seat: seat.index,
        game: room.game,
        players,
        activeSeat: room.activeSeat ?? 0,
        stateVersion: room.stateVersion || 0,
        lastAction: room.lastAction || null
      });
    }

    // 4. POST /api/room?action=action (or action inside body)
    // Supports game actions: roll, gameState, endTurn, dice, manageState, etc.
    const isGameAction = action === 'action' || !['create', 'join', 'resume'].includes(action);
    if (isGameAction) {
      const code = String(body.code || query.code || '').trim().toUpperCase();
      const token = body.token || query.token;

      if (!code || !token) {
        return sendJson(res, 400, { error: 'Room code and player token are required.' });
      }

      const room = await getRoomFromStorage(code, req);
      if (!room) {
        return sendJson(res, 404, { error: 'Room not found.' });
      }

      const seat = room.seats.find(s => s.token === token);
      if (!seat) {
        return sendJson(res, 403, { error: 'Player seat is no longer active.' });
      }

      const clientAction = body.action || query.action || 'action';

      if (clientAction === 'roll') {
        const dice = Array.isArray(body.dice) && body.dice.length === 2
          ? body.dice
          : [randomInt(1, 7), randomInt(1, 7)];
        const consecutiveDoubles = dice[0] === dice[1] ? ((room.game?.rolls || 0) + 1) : 0;
        room.lastAction = {
          action: 'dice',
          by: seat.index,
          nickname: seat.name,
          dice,
          consecutiveDoubles,
          rollId: Date.now(),
          time: Date.now()
        };
      } else if (clientAction === 'endTurn') {
        if (Number.isInteger(body.nextSeat)) {
          room.activeSeat = body.nextSeat;
        }
        if (body.state && typeof body.state === 'object') {
          room.game = body.state;
        }
        room.lastAction = {
          action: 'endTurn',
          by: seat.index,
          nickname: seat.name,
          nextSeat: room.activeSeat,
          payload: body.payload,
          time: Date.now()
        };
      } else {
        if (body.state && typeof body.state === 'object') {
          room.game = body.state;
          if (body.state.turn !== undefined && Number.isInteger(body.state.turn)) {
            room.activeSeat = body.state.turn;
          }
        }
        if (Number.isInteger(body.activeSeat)) {
          room.activeSeat = body.activeSeat;
        }
        if (Number.isInteger(body.nextSeat)) {
          room.activeSeat = body.nextSeat;
        }
        room.lastAction = {
          action: clientAction,
          by: seat.index,
          nickname: seat.name,
          payload: body.payload,
          dice: body.dice,
          time: Date.now()
        };
      }

      room.stateVersion = (room.stateVersion || 0) + 1;
      room.lastActive = Date.now();

      await saveRoomToStorage(room, req);

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        success: true,
        stateVersion: room.stateVersion,
        game: room.game,
        activeSeat: room.activeSeat ?? 0,
        players,
        lastAction: room.lastAction
      });
    }

    return sendJson(res, 400, { error: `Unsupported room action: '${action}'` });
  }

  return sendJson(res, 405, { error: `Method ${method} not allowed.` });
}
