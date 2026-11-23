# Business — India Edition

A room-based property trading board game for 2–6 players, built with React, TypeScript, and Vite. Every player joins from their own browser using a room code.

## Run locally

```sh
npm install
npm run dev
```

Run `npm run dev`. Vite starts the client and its local room connection together; no second terminal or separate server command is needed. Open the displayed Vite URL in two browser profiles (or devices on the same network), create a room in one, then join with its four-character code in the other. Vite serves the game on port 5173 and the local room connection on port 8787.

## Game

Create or join a room in the lobby. The host configures and starts the match after at least two players have joined. Each browser controls its own seat; refresh reconnects using the room-specific player token saved in that browser.

The local room service is for development and two-browser play on your network. Vercel production room hosting still needs its serverless room endpoint and Redis connection configured before deployment.
