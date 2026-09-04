import { create } from 'zustand';
import type { Role, User } from '@trindade/shared';
import { can, combinePermissions } from '@trindade/shared';
import { api, setAccessToken } from '../../lib/http';

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated';

interface MeResponse {
  user: User;
  permissions: string;
  roles: Role[];
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** bigint, não número: 64 bits não cabem em `number`. */
  permissions: bigint;
  roles: Role[];
  setSession: (user: User, access: string) => void;
  loadMe: () => Promise<void>;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  permissions: 0n,
  roles: [],

  setSession: (user, access) => {
    setAccessToken(access);
    set({
      status: 'authenticated',
      user,
      roles: user.roles,
      permissions: combinePermissions(user.roles),
    });
  },

  loadMe: async () => {
    const me = await api<MeResponse>('/me');
    set({
      status: 'authenticated',
      user: me.user,
      roles: me.roles,
      permissions: BigInt(me.permissions),
    });
  },

  clear: () => {
    setAccessToken(null);
    set({ status: 'anonymous', user: null, permissions: 0n, roles: [] });
  },
}));

/**
 * Só decide o que **exibir**. Esconder um botão não é controle de acesso: a
 * mesma checagem existe no servidor, e é lá que ela vale. Ver CLAUDE.md.
 */
export function usePermission(need: bigint): boolean {
  return can(useAuth((state) => state.permissions), need);
}
