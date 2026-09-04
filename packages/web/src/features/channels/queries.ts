import { useQuery } from '@tanstack/react-query';
import type { Channel, User } from '@trindade/shared';
import { api } from '../../lib/http';

/**
 * Canais e pessoas mudam raramente e são poucos. `staleTime` de 5 minutos
 * evita refazer a consulta a cada navegação; o que muda de verdade chega pelo
 * WebSocket na fase 5. Ver docs/02-arquitetura.md.
 */
const CINCO_MINUTOS = 5 * 60 * 1000;

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: Channel[] }>('/channels').then((r) => r.channels),
    staleTime: CINCO_MINUTOS,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: User[] }>('/users').then((r) => r.users),
    staleTime: CINCO_MINUTOS,
  });
}
