import { Perm, can } from '@trindade/shared';
import { forbidden } from './errors.js';
import * as usersDb from '../db/users.js';
import type { RoleRow } from '../db/users.js';

/**
 * Quem manda em quem.
 *
 * Sem estas duas regras, `MANAGE_ROLES` **é** `ADMINISTRATOR`: quem pode
 * atribuir cargos se atribui o de administrador no primeiro clique. E
 * `MANAGE_MEMBERS` viraria a chave do servidor inteiro, porque desativaria o
 * dono.
 *
 * A régua é a `position` do maior cargo de cada pessoa. Quem não tem cargo
 * nenhum fica em -1, e não em 0 — 0 é a posição real do cargo `Membro`.
 *
 * `ADMINISTRATOR` passa por cima das duas: é o único cargo do projeto que
 * ignora checagem, e isso está dito em `perms.ts`. Um administrador ainda não
 * consegue mexer em outro administrador de posição maior, porque a comparação
 * de posições continua valendo entre eles.
 */

export interface Autor {
  id: string;
  permissions: bigint;
}

/** A posição do maior cargo. `ADMINISTRATOR` recebe o infinito. */
export async function alcanceDe(pessoa: Autor): Promise<number> {
  if (can(pessoa.permissions, Perm.ADMINISTRATOR)) return Number.POSITIVE_INFINITY;
  return usersDb.maiorPosicao(pessoa.id);
}

/**
 * Lança quando o cargo está no seu nível ou acima.
 *
 * "Ou acima" e não só "acima": mexer num cargo igual ao seu é mexer no próprio
 * poder — dois `Admin` de mesma posição poderiam se remover em círculo.
 */
export async function exigirAlcanceSobreCargo(
  autor: Autor,
  cargos: readonly Pick<RoleRow, 'position' | 'name'>[],
): Promise<void> {
  const meu = await alcanceDe(autor);
  const acima = cargos.find((c) => c.position >= meu);
  if (acima) {
    throw forbidden(
      'HIERARCHY_VIOLATION',
      `o cargo "${acima.name}" está no seu nível ou acima — você não pode mexer nele`,
    );
  }
}

/** Lança quando o alvo tem cargo igual ou maior que o seu. */
export async function exigirAlcanceSobrePessoa(autor: Autor, alvoId: string): Promise<void> {
  // Mexer em si mesmo por esta porta nunca é o que a pessoa quis: desativar a
  // própria conta pela tela de gestão é acidente, e o alcance sobre si mesmo é
  // sempre empate — a regra do "ou acima" derrubaria de qualquer jeito, mas
  // com uma mensagem que não explica nada.
  if (autor.id === alvoId) {
    throw forbidden('HIERARCHY_VIOLATION', 'você não pode fazer isso com a sua própria conta');
  }

  const meu = await alcanceDe(autor);
  const dela = await usersDb.maiorPosicao(alvoId);
  if (dela >= meu) {
    throw forbidden(
      'HIERARCHY_VIOLATION',
      'essa pessoa tem cargo igual ou maior que o seu',
    );
  }
}
