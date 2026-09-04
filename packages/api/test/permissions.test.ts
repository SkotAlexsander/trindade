import { describe, it, expect } from 'vitest';
import { Perm } from '@trindade/shared';
import {
  can,
  effectivePermissions,
  highestPosition,
  assertCanManageRole,
  assertCanManageUser,
} from '../src/lib/auth/permissions.js';
import { AppError } from '../src/lib/errors.js';

const membro = { id: 'r1', position: 0, permissions: '1823' };
const moderador = { id: 'r2', position: 50, permissions: Perm.MANAGE_ROLES.toString() };
const admin = { id: 'r3', position: 100, permissions: Perm.ADMINISTRATOR.toString() };

describe('permissões efetivas', () => {
  it('é o OR de todos os cargos', () => {
    const perms = effectivePermissions([membro, moderador]);
    expect(can(perms, Perm.SEND_MESSAGE)).toBe(true);
    expect(can(perms, Perm.MANAGE_ROLES)).toBe(true);
    expect(can(perms, Perm.MANAGE_MEMBERS)).toBe(false);
  });

  it('ADMINISTRATOR ignora todas as outras checagens', () => {
    const perms = effectivePermissions([admin]);
    expect(can(perms, Perm.MANAGE_MEMBERS)).toBe(true);
    expect(can(perms, Perm.MANAGE_CHANNEL)).toBe(true);
  });

  it('sem cargo nenhum não pode nada', () => {
    expect(can(effectivePermissions([]), Perm.SEND_MESSAGE)).toBe(false);
    expect(highestPosition([])).toBe(0);
  });

  it('o cargo Membro do seed tem exatamente os bits 0–4 e 8–10', () => {
    const perms = effectivePermissions([membro]);
    const esperados = [
      Perm.SEND_MESSAGE,
      Perm.DELETE_OWN_MESSAGE,
      Perm.DELETE_ANY_MESSAGE,
      Perm.PIN_MESSAGE,
      Perm.ATTACH_FILE,
      Perm.CREATE_INVITE,
      Perm.CONNECT_VOICE,
      Perm.SHARE_SCREEN,
    ];
    for (const bit of esperados) expect(can(perms, bit)).toBe(true);

    for (const bit of [Perm.MANAGE_CHANNEL, Perm.MANAGE_ROLES, Perm.MANAGE_MEMBERS]) {
      expect(can(perms, bit)).toBe(false);
    }
  });
});

describe('hierarquia', () => {
  it('não deixa mexer em cargo acima nem igual ao próprio', () => {
    // Sem esta regra, MANAGE_ROLES é equivalente a ADMINISTRATOR: o moderador
    // se daria o cargo de administrador em dois cliques.
    expect(() => assertCanManageRole([moderador], admin.position)).toThrow(AppError);
    expect(() => assertCanManageRole([moderador], moderador.position)).toThrow(AppError);
    expect(() => assertCanManageRole([moderador], membro.position)).not.toThrow();
  });

  it('devolve HIERARCHY_VIOLATION', () => {
    try {
      assertCanManageRole([moderador], admin.position);
      expect.unreachable('devia ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('HIERARCHY_VIOLATION');
      expect((err as AppError).statusCode).toBe(403);
    }
  });

  it('nem o administrador escapa da regra de cargo', () => {
    // Se ADMINISTRATOR isentasse, a regra não teria efeito justamente sobre
    // quem causa mais estrago se a conta for tomada.
    expect(() => assertCanManageRole([admin], admin.position)).toThrow(AppError);
    expect(() => assertCanManageRole([admin], moderador.position)).not.toThrow();
  });

  it('não deixa desativar alguém igual ou acima', () => {
    expect(() => assertCanManageUser([moderador], [admin])).toThrow(AppError);
    expect(() => assertCanManageUser([moderador], [moderador])).toThrow(AppError);
    expect(() => assertCanManageUser([admin], [moderador])).not.toThrow();
  });

  it('a posição que vale é a do maior cargo, não a soma', () => {
    expect(highestPosition([membro, moderador])).toBe(50);
    expect(() => assertCanManageUser([membro, moderador], [membro])).not.toThrow();
    expect(() => assertCanManageUser([membro], [moderador])).toThrow(AppError);
  });
});
