import { effectivePermissions } from '../lib/auth/permissions.js';
import * as usersDb from '../db/users.js';
import { toApiUser } from './user-view.js';
import { gateway } from '../ws/index.js';

/**
 * Conta a alguém que os cargos dela mudaram — agora, não na próxima
 * revalidação.
 *
 * Dois eventos, e os dois são necessários: `PERMISSIONS_UPDATE` só para a
 * pessoa, porque é o que ajusta o que ela pode fazer; `USER_UPDATE` para
 * todos, porque o chip de cargo e a cor do nome dela aparecem na tela dos
 * outros.
 */
export async function avisarPessoa(userId: string): Promise<void> {
  const linha = await usersDb.findUserById(userId);
  if (!linha) return;

  const cargos = await usersDb.findRolesOfUser(userId);
  gateway.avisarPermissoes(userId, effectivePermissions(cargos));
  gateway.broadcast({ op: 'USER_UPDATE', d: toApiUser(linha, cargos) });
}
