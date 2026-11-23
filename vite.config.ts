import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const roomServer: Plugin = {
  name: 'business-room-server',
  async configureServer(server) {
    const { startRoomServer } = await import('./server/index.js');
    const rooms = startRoomServer(8787);
    server.httpServer?.once('close', () => rooms.close());
  },
};

export default defineConfig({ plugins: [react(), roomServer] });
