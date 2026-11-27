# Business — India Edition

A room-based property trading board game for 2–6 players, built with React, TypeScript, and Vite. Every player joins from their own browser using a 4-character room code.

---

## Quick Start (Run Locally)

```sh
npm install
npm run dev
```

`npm run dev` boots the Vite client and the local development room service concurrently on port `5173`. Open the displayed URL in two browser windows or separate devices on your local network, create a room in one, and join with the 4-character room code in the other.

---

## Production Deployment on Vercel + Upstash Redis

The game is designed for zero-maintenance serverless multiplayer using **Vercel Serverless Functions** (`/api/room`) backed by **Upstash Redis**.

### Step 1: Create an Upstash Redis Database
1. Go to [Upstash Console](https://console.upstash.com) and sign in.
2. Click **Create Database**:
   - **Name**: `monopoly-india` (or your choice)
   - **Type**: Regional or Global Serverless Redis
3. In the database details dashboard, scroll down to the **REST API** section.
4. Copy the values for:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### Step 2: Deploy to Vercel
1. Push your repository to GitHub or GitLab.
2. Import the project into [Vercel](https://vercel.com/new).
3. Under **Project Settings** > **Environment Variables**, add:
   | Key | Value | Description |
   | --- | --- | --- |
   | `UPSTASH_REDIS_REST_URL` | `https://your-upstash-url.upstash.io` | Upstash Redis REST endpoint |
   | `UPSTASH_REDIS_REST_TOKEN` | `your_upstash_token` | Upstash Bearer REST token |
4. Click **Deploy**.

> **Note on Deployment Health**: If `api/room` detects that it is running on Vercel without Upstash credentials configured, it will fail loudly with HTTP 500 (`UPSTASH_CONFIG_MISSING`) rather than silently falling back to ephemeral in-memory storage, ensuring room state is never silently lost between serverless function invocations.

---

## High-Performance Multiplayer Architecture

### 1. Optimistic Concurrency Control (OCC) & Atomic CAS
- The REST client includes an `expectedVersion` with each state mutation.
- The server validates version monotonicity and commits updates atomically via Redis Lua scripts (`storage.cas`).
- On `HTTP 409` (`VERSION_CONFLICT`), the client fetches the full board and recalculates the requested action if it still applies.

### 2. Redis Hygiene & Cheap Polling
- Fast `since` checks poll a lightweight string key (`monopoly:ver:<CODE>`) instead of fetching and parsing heavy JSON room payloads.
- When the version matches and no recovery is due, the endpoint returns `{ unchanged: true, stateVersion }` after one Redis read.
- Successful room writes renew the 24-hour TTL on the room, version, and player token keys.

### 3. Server-Side Security & Authoritative Logic
- **Seat Authorization**: Turn-bound actions (`roll`, `endTurn`, `buy`, `liquidate`) verify that the request token matches `room.activeSeat`. Unauthorized actions return `HTTP 403`.
- **Server Dice Generation**: Dice are rolled cryptographically on the server using Node's `crypto.randomInt(1, 7)`. Client-supplied dice arrays are strictly ignored.
- **Token Security**: Session tokens are scoped exclusively to the authenticated caller and never leaked in public lists, game states, or action payloads.
- **Rate Limiting**: Throttles bursts exceeding 10 actions/second per player token with `HTTP 429`.

### 4. Stuck-State Recovery
- **Stuck Roll Invalidation**: Any roll in flight older than 5,000ms is automatically cleared upon the next room access.
- **Inactive Player Skip**: If an active player remains idle for 45+ seconds, any seated player can call `skipInactive` to advance the turn.
- **Host Resilience**: If the host leaves, the next remaining player takes over. In a live match, players keep their original seat numbers.

---

## Testing & Verification

Run the test suite to verify concurrency, security, and game invariants:

```sh
# Verify Concurrency, Atomic CAS, OCC & Redis Hygiene (27 tests)
node tests/concurrency-test.mjs

# Verify Server-Side Authorization, Cryptographic Dice & Stuck-State Recovery (17 tests)
node tests/stage2-test.mjs

# Verify Deploy Configuration & Vercel Health Check
node tests/deploy-test.mjs

# Run full Chaos Simulation Suite (50-100 full matches, 4,000-8,000 turns)
node tests/chaos-test.mjs 50
```
