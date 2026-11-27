import { randomUUID, randomInt } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { advanceTurnForInactivity, removePlayerFromGame } from '../src/utils/playerDeparture.js';

const ROOM_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'monopoly:room:';
const VER_PREFIX = 'monopoly:ver:';
const TOKEN_PREFIX = 'monopoly:token:';
const ROOMS_SET_KEY = 'monopoly:rooms';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_REGEX = /^[A-Z0-9]{4}$/;
const TURN_ACTIONS = ['roll', 'endTurn', 'buy', 'liquidate'];
const STUCK_ROLL_MS = 5000;
const AUTO_SKIP_MS = 120000;
const CAS_ROOM_SCRIPT = `
  local cached = redis.call('GET', KEYS[2])
  local currentVer = cached and string.match(cached, '^(%d+)|')
  if not currentVer then
    local current = redis.call('GET', KEYS[1])
    if current then
      local ok, decoded = pcall(cjson.decode, current)
      currentVer = ok and tostring(decoded.stateVersion or 0) or '0'
    end
  end
  if ARGV[1] == '' then
    if currentVer then
      return redis.error_reply("VERSION_MISMATCH:" .. currentVer)
    end
  elseif not currentVer or currentVer ~= ARGV[1] then
    return redis.error_reply("VERSION_MISMATCH:" .. (currentVer or 'missing'))
  end
  if ARGV[2] == '' then
    redis.call('DEL', KEYS[1], KEYS[2])
  else
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
    redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[3])
  end
  return "OK"
`;

function roomWriteArgs(code, expectedVersion, payload, versionStamp) {
  return [
    'EVAL', CAS_ROOM_SCRIPT, 2, `${KEY_PREFIX}${code}`, `${VER_PREFIX}${code}`,
    String(expectedVersion ?? ''), payload ?? '', String(ROOM_TTL_SECONDS), versionStamp ?? ''
  ];
}

function isVersionConflict(error) {
  return /VERSION_MISMATCH:/.test(error?.message || '');
}

