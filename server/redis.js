import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';

const ROOM_TTL_SECONDS = 86400; // 24 hours
const KEY_PREFIX = 'monopoly:room:';
const TOKEN_PREFIX = 'monopoly:token:';
const ROOMS_SET_KEY = 'monopoly:rooms';

// RESP (REdis Serialization Protocol) Parser
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

// Built-in TCP/TLS Redis Client
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
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
  }

  connect() {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    const isTls = this.url.protocol === 'rediss:';
    const port = Number(this.url.port || 6379);
    const host = this.url.hostname || '127.0.0.1';

    const onConnect = async () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectDelay = 1000;
      this.parser = new RespParser();

      try {
        const password = this.url.password || process.env.REDIS_PASSWORD;
        const username = this.url.username && this.url.username !== 'default' ? this.url.username : null;
        if (password && username) {
          await this.cmd('AUTH', username, password);
        } else if (password) {
          await this.cmd('AUTH', password);
        }
        console.log(`[Redis] Connected successfully to ${isTls ? 'rediss' : 'redis'}://${host}:${port}`);
        this.emit('ready');
      } catch (err) {
        console.warn('[Redis] Auth warning:', err?.message || err);
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
        // Log cleanly without crashing
        if (!this.connected) {
          // Initial connection failure
        } else {
          console.warn('[Redis] Connection warning:', err?.message || err);
        }
        this._cleanup();
      });

      socket.on('close', () => {
        this._cleanup();
        this._scheduleReconnect();
      });
    } catch (err) {
      this._cleanup();
      this._scheduleReconnect();
    }
  }

  _cleanup() {
    this.connected = false;
    this.connecting = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }
    // Reject any queued items on disconnect so callers don't hang
    while (this.queue.length > 0) {
      const pending = this.queue.shift();
      pending?.reject(new Error('Redis connection closed'));
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  cmd(...args) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        return reject(new Error('Redis client is not connected'));
      }
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

  async get(key) {
    return this.cmd('GET', key);
  }

  async set(key, value, ...options) {
    return this.cmd('SET', key, value, ...options);
  }

  async del(key) {
    return this.cmd('DEL', key);
  }

  async sadd(key, member) {
    return this.cmd('SADD', key, member);
  }

  async srem(key, member) {
    return this.cmd('SREM', key, member);
  }

  async smembers(key) {
    const res = await this.cmd('SMEMBERS', key);
    return Array.isArray(res) ? res : [];
  }
}

// Upstash REST Client (for HTTP/HTTPS URLs)
class UpstashRestClient {
  constructor(urlStr, token) {
    this.url = urlStr.replace(/\/+$/, '');
    this.token = token || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  }

  async _fetch(command, ...args) {
    const res = await fetch(`${this.url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify([command, ...args]),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Upstash error: ${res.statusText}`);
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

// In-Memory Fallback Client
class InMemoryClient {
  constructor() {
    this.store = new Map();
    this.sets = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async set(key, value) {
    this.store.set(key, String(value));
    return 'OK';
  }
  async del(key) {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
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
    const removed = s.delete(String(member));
    return removed ? 1 : 0;
  }
  async smembers(key) {
    const s = this.sets.get(key);
    return s ? Array.from(s) : [];
  }
}

// Singleton state
let redisClient = null;
let isConfigured = false;

export function initRedis(urlOverride) {
  const rawUrl = urlOverride ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    process.env.KV_URL ||
    '';

  if (!rawUrl.trim()) {
    console.log('[Redis] No REDIS_URL configured; using in-memory room persistence.');
    redisClient = new InMemoryClient();
    isConfigured = false;
    return redisClient;
  }

  try {
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.REDIS_TOKEN || '';
      console.log(`[Redis] Using Upstash REST client with URL: ${trimmed.replace(/:[^:@]+@/, ':***@')}`);
      redisClient = new UpstashRestClient(trimmed, token);
      isConfigured = true;
    } else {
      console.log(`[Redis] Initializing client for ${trimmed.replace(/:[^:@]+@/, ':***@')}`);
      redisClient = new NativeRedisClient(trimmed);
      redisClient.connect();
      isConfigured = true;
    }
  } catch (err) {
    console.warn('[Redis] Failed to initialize client, falling back to in-memory:', err?.message || err);
    redisClient = new InMemoryClient();
    isConfigured = false;
  }

  return redisClient;
}

export function getRedisClient() {
  if (!redisClient) {
    initRedis();
  }
  return redisClient;
}

export function isRedisActive() {
  return isConfigured;
}

/**
 * Persist room state and player tokens to Redis (or fallback).
 */
export async function saveRoom(room) {
  if (!room || !room.code) return;
  const client = getRedisClient();
  const roomKey = `${KEY_PREFIX}${room.code.toUpperCase()}`;

  const payload = JSON.stringify({
    code: room.code.toUpperCase(),
    seats: room.seats.map(s => ({
      token: s.token,
      name: s.name,
      index: s.index
    })),
    activeSeat: room.activeSeat,
    game: room.game,
    rollInFlight: Boolean(room.rollInFlight),
    rollId: room.rollId || 0,
    stateVersion: room.stateVersion || 0,
    lastActive: room.lastActive || Date.now()
  });

  try {
    await client.set(roomKey, payload, 'EX', ROOM_TTL_SECONDS);
    await client.sadd(ROOMS_SET_KEY, room.code.toUpperCase());

    // Map each player token to this room for quick token-only reconnects
    for (const seat of room.seats) {
      if (seat.token) {
        await client.set(`${TOKEN_PREFIX}${seat.token}`, room.code.toUpperCase(), 'EX', ROOM_TTL_SECONDS);
      }
    }
  } catch (err) {
    // Non-fatal; game continues seamlessly in memory
    console.warn(`[Redis] saveRoom failed for ${room.code}:`, err?.message || err);
  }
}

/**
 * Load room data from Redis by room code.
 */
export async function getRoom(code) {
  if (!code) return null;
  const client = getRedisClient();
  const roomKey = `${KEY_PREFIX}${code.toUpperCase()}`;

  try {
    const raw = await client.get(roomKey);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.warn(`[Redis] getRoom failed for ${code}:`, err?.message || err);
    return null;
  }
}

/**
 * Look up room code by player session token.
 */
export async function getRoomCodeByToken(token) {
  if (!token) return null;
  const client = getRedisClient();
  try {
    const code = await client.get(`${TOKEN_PREFIX}${token}`);
    return code || null;
  } catch (err) {
    return null;
  }
}

/**
 * Delete a room from Redis when finished or purged.
 */
export async function deleteRoom(code) {
  if (!code) return;
  const client = getRedisClient();
  const roomCode = code.toUpperCase();
  try {
    await client.del(`${KEY_PREFIX}${roomCode}`);
    await client.srem(ROOMS_SET_KEY, roomCode);
  } catch (err) {
    console.warn(`[Redis] deleteRoom failed for ${roomCode}:`, err?.message || err);
  }
}

/**
 * Load all persisted rooms from Redis (e.g. upon server startup or reboot).
 */
export async function loadAllPersistedRooms() {
  const client = getRedisClient();
  const rooms = [];
  try {
    const codes = await client.smembers(ROOMS_SET_KEY);
    for (const code of codes) {
      const data = await getRoom(code);
      if (data && data.code) {
        rooms.push(data);
      }
    }
  } catch (err) {
    console.warn('[Redis] loadAllPersistedRooms error:', err?.message || err);
  }
  return rooms;
}
