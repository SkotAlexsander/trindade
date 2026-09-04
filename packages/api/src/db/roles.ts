import { sql } from './index.js';
import type { RoleRow } from './users.js';

/**
 * Cargos.
 *
 * `position` é a hierarquia inteira: quem tem o cargo mais alto manda em quem
 * tem cargo mais baixo, e ninguém mexe em cargo igual ou acima do seu. As
 * checagens ficam nas rotas — aqui só se lê e escreve.
 *
 * `permissions` sempre sai como texto: é `bigint` no banco e não sobrevive ao
 * JSON como número.
 */

const COLUNAS = sql`id, name, color, position, permissions::text as permissions, is_default`;

export async function listRoles(): Promise<RoleRow[]> {
  return sql<RoleRow[]>`select ${COLUNAS} from roles order by position desc, name`;
}

export async function findRoleById(id: string): Promise<RoleRow | null> {
  const linhas = await sql<RoleRow[]>`select ${COLUNAS} from roles where id = ${id}`;
  return linhas[0] ?? null;
}

export async function findRolesByIds(ids: readonly string[]): Promise<RoleRow[]> {
  if (ids.length === 0) return [];
  return sql<RoleRow[]>`
    select ${COLUNAS} from roles where id = any(${sql.array(ids as string[])}::uuid[])
  `;
}

export async function createRole(entrada: {
  name: string;
  color: string | null;
  permissions: bigint;
  position: number;
}): Promise<RoleRow> {
  const linhas = await sql<RoleRow[]>`
    insert into roles (name, color, permissions, position)
    values (${entrada.name}, ${entrada.color}, ${entrada.permissions.toString()}::bigint,
            ${entrada.position})
    returning ${COLUNAS}
  `;
  const row = linhas[0];
  if (!row) throw new Error('cargo inserido sumiu');
  return row;
}

export async function updateRole(
  id: string,
  campos: {
    name?: string;
    color?: string | null;
    permissions?: bigint;
    position?: number;
  },
): Promise<RoleRow | null> {
  const pedacos = [];
  if (campos.name !== undefined) pedacos.push(sql`name = ${campos.name}`);
  if (campos.color !== undefined) pedacos.push(sql`color = ${campos.color}`);
  if (campos.permissions !== undefined) {
    pedacos.push(sql`permissions = ${campos.permissions.toString()}::bigint`);
  }
  if (campos.position !== undefined) pedacos.push(sql`position = ${campos.position}`);
  if (pedacos.length === 0) return findRoleById(id);

  const atribuicoes = pedacos.reduce((acc, p) => sql`${acc}, ${p}`);
  const linhas = await sql<RoleRow[]>`
    update roles set ${atribuicoes} where id = ${id} returning ${COLUNAS}
  `;
  return linhas[0] ?? null;
}

/** `null` quando o cargo não existe; lança quando é o cargo padrão. */
export async function deleteRole(id: string): Promise<RoleRow | null> {
  const linhas = await sql<RoleRow[]>`
    delete from roles where id = ${id} and not is_default returning ${COLUNAS}
  `;
  return linhas[0] ?? null;
}

/**
 * Quem tem este cargo.
 *
 * Serve a duas coisas: o aviso de "3 pessoas têm este cargo" antes de apagar,
 * e a lista de quem precisa saber que a própria permissão acabou de mudar.
 */
export async function quemTem(roleId: string): Promise<string[]> {
  const linhas = await sql<{ user_id: string }[]>`
    select user_id from user_roles where role_id = ${roleId}
  `;
  return linhas.map((l) => l.user_id);
}

/**
 * Reordena a lista inteira de uma vez.
 *
 * De cima para baixo na tela, então o primeiro id recebe a maior `position`.
 * Numa transação porque a hierarquia é lida entre as escritas: com duas
 * requisições no meio do arrasto, um estado intermediário poderia deixar dois
 * cargos empatados por um instante — e é justamente a comparação de posições
 * que autoriza quem mexe em quem.
 */
export async function reordenar(idsDeCimaParaBaixo: readonly string[]): Promise<RoleRow[]> {
  await sql.begin(async (tx) => {
    for (const [i, id] of idsDeCimaParaBaixo.entries()) {
      await tx`update roles set position = ${idsDeCimaParaBaixo.length - i} where id = ${id}`;
    }
  });
  return listRoles();
}