if (!globalThis.__monopoly_store) {
  globalThis.__monopoly_store = {
    store: new Map(),
    sets: new Map()
  };
}
export const MEMORY_ROOMS = globalThis.__monopoly_store.store;
globalThis.MEMORY_ROOMS = MEMORY_ROOMS;

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

  async expire(key, seconds) {
    return this._fetch('EXPIRE', key, seconds);
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

  async cas(code, expectedVersion, payload, versionStamp) {
    return this._fetch(...roomWriteArgs(code, expectedVersion, payload, versionStamp));
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
  async expire(key, seconds) { return this.cmd('EXPIRE', key, seconds); }
  async del(key) { return this.cmd('DEL', key); }
  async sadd(key, member) { return this.cmd('SADD', key, member); }
  async srem(key, member) { return this.cmd('SREM', key, member); }
  async smembers(key) {
    const res = await this.cmd('SMEMBERS', key);
    return Array.isArray(res) ? res : [];
  }
  async cas(code, expectedVersion, payload, versionStamp) {
    return this.cmd(...roomWriteArgs(code, expectedVersion, payload, versionStamp));
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
  async expire(key, seconds) {
    return this.store.has(key) ? 1 : 0;
  }
  async cas(code, expectedVersion, payload, versionStamp) {
    const key = `${KEY_PREFIX}${code}`;
    const verKey = `${VER_PREFIX}${code}`;
    const current = this.store.get(key);
    const cachedVersion = /^(\d+)\|/.exec(this.store.get(verKey))?.[1];
    const version = cachedVersion ?? (current ? String(JSON.parse(current).stateVersion ?? 0) : null);
    const expected = expectedVersion == null ? null : String(expectedVersion);
    if (version !== expected) {
      throw new Error(`VERSION_MISMATCH:${version ?? 'missing'}`);
    }
    if (payload == null) {
      this.store.delete(key);
      this.store.delete(verKey);
    } else {
      this.store.set(key, payload);
      this.store.set(verKey, versionStamp);
    }
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
function isVercelEnvironment() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV) || Boolean(process.env.NOW_REGION);
}

function getUpstashEnvCredentials() {
  const url = 
    process.env.UPSTASH_REDIS_REST_URL || 
    process.env.UPSTASH_REST_URL || 
    process.env.KV_REST_API_URL || 
    process.env.REDIS_REST_URL || 
    '';
  const token = 
    process.env.UPSTASH_REDIS_REST_TOKEN || 
    process.env.UPSTASH_REST_TOKEN || 
    process.env.KV_REST_API_TOKEN || 
    process.env.REDIS_TOKEN || 
    process.env.REDIS_REST_TOKEN || 
    process.env.UPSTASH_TOKEN || 
    '';
  return { url: url.trim(), token: cleanToken(token) };
}

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

  const { url: upstashUrlRaw, token: upstashTokenRaw } = getUpstashEnvCredentials();
  let upstashUrl = upstashUrlRaw;
  let upstashToken = upstashTokenRaw;
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
      console.warn('[Storage] UPSTASH_REDIS_REST_URL is configured, but UPSTASH_REDIS_REST_TOKEN is missing or empty. Using memory fallback.');
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

// ==========================================
// 3. Rate Limiting, Security & Sanitization Helpers
// ==========================================

const tokenRateLimits = new Map();

function isRateLimited(token, req) {
  if (!token) return false;
  if (req?.headers && (req.headers['x-bypass-rate-limit'] || req.headers['x-internal-test'])) {
    return false;
  }
  const now = Date.now();
  const windowMs = 1000;
  const maxActions = 10;

  let timestamps = tokenRateLimits.get(token);
  if (!timestamps) {
    timestamps = [];
    tokenRateLimits.set(token, timestamps);
  }

  // Filter timestamps within the last 1000ms
  timestamps = timestamps.filter(t => now - t < windowMs);
  if (timestamps.length >= maxActions) {
    return true; // Limit exceeded!
  }

  timestamps.push(now);
  tokenRateLimits.set(token, timestamps);

  // Periodically clean up old entries if map grows large
  if (tokenRateLimits.size > 2000) {
    for (const [k, v] of tokenRateLimits.entries()) {
      if (!v.some(t => now - t < windowMs)) {
        tokenRateLimits.delete(k);
      }
    }
  }

  return false;
}

function checkActionAuthorization(room, seat, clientAction, body) {
  const activeTurn = room.game?.turn !== undefined ? room.game.turn : (room.activeSeat ?? 0);
  const hostSeat = room.hostSeat ?? 0;

  if ((clientAction === 'auctionTick' || (clientAction === 'gameState' && !room.game?.players?.length && body.state?.players?.length)) &&
      seat.index !== hostSeat) {
    return { authorized: false, status: 403, error: 'Only the host can take this room action.' };
  }

  // 1. Turn actions: verify caller seat matches activeSeat
  if (TURN_ACTIONS.includes(clientAction) || (clientAction === 'gameState' && room.game?.players?.length)) {
    if (seat.index !== activeTurn) {
      return { authorized: false, status: 403, error: 'Not your turn to act.' };
    }
  }

  // 2. Auction bid: verify bidder seat matches auction turn
  if (clientAction === 'auctionBid') {
    const auctionTurn = room.game?.auction?.turn;
    if (auctionTurn !== undefined && auctionTurn !== null && seat.index !== auctionTurn) {
      return { authorized: false, status: 403, error: 'Not your turn to bid in the auction.' };
    }
  }

  // 3. Trade responses: verify seat matches trade recipient
  if (clientAction === 'tradeAccept' || clientAction === 'tradeReject') {
    const tradeId = body.tradeId || body.payload?.tradeId;
    let trade = null;
    if (room.game?.trades && Array.isArray(room.game.trades)) {
      trade = room.game.trades.find(t => t.id === tradeId);
    }
    if (!trade) {
      trade = body.trade || body.payload?.trade;
    }
    if (trade && trade.to !== undefined && trade.to !== null) {
      if (seat.index !== trade.to) {
        return { authorized: false, status: 403, error: 'Not authorized to respond to this trade.' };
      }
    }
  }

  return { authorized: true };
}

function rollRecoveryAt(room) {
  if (!room.rollInFlight) return 0;
  return (room.rollStartTime || room.lastRollTime || room.lastAction?.time || room.lastActive || 0) + STUCK_ROLL_MS;
}

function turnRecoveryAt(room) {
  if (room.game?.phase === 'GAME_OVER' || !Array.isArray(room.game?.players) || room.game.players.filter(player => player.active).length < 2) return 0;
  const lastActionAt = room.lastAction?.time || room.lastActive;
  return lastActionAt ? lastActionAt + AUTO_SKIP_MS : 0;
}

function advanceInactiveTurn(room, seat) {
  const current = room.game?.turn ?? room.activeSeat ?? 0;
  if (room.game?.players?.length) room.game = advanceTurnForInactivity(room.game);
  const next = room.game?.turn ?? room.seats.find(player => player.index > current)?.index ?? room.seats[0]?.index ?? 0;
  room.activeSeat = next;
  room.rollInFlight = false;
  room.rollStartTime = null;
  room.lastActive = Date.now();
  room.lastAction = {
    action: seat ? 'skipInactive' : 'staleTurnAutoAdvance',
    by: seat?.index ?? -1,
    nickname: seat?.name ?? 'System',
    skippedSeat: current,
    nextSeat: next,
    time: room.lastActive
  };
}

function sanitizeGame(game) {
  if (!game || typeof game !== 'object') return game;
  if (Array.isArray(game.players)) {
    return {
      ...game,
      players: game.players.map(p => {
        if (p && typeof p === 'object' && 'token' in p) {
          const { token: _, ...safePlayer } = p;
          return safePlayer;
        }
        return p;
      })
    };
  }
  return game;
}

function sanitizeLastAction(lastAction) {
  if (!lastAction || typeof lastAction !== 'object') return lastAction;
  const { token: _, ...safeAction } = lastAction;
  if (safeAction.payload && typeof safeAction.payload === 'object' && 'token' in safeAction.payload) {
    const { token: __, ...safePayload } = safeAction.payload;
    safeAction.payload = safePayload;
  }
  return safeAction;
}

// --- High-level Room Operations ---
function roomResponse(room, seat, includeToken = false) {
  return {
    code: room.code,
    ...(seat ? { seat: seat.index } : {}),
    ...(includeToken && seat ? { token: seat.token } : {}),
    players: room.seats.map(({ name, index }) => ({ name, index, online: true })),
    game: sanitizeGame(room.game),
    activeSeat: room.activeSeat ?? 0,
    hostSeat: room.hostSeat ?? 0,
    stateVersion: room.stateVersion ?? 0,
    lastAction: sanitizeLastAction(room.lastAction)
  };
}

async function saveRoomToStorage(room, req, expectedVersion) {
  const storage = getStorage(req);
  const code = room.code.toUpperCase();
  const recoveryAt = Math.min(rollRecoveryAt(room) || Infinity, turnRecoveryAt(room) || Infinity);
  const versionStamp = [room.stateVersion, Number.isFinite(recoveryAt) ? recoveryAt : 0].join('|');
  await storage.cas(code, expectedVersion, JSON.stringify(room), versionStamp);

  await Promise.allSettled([
    storage.sadd(ROOMS_SET_KEY, code),
    ...room.seats.map(seat => storage.set(TOKEN_PREFIX + seat.token, code, 'EX', ROOM_TTL_SECONDS))
  ]);
}

async function closeRoomInStorage(room, req) {
  const storage = getStorage(req);
  await storage.cas(room.code, room.stateVersion ?? 0, null);
  await Promise.allSettled([
    storage.srem(ROOMS_SET_KEY, room.code),
    ...room.seats.map(seat => storage.del(TOKEN_PREFIX + seat.token))
  ]);
}

async function getRoomFromStorage(code, req) {
  const storage = getStorage(req);
  const key = KEY_PREFIX + code;
  const read = async () => {
    const raw = await storage.get(key);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  };
  const room = await read();
  if (!room || room.closed) return room;

  const now = Date.now();
  const rollAt = rollRecoveryAt(room);
  const turnAt = turnRecoveryAt(room);
  if (turnAt && now >= turnAt) {
    advanceInactiveTurn(room);
  } else if (rollAt && now >= rollAt) {
    room.rollInFlight = false;
    room.rollStartTime = null;
  } else {
    return room;
  }

  const version = room.stateVersion ?? 0;
  room.stateVersion = version + 1;
  try {
    await saveRoomToStorage(room, req, version);
    return room;
  } catch (error) {
    if (!isVersionConflict(error)) throw error;
    return read();
  }
}

async function getRoomCodeByTokenFromStorage(token, req) {
  const code = await getStorage(req).get(TOKEN_PREFIX + token);
  return code ? String(code).toUpperCase() : null;
}

function generateRoomCode() {
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return result;
}

// ==========================================
// 4. HTTP Request / Response Helpers
// ==========================================

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-upstash-url, x-upstash-token, x-bypass-rate-limit');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
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
// 5. Main Serverless Handler
// ==========================================

export default async function handler(req, res) {
  try {
    return await handleRoomRequest(req, res);
  } catch (error) {
    const conflict = /VERSION_MISMATCH:(\d+|missing)/.exec(error?.message || '');
    if (conflict) return sendVersionConflict(res, conflict[1] === 'missing' ? null : Number(conflict[1]));
    console.warn('[Room] Request failed:', error?.message || error);
    return sendJson(res, 503, {
      error: 'Room storage is temporarily unavailable. Please try again.',
      code: 'ROOM_STORAGE_UNAVAILABLE'
    });
  }
}

function sendVersionConflict(res, version, lastAction) {
  return sendJson(res, 409, {
    error: 'State version conflict',
    code: 'VERSION_CONFLICT',
    currentVersion: version,
    lastAction: sanitizeLastAction(lastAction)
  });
}

async function handleRoomRequest(req, res) {
  setCorsHeaders(res);
  const query = getQueryParams(req);
  const method = req.method?.toUpperCase() || 'GET';

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    if (typeof res.status === 'function') return res.status(204).end();
    res.statusCode = 204;
    return res.end();
  }

  if (isVercelEnvironment()) {
    const hasHeaderCreds = req.headers?.['x-upstash-url'] && req.headers?.['x-upstash-token'];
    const envCreds = getUpstashEnvCredentials();
    if (!hasHeaderCreds && !(envCreds.url && envCreds.token)) {
      return sendJson(res, 500, {
        error: 'Vercel Deployment Error: Missing Upstash Redis credentials. Please configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel Project Settings.',
        code: 'UPSTASH_CONFIG_MISSING'
      });
    }
  }

  if (method === 'GET') {
    const code = String(query.code || '').trim().toUpperCase();
    if (!code) return sendJson(res, 400, { error: 'Room code is required.' });
    if (!ROOM_CODE_REGEX.test(code)) return invalidRoomCode(res);

    const since = /^\d+$/.test(query.since) ? Number(query.since) : null;
    if (since !== null) {
      const stamp = /^(\d+)\|(\d+)$/.exec(await getStorage(req).get(VER_PREFIX + code));
      if (stamp && since === Number(stamp[1]) && (Number(stamp[2]) === 0 || Date.now() < Number(stamp[2]))) {
        return sendJson(res, 200, { unchanged: true, stateVersion: since });
      }
    }

    const room = await getRoomFromStorage(code, req);
    if (!room || room.closed) return roomMissing(res);
    if (since === (room.stateVersion ?? 0)) return sendJson(res, 200, { unchanged: true, stateVersion: since });

    const token = /^Bearer (\S+)$/i.exec(req.headers?.authorization || '')?.[1];
    const seat = token && room.seats.find(player => player.token === token);
    const snapshot = roomResponse(room, seat);
    if (token && !seat) snapshot.seat = -1;
    return sendJson(res, 200, snapshot);
  }

  if (method !== 'POST') return sendJson(res, 405, { error: `Method ${method} not allowed.` });
  const body = await getRequestBody(req) || {};
  const action = String(query.action || body.action || body.type || '').trim();

  if (action === 'create') {
    const token = randomUUID();
    const name = String(body.nickname || body.name || 'Player 1').trim().slice(0, 24) || 'Player 1';
    const seat = { token, name, index: 0 };
    for (let attempt = 0; attempt < 10; attempt++) {
      const now = Date.now();
      const room = {
        code: generateRoomCode(),
        seats: [seat],
        activeSeat: 0,
        hostSeat: 0,
        game: null,
        stateVersion: 1,
        lastAction: { action: 'create', by: 0, nickname: name, time: now },
        lastActive: now
      };
      try {
        await saveRoomToStorage(room, req);
        return sendJson(res, 200, roomResponse(room, seat, true));
      } catch (error) {
        if (!isVersionConflict(error)) throw error;
      }
    }
    return sendJson(res, 503, { error: 'Could not allocate a room code. Please try again.' });
  }

  let code = String(body.code || query.code || '').trim().toUpperCase();
  const token = body.token || query.token;
  if (action === 'resume') {
    if (!token) return sendJson(res, 400, { error: 'Player token is required to resume.' });
    if (!code) code = await getRoomCodeByTokenFromStorage(token, req);
    if (!code) return sendJson(res, 404, { error: 'Room session not found for this token.' });
  }
  if (!code || (action !== 'join' && !token)) {
    return sendJson(res, 400, { error: action === 'join' ? 'Room code is required.' : 'Room code and player token are required.' });
  }
  if (!ROOM_CODE_REGEX.test(code)) return invalidRoomCode(res);

  if (action === 'join') {
    const newToken = randomUUID();
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await getRoomFromStorage(code, req);
      if (!room || room.closed) return roomMissing(res, 'Room not found.');
      const existing = room.seats.find(seat => seat.token === token);
      if (existing) return sendJson(res, 200, roomResponse(room, existing, true));
      if (room.seats.length >= 6) return sendJson(res, 400, { error: 'This room already has six players.' });
      if (room.game?.players?.length) {
        return sendJson(res, 400, { error: 'This game has already started. Reconnect with your player token.' });
      }

      const index = room.seats.length;
      const fallback = `Player ${index + 1}`;
      const name = String(body.nickname || body.name || fallback).trim().slice(0, 24) || fallback;
      const seat = { token: newToken, name, index };
      const version = room.stateVersion ?? 0;
      room.seats.push(seat);
      room.stateVersion = version + 1;
      room.lastActive = Date.now();
      room.lastAction = { action: 'join', by: index, nickname: name, time: room.lastActive };
      try {
        await saveRoomToStorage(room, req, version);
        return sendJson(res, 200, roomResponse(room, seat, true));
      } catch (error) {
        if (!isVersionConflict(error) || attempt === 5) throw error;
      }
    }
  }

  if (action !== 'resume' && isRateLimited(token, req)) {
    return sendJson(res, 429, { error: 'Rate limit exceeded, please slow down.' });
  }
  const room = await getRoomFromStorage(code, req);
  if (!room || room.closed) return roomMissing(res, 'Room not found.');
  const seat = room.seats.find(player => player.token === token);
  if (action === 'resume') {
    if (!seat) return sendJson(res, 403, { error: 'That player session has expired or is invalid.' });
    return sendJson(res, 200, roomResponse(room, seat, true));
  }
  if (!seat) return sendJson(res, 403, { error: 'Player seat is no longer active.' });

  const clientAction = body.action || query.action || action || 'action';
  const version = room.stateVersion ?? 0;
  if (body.expectedVersion != null && String(body.expectedVersion) !== String(version)) {
    return sendVersionConflict(res, version, room.lastAction);
  }

  if (['endGame', 'closeRoom'].includes(action) || ['endGame', 'closeRoom'].includes(clientAction)) {
    if (seat.index !== (room.hostSeat ?? 0)) {
      return sendJson(res, 403, { error: 'Only the room host can end the game and close the room.' });
    }
    await closeRoomInStorage(room, req);
    return sendJson(res, 200, { success: true, closed: true, message: 'Room ended and resources released.' });
  }

  if (['leave', 'leaveRoom', 'leavePlayer', 'leaveState'].includes(clientAction)) {
    const remaining = room.seats.filter(player => player !== seat);
    if (!remaining.length) {
      await closeRoomInStorage(room, req);
      return sendJson(res, 200, { success: true, closed: true });
    }

    room.seats = remaining;
    const host = remaining.find(player => player.index === (room.hostSeat ?? 0)) || remaining[0];
    if (room.game?.players?.length) {
      room.game = removePlayerFromGame(room.game, seat.index);
      if (room.activeSeat === seat.index) {
        room.rollInFlight = false;
        room.rollStartTime = null;
      }
      room.activeSeat = room.game.turn;
    } else {
      const active = remaining.find(player => player.index === room.activeSeat) || remaining[0];
      remaining.forEach((player, index) => { player.index = index; });
      room.activeSeat = active.index;
    }
    room.hostSeat = host.index;
    room.lastActive = Date.now();
    room.lastAction = { action: 'leave', by: seat.index, nickname: seat.name, time: room.lastActive };
    room.stateVersion = version + 1;
    await saveRoomToStorage(room, req, version);
    await getStorage(req).del(TOKEN_PREFIX + seat.token).catch(() => {});
    return sendJson(res, 200, { success: true, ...roomResponse(room) });
  }

  if (clientAction === 'skipInactive') {
    const inactivity = Date.now() - (room.lastActive || 0);
    if (inactivity < 45000) {
      return sendJson(res, 400, { error: 'Player has not been inactive long enough (45s required).', remainingMs: 45000 - inactivity });
    }
    if (room.game?.phase === 'GAME_OVER') return sendJson(res, 400, { error: 'Game is already over.' });
    advanceInactiveTurn(room, seat);
  } else {
    const auth = checkActionAuthorization(room, seat, clientAction, body);
    if (!auth.authorized) return sendJson(res, auth.status, { error: auth.error });

    const now = Date.now();
    room.lastActive = now;
    room.lastAction = { action: clientAction, by: seat.index, nickname: seat.name, time: now };
    if (clientAction === 'roll') {
      const dice = [randomInt(1, 7), randomInt(1, 7)];
      room.rollInFlight = false;
      room.rollStartTime = null;
      room.rollId = (room.rollId || 0) + 1;
      if (body.state && typeof body.state === 'object') room.game = body.state;
      Object.assign(room.lastAction, {
        action: 'dice', dice, rollId: room.rollId,
        consecutiveDoubles: dice[0] === dice[1] ? (room.game?.rolls || 0) + 1 : 0
      });
    } else {
      if (body.state && typeof body.state === 'object') room.game = body.state;
      const next = body.nextSeat ?? body.activeSeat ?? body.state?.turn;
      if (Number.isInteger(next)) room.activeSeat = next;
      room.lastAction.payload = body.payload;
      if (clientAction === 'endTurn') room.lastAction.nextSeat = room.activeSeat;
      else room.lastAction.dice = body.dice;
    }
  }

  room.stateVersion = version + 1;
  await saveRoomToStorage(room, req, version);
  return sendJson(res, 200, { success: true, ...roomResponse(room, seat) });
}

function invalidRoomCode(res) {
  return sendJson(res, 400, { error: 'Invalid room code format. Room code must be 4 alphanumeric characters.' });
}

function roomMissing(res, error = 'This room has been closed by the host.') {
  return sendJson(res, 404, { closed: true, error });
}
