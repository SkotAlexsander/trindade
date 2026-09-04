import { z } from 'zod';

// Validação usada pelos dois lados. As regras aqui espelham os `check` do
// schema em docs/03-modelo-de-dados.md — se um mudar, o outro muda junto.

export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,24}$/, 'usuário: 3 a 24 caracteres, minúsculas, números ou _');

export const displayNameSchema = z.string().min(1).max(32);

export const passwordSchema = z.string().min(12, 'a senha precisa de ao menos 12 caracteres');

export const bioSchema = z.string().max(280);

export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'cor em hex minúsculo');

export const userStatusSchema = z.enum(['online', 'idle', 'busy', 'invisible', 'offline']);

export const channelSlugSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const channelKindSchema = z.enum(['text', 'voice']);

export const messageContentSchema = z.string().min(1).max(4000);

/**
 * O corpo quando a mensagem pode ser só um anexo.
 *
 * Uma foto sem legenda é uma mensagem completa, e `min(1)` a rejeitaria. Quem
 * usa isto tem de exigir, por fora, que sobre alguma coisa — texto **ou**
 * anexo; ver `clientEventSchema` em eventos.ts.
 */
export const messageBodySchema = z.string().max(4000);

/** Anexos por mensagem. O mesmo número está em docs/04-seguranca.md. */
export const ANEXOS_POR_MENSAGEM = 10;

export const inviteCodeSchema = z.string().min(8).max(32);

/** bigint serializado: só dígitos, sem sinal. */
export const permissionsSchema = z.string().regex(/^\d+$/);

export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(24),
  color: hexColorSchema.nullable(),
  position: z.number().int(),
  permissions: permissionsSchema,
});

export const userSchema = z.object({
  id: z.string().uuid(),
  username: usernameSchema,
  displayName: displayNameSchema,
  avatarUrl: z.string().nullable(),
  avatarBlurhash: z.string().nullable(),
  bio: bioSchema.nullable(),
  accentColor: hexColorSchema.nullable(),
  status: userStatusSchema,
  customStatus: z.string().max(64).nullable(),
  roles: z.array(roleSchema),
  disabled: z.boolean(),
  createdAt: z.string(),
});

export const channelSchema = z.object({
  id: z.string().uuid(),
  slug: channelSlugSchema,
  name: z.string().min(1),
  topic: z.string().max(200).nullable(),
  kind: channelKindSchema,
  position: z.number().int(),
  category: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  field: z.string().optional(),
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
});

export const registerSchema = z.object({
  code: inviteCodeSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
