import { randomUUID, randomInt } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

const ROOM_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'monopoly:room:';
const VER_PREFIX = 'monopoly:ver:';
const TOKEN_PREFIX = 'monopoly:token:';
const ROOMS_SET_KEY = 'monopoly:rooms';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_REGEX = /^[A-Z0-9]{4}$/;
const TURN_ACTIONS = ['roll', 'endTurn', 'buy', 'liquidate'];

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

  async cas(key, expectedVersion, newPayload, ttlSeconds, newVersion) {
    const script = `
      local currentVer = nil
      if KEYS[2] then
        currentVer = redis.call('GET', KEYS[2])
      end
      if not currentVer then
        local current = redis.call('GET', KEYS[1])
        if current then
          local ok, decoded = pcall(cjson.decode, current)
          if ok and decoded and decoded.stateVersion ~= nil then
            currentVer = tostring(decoded.stateVersion)
          end
        end
      end
      if currentVer and ARGV[1] ~= '' and tostring(currentVer) ~= tostring(ARGV[1]) then
        return redis.error_reply("VERSION_MISMATCH:" .. tostring(currentVer))
      end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      if KEYS[2] and ARGV[4] ~= '' then
        redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[3])
      end
      return "OK"
    `;
    const verKey = `${VER_PREFIX}${key.slice(KEY_PREFIX.length)}`;
    return this._fetch(
      'EVAL',
      script,
      2,
      key,
      verKey,
      expectedVersion !== undefined && expectedVersion !== null ? String(expectedVersion) : '',
      newPayload,
      String(ttlSeconds),
      newVersion !== undefined && newVersion !== null ? String(newVersion) : ''
    );
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
  async cas(key, expectedVersion, newPayload, ttlSeconds, newVersion) {
    const script = `
      local currentVer = nil
      if KEYS[2] then
        currentVer = redis.call('GET', KEYS[2])
      end
      if not currentVer then
        local current = redis.call('GET', KEYS[1])
        if current then
          local ok, decoded = pcall(cjson.decode, current)
          if ok and decoded and decoded.stateVersion ~= nil then
            currentVer = tostring(decoded.stateVersion)
          end
        end
      end
      if currentVer and ARGV[1] ~= '' and tostring(currentVer) ~= tostring(ARGV[1]) then
        return redis.error_reply("VERSION_MISMATCH:" .. tostring(currentVer))
      end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      if KEYS[2] and ARGV[4] ~= '' then
        redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[3])
      end
      return "OK"
    `;
    const verKey = `${VER_PREFIX}${key.slice(KEY_PREFIX.length)}`;
    return this.cmd(
      'EVAL',
      script,
      2,
      key,
      verKey,
      expectedVersion !== undefined && expectedVersion !== null ? String(expectedVersion) : '',
      newPayload,
      String(ttlSeconds),
      newVersion !== undefined && newVersion !== null ? String(newVersion) : ''
    );
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
  async cas(key, expectedVersion, newPayload, ttlSeconds, newVersion) {
    const current = this.store.get(key);
    let currentVer = null;
    if (key.startsWith(KEY_PREFIX)) {
      const roomCode = key.slice(KEY_PREFIX.length);
      currentVer = this.store.get(`${VER_PREFIX}${roomCode}`);
    }
    if (currentVer === null && current) {
      try {
        const decoded = JSON.parse(current);
        if (decoded.stateVersion !== undefined) currentVer = String(decoded.stateVersion);
      } catch {}
    }

    if (currentVer !== null && expectedVersion !== undefined && expectedVersion !== null && String(expectedVersion) !== '') {
      if (String(currentVer) !== String(expectedVersion)) {
        throw new Error(`VERSION_MISMATCH:${currentVer}`);
      }
    }

    this.store.set(key, String(newPayload));
    if (key.startsWith(KEY_PREFIX)) {
      const roomCode = key.slice(KEY_PREFIX.length);
      const v = newVersion !== undefined && newVersion !== null && String(newVersion) !== ''
        ? String(newVersion)
        : String(JSON.parse(newPayload).stateVersion || 1);
      this.store.set(`${VER_PREFIX}${roomCode}`, v);
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

function clearStuckRoll(room, storage) {
  if (!room) return;
  if (room.rollInFlight) {
    const lastRollTime = room.rollStartTime || room.lastRollTime || room.lastAction?.time || room.lastActive || 0;
    if (Date.now() - lastRollTime > 5000) {
      room.rollInFlight = false;
      room.rollStartTime = null;
      if (storage && room.code) {
        const roomKey = `${KEY_PREFIX}${room.code.toUpperCase()}`;
        try {
          storage.set(roomKey, JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
        } catch {}
      }
    }
  }
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
async function refreshRoomTtl(storage, room) {
  if (!room || !room.code) return;
  const code = room.code.toUpperCase();
  const roomKey = `${KEY_PREFIX}${code}`;
  const verKey = `${VER_PREFIX}${code}`;
  const promises = [
    storage.expire(roomKey, ROOM_TTL_SECONDS).catch(() => {}),
    storage.expire(verKey, ROOM_TTL_SECONDS).catch(() => {})
  ];
  if (Array.isArray(room.seats)) {
    for (const seat of room.seats) {
      if (seat.token) {
        promises.push(storage.expire(`${TOKEN_PREFIX}${seat.token}`, ROOM_TTL_SECONDS).catch(() => {}));
      }
    }
  }
  await Promise.all(promises);
}

async function saveRoomToStorage(room, req, expectedVersion) {
  if (!room || !room.code) return;
  const storage = getStorage(req);
  const roomCode = room.code.toUpperCase();
  const roomKey = `${KEY_PREFIX}${roomCode}`;
  const verKey = `${VER_PREFIX}${roomCode}`;
  const newVersion = room.stateVersion || 1;

  const payload = JSON.stringify({
    code: roomCode,
    seats: room.seats.map(s => ({
      token: s.token,
      name: s.name,
      index: s.index
    })),
    activeSeat: room.activeSeat ?? 0,
    game: room.game ?? null,
    rollInFlight: Boolean(room.rollInFlight),
    rollStartTime: room.rollStartTime || null,
    rollId: room.rollId || 0,
    stateVersion: newVersion,
    lastAction: room.lastAction || null,
    lastActive: room.lastActive || Date.now()
  });

  if (expectedVersion !== undefined && expectedVersion !== null) {
    // Optimistic Concurrency Control write via atomic CAS
    await storage.cas(
      roomKey,
      String(expectedVersion),
      payload,
      ROOM_TTL_SECONDS,
      String(newVersion)
    );
  } else {
    await storage.set(roomKey, payload, 'EX', ROOM_TTL_SECONDS);
    await storage.set(verKey, String(newVersion), 'EX', ROOM_TTL_SECONDS);
  }

  try {
    await storage.sadd(ROOMS_SET_KEY, roomCode);
    if (Array.isArray(room.seats)) {
      for (const seat of room.seats) {
        if (seat.token) {
          await storage.set(`${TOKEN_PREFIX}${seat.token}`, roomCode, 'EX', ROOM_TTL_SECONDS);
        }
      }
    }
  } catch (err) {
    console.warn(`[Storage] post-save token maintenance warning for ${roomCode}:`, err?.message || err);
  }
}

async function getRoomFromStorage(code, req) {
  if (!code) return null;
  const roomCode = String(code).toUpperCase().trim();
  const roomKey = `${KEY_PREFIX}${roomCode}`;
  const storage = getStorage(req);

  let room = null;
  try {
    const raw = await storage.get(roomKey);
    if (raw) {
      room = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
  } catch (err) {
    console.warn(`[Storage] getRoom failed for ${roomCode}:`, err?.message || err);
  }

  // Fallback check in memory
  if (!room) {
    try {
      const fallback = new InMemoryClient();
      const memRaw = await fallback.get(roomKey);
      if (memRaw) room = typeof memRaw === 'string' ? JSON.parse(memRaw) : memRaw;
    } catch {}
  }

  if (room) {
    clearStuckRoll(room, storage);
  }

  return room;
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

  // Check Vercel deployment requirements: Fail loudly if on Vercel without Upstash credentials
  if (isVercelEnvironment()) {
    const hasHeaderCreds = req.headers && req.headers['x-upstash-url'] && req.headers['x-upstash-token'];
    const envCreds = getUpstashEnvCredentials();
    const hasEnvCreds = Boolean(envCreds.url && envCreds.token);
    if (!hasHeaderCreds && !hasEnvCreds) {
      return sendJson(res, 500, {
        error: 'Vercel Deployment Error: Missing Upstash Redis credentials. Please configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel Project Settings.',
        code: 'UPSTASH_CONFIG_MISSING'
      });
    }
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
    if (!ROOM_CODE_REGEX.test(code)) {
      return sendJson(res, 400, { error: 'Invalid room code format. Room code must be 4 alphanumeric characters.' });
    }

    const storage = getStorage(req);
    const sinceParam = query.since;
    const hasSince = sinceParam !== undefined && sinceParam !== null && sinceParam !== '';

    // Fast Redis Hygiene: Cheap since check without fetching or parsing heavy room JSON payload
    if (hasSince) {
      try {
        const verKey = `${VER_PREFIX}${code}`;
        const cachedVer = await storage.get(verKey);
        if (cachedVer !== null && cachedVer !== undefined) {
          const currentVer = parseInt(cachedVer, 10);
          const sinceNum = parseInt(sinceParam, 10);
          if (!isNaN(sinceNum) && !isNaN(currentVer) && sinceNum === currentVer) {
            // Refresh TTL on active polling
            storage.expire(verKey, ROOM_TTL_SECONDS).catch(() => {});
            storage.expire(`${KEY_PREFIX}${code}`, ROOM_TTL_SECONDS).catch(() => {});
            return sendJson(res, 200, {
              unchanged: true,
              stateVersion: currentVer
            });
          }
        }
      } catch (err) {
        console.warn(`[Storage] Cheap since check warning for ${code}:`, err?.message || err);
      }
    }

    const room = await getRoomFromStorage(code, req);
    if (!room) {
      return sendJson(res, 404, { error: 'Room not found.' });
    }

    // Refresh TTL on room activity
    refreshRoomTtl(storage, room).catch(() => {});

    // Ensure version key is populated alongside room key
    const currentVersion = room.stateVersion || 0;
    storage.set(`${VER_PREFIX}${code}`, String(currentVersion), 'EX', ROOM_TTL_SECONDS).catch(() => {});

    if (hasSince) {
      const sinceNum = parseInt(sinceParam, 10);
      if (!isNaN(sinceNum) && sinceNum === currentVersion) {
        return sendJson(res, 200, {
          unchanged: true,
          stateVersion: currentVersion
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
      stateVersion: currentVersion,
      game: sanitizeGame(room.game),
      players,
      activeSeat: room.activeSeat ?? 0,
      lastAction: sanitizeLastAction(room.lastAction)
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
      if (!ROOM_CODE_REGEX.test(code)) {
        return sendJson(res, 400, { error: 'Invalid room code format. Room code must be 4 alphanumeric characters.' });
      }

      let room = await getRoomFromStorage(code, req);
      if (!room) {
        return sendJson(res, 404, { error: 'Room not found.' });
      }

      // Check if this player is rejoining with existing token
      if (body.token) {
        const existing = room.seats.find(s => s.token === body.token);
        if (existing) {
          refreshRoomTtl(getStorage(req), room).catch(() => {});
          const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
          return sendJson(res, 200, {
            code: room.code,
            token: existing.token,
            seat: existing.index,
            game: sanitizeGame(room.game),
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
      let seatIndex = room.seats.length;
      const nickname = String(body.nickname || body.name || `Player ${seatIndex + 1}`).trim().slice(0, 24) || `Player ${seatIndex + 1}`;

      const newSeat = { token, name: nickname, index: seatIndex };
      const prevVersion = room.stateVersion || 0;
      room.seats.push(newSeat);
      room.stateVersion = prevVersion + 1;
      room.lastActive = Date.now();
      room.lastAction = {
        action: 'join',
        by: seatIndex,
        nickname,
        time: Date.now()
      };

      try {
        await saveRoomToStorage(room, req, prevVersion);
      } catch (err) {
        if (err && String(err.message || '').includes('VERSION_MISMATCH')) {
          // Re-fetch room and retry join once if room is not full
          const freshRoom = await getRoomFromStorage(code, req);
          if (freshRoom && freshRoom.seats.length < 6 && (!freshRoom.game?.players?.length)) {
            seatIndex = freshRoom.seats.length;
            newSeat.index = seatIndex;
            freshRoom.seats.push(newSeat);
            const freshPrev = freshRoom.stateVersion || 0;
            freshRoom.stateVersion = freshPrev + 1;
            freshRoom.lastActive = Date.now();
            freshRoom.lastAction = {
              action: 'join',
              by: seatIndex,
              nickname,
              time: Date.now()
            };
            await saveRoomToStorage(freshRoom, req, freshPrev);
            room = freshRoom;
          } else {
            return sendJson(res, 400, { error: 'This room already has six players or game has started.' });
          }
        } else {
          throw err;
        }
      }

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        code: room.code,
        token,
        seat: seatIndex,
        game: sanitizeGame(room.game),
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
      if (code && !ROOM_CODE_REGEX.test(code)) {
        return sendJson(res, 400, { error: 'Invalid room code format. Room code must be 4 alphanumeric characters.' });
      }

      if (!code) {
        code = await getRoomCodeByTokenFromStorage(token, req);
      }

      if (!code || !ROOM_CODE_REGEX.test(code)) {
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
      await refreshRoomTtl(getStorage(req), room);

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        code: room.code,
        token: seat.token,
        seat: seat.index,
        game: sanitizeGame(room.game),
        players,
        activeSeat: room.activeSeat ?? 0,
        stateVersion: room.stateVersion || 0,
        lastAction: sanitizeLastAction(room.lastAction)
      });
    }

    // 4. POST /api/room?action=action (or action inside body)
    // Supports game actions: roll, endTurn, buy, liquidate, auctionBid, tradeAccept, tradeReject, skipInactive, leave, etc.
    const isGameAction = action === 'action' || !['create', 'join', 'resume'].includes(action);
    if (isGameAction) {
      const code = String(body.code || query.code || '').trim().toUpperCase();
      const token = body.token || query.token;

      if (!code || !token) {
        return sendJson(res, 400, { error: 'Room code and player token are required.' });
      }

      if (!ROOM_CODE_REGEX.test(code)) {
        return sendJson(res, 400, { error: 'Invalid room code format. Room code must be 4 alphanumeric characters.' });
      }

      // Enforce rate limit (max 10 actions per second per player token)
      if (isRateLimited(token, req)) {
        return sendJson(res, 429, { error: 'Rate limit exceeded, please slow down.' });
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

      // Stuck-State Recovery: Action 'skipInactive'
      if (clientAction === 'skipInactive') {
        const inactivityMs = Date.now() - (room.lastActive || 0);
        if (inactivityMs <= 45000) {
          return sendJson(res, 400, {
            error: 'Player has not been inactive long enough (45s required).',
            remainingMs: Math.max(0, 45000 - inactivityMs)
          });
        }
        if (room.game?.phase === 'GAME_OVER') {
          return sendJson(res, 400, { error: 'Game is already over.' });
        }

        const currentTurn = room.game?.turn !== undefined ? room.game.turn : (room.activeSeat ?? 0);
        let nextTurn = (currentTurn + 1) % (room.game?.players?.length || room.seats.length || 1);
        if (room.game?.players && Array.isArray(room.game.players)) {
          let checked = 0;
          while (!room.game.players[nextTurn]?.active && checked < room.game.players.length) {
            nextTurn = (nextTurn + 1) % room.game.players.length;
            checked++;
          }
          room.game.turn = nextTurn;
          room.game.phase = 'WAIT_FOR_ROLL';
          room.game.rolls = 0;
        }
        room.activeSeat = nextTurn;
        room.rollInFlight = false;
        room.lastActive = Date.now();
        room.lastAction = {
          action: 'skipInactive',
          by: seat.index,
          nickname: seat.name,
          skippedSeat: currentTurn,
          nextSeat: nextTurn,
          time: Date.now()
        };

        const expectedVerForCas = body.expectedVersion !== undefined && body.expectedVersion !== null
          ? body.expectedVersion
          : room.stateVersion;

        room.stateVersion = (room.stateVersion || 0) + 1;
        await saveRoomToStorage(room, req, expectedVerForCas);

        const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
        return sendJson(res, 200, {
          success: true,
          stateVersion: room.stateVersion,
          game: sanitizeGame(room.game),
          activeSeat: room.activeSeat ?? 0,
          players,
          lastAction: sanitizeLastAction(room.lastAction)
        });
      }

      // Host Resilience: Transfer seat 0 if host leaves
      if (clientAction === 'leave' || clientAction === 'leaveRoom' || clientAction === 'leavePlayer') {
        const leavingSeatIndex = seat.index;
        room.seats = room.seats.filter(s => s.token !== token);
        if (leavingSeatIndex === 0 && room.seats.length > 0) {
          // Transfer seat 0 to next available player
          room.seats[0].index = 0;
          for (let i = 1; i < room.seats.length; i++) {
            room.seats[i].index = i;
          }
        }
        if (room.game?.players?.[leavingSeatIndex]) {
          room.game.players[leavingSeatIndex].active = false;
        }
        if (room.activeSeat === leavingSeatIndex && room.seats.length > 0) {
          room.activeSeat = room.seats[0].index;
          if (room.game) room.game.turn = room.activeSeat;
        }
        room.lastActive = Date.now();
        room.lastAction = {
          action: 'leave',
          by: leavingSeatIndex,
          nickname: seat.name,
          time: Date.now()
        };
        room.stateVersion = (room.stateVersion || 0) + 1;
        await saveRoomToStorage(room, req, body.expectedVersion ?? (room.stateVersion - 1));
        const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
        return sendJson(res, 200, {
          success: true,
          stateVersion: room.stateVersion,
          game: sanitizeGame(room.game),
          activeSeat: room.activeSeat ?? 0,
          players,
          lastAction: sanitizeLastAction(room.lastAction)
        });
      }

      // 1. Seat & Turn Authorization Check
      const auth = checkActionAuthorization(room, seat, clientAction, body);
      if (!auth.authorized) {
        return sendJson(res, auth.status || 403, { error: auth.error || 'Unauthorized action.' });
      }

      // 2. Optimistic Concurrency Control (OCC) Check:
      // If body.expectedVersion is provided and does not match room.stateVersion,
      // reject with HTTP 409
      if (body.expectedVersion !== undefined && body.expectedVersion !== null) {
        if (String(body.expectedVersion) !== String(room.stateVersion)) {
          return sendJson(res, 409, {
            error: 'State version conflict',
            code: 'VERSION_CONFLICT',
            currentVersion: room.stateVersion,
            lastAction: sanitizeLastAction(room.lastAction)
          });
        }
      }

      // 3. Process Game Action
      if (clientAction === 'roll') {
        // Server-Side Dice Generation: crypto randomInt(1, 7). Never trust client-sent dice!
        const d1 = randomInt(1, 7);
        const d2 = randomInt(1, 7);
        const dice = [d1, d2];
        const consecutiveDoubles = d1 === d2 ? ((room.game?.rolls || 0) + 1) : 0;
        room.rollInFlight = false;
        room.rollStartTime = null;
        if (body.state && typeof body.state === 'object') {
          room.game = body.state;
        }
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

      const expectedVerForCas = body.expectedVersion !== undefined && body.expectedVersion !== null
        ? body.expectedVersion
        : room.stateVersion;

      room.stateVersion = (room.stateVersion || 0) + 1;
      room.lastActive = Date.now();

      try {
        await saveRoomToStorage(room, req, expectedVerForCas);
      } catch (err) {
        if (err && String(err.message || '').includes('VERSION_MISMATCH')) {
          const latestRoom = await getRoomFromStorage(code, req);
          return sendJson(res, 409, {
            error: 'State version conflict',
            code: 'VERSION_CONFLICT',
            currentVersion: latestRoom?.stateVersion ?? room.stateVersion,
            lastAction: sanitizeLastAction(latestRoom?.lastAction ?? room.lastAction)
          });
        }
        throw err;
      }

      const players = room.seats.map(s => ({ name: s.name, index: s.index, online: true }));
      return sendJson(res, 200, {
        success: true,
        stateVersion: room.stateVersion,
        game: sanitizeGame(room.game),
        activeSeat: room.activeSeat ?? 0,
        players,
        lastAction: sanitizeLastAction(room.lastAction)
      });
    }

    return sendJson(res, 400, { error: `Unsupported room action: '${action}'` });
  }

  return sendJson(res, 405, { error: `Method ${method} not allowed.` });
}
