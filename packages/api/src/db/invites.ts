import { sql } from './index.js';

export interface InviteRow {
  code: string;
  created_by: string;
  used_by: string | null;
  used_at: Date | null;
  expires_at: Date;
  note: string | null;
  created_at: Date;
}

export async function findInvite(code: string): Promise<InviteRow | null> {
  const rows = await sql<InviteRow[]>`select * from invites where code = ${code}`;
  return rows[0] ?? null;
}

export interface InvitePreview {
  invitedBy: string;
  expired: boolean;
  used: boolean;
}

export async function previewInvite(code: string): Promise<InvitePreview | null> {
  const rows = await sql<{ invited_by: string; expired: boolean; used: boolean }[]>`
    select u.display_name as invited_by,
           i.expires_at <= now() as expired,
           i.used_by is not null as used
    from invites i join users u on u.id = i.created_by
    where i.code = ${code}
  `;
  const row = rows[0];
  if (!row) return null;
  return { invitedBy: row.invited_by, expired: row.expired, used: row.used };
}

export async function createInvite(input: {
  code: string;
  createdBy: string;
  expiresAt: Date;
  note: string | null;
}): Promise<InviteRow> {
  const rows = await sql<InviteRow[]>`
    insert into invites (code, created_by, expires_at, note)
    values (${input.code}, ${input.createdBy}, ${input.expiresAt}, ${input.note})
    returning *
  `;
  const row = rows[0];
  if (!row) throw new Error('insert de convite não devolveu linha');
  return row;
}

export interface InviteComAutor extends InviteRow {
  created_by_name: string;
  used_by_name: string | null;
}

/**
 * Os convites que ainda valem alguma coisa, e os usados recentemente.
 *
 * Convite expirado e não usado some da lista: ele não é histórico de nada — o
 * que interessa saber é quem já entrou e quantos links ainda estão soltos.
 */
export async function listInvites(): Promise<InviteComAutor[]> {
  return sql<InviteComAutor[]>`
    select i.*, autor.display_name as created_by_name,
           usou.display_name as used_by_name
      from invites i
      join users autor on autor.id = i.created_by
      left join users usou on usou.id = i.used_by
     where i.used_by is not null or i.expires_at > now()
     order by i.created_at desc
  `;
}

/** Revoga um convite ainda não usado. Usado não se revoga: já virou conta. */
export async function revokeInvite(code: string): Promise<boolean> {
  const linhas = await sql<{ code: string }[]>`
    delete from invites where code = ${code} and used_by is null returning code
  `;
  return linhas.length > 0;
}
