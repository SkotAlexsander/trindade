import { useMemo } from 'react';
import { Perm, can, type PermName } from '@trindade/shared';
import { useAuth } from './store';

/**
 * O que **exibir**.
 *
 * Esconder um botão não é controle de acesso: a mesma checagem existe no
 * servidor, e é lá que ela vale. As duas coisas, sempre — a de cá para a
 * interface não oferecer o que vai dar erro, a de lá para valer de verdade.
 * Ver CLAUDE.md.
 *
 * As permissões vêm da store, que o `PERMISSIONS_UPDATE` atualiza sem
 * recarregar: mudar o cargo de alguém reflete na tela dessa pessoa na hora.
 */
export function usePermissions(): {
  can: (nome: PermName) => boolean;
  isAdmin: boolean;
  raw: bigint;
} {
  const permissions = useAuth((s) => s.permissions);

  return useMemo(
    () => ({
      can: (nome: PermName) => can(permissions, Perm[nome]),
      isAdmin: (permissions & Perm.ADMINISTRATOR) !== 0n,
      raw: permissions,
    }),
    [permissions],
  );
}
