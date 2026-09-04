import { create } from 'zustand';

/**
 * Estado local. Presença nunca passa pelo TanStack Query: vive aqui e é
 * alimentada só pelo WebSocket. Ver docs/02-arquitetura.md.
 */
interface ConnectionState {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));
