import { describe, expect, it } from 'vitest';
import type { Conversation, User } from '@trindade/shared';
import { nomeDaConversa, visiveis } from '../src/features/conversations/queries';

/**
 * A lista de conversas.
 *
 * Duas regras que a barra lateral inteira depende: uma direta sem mensagem
 * **não ocupa espaço**, e o nome de uma conversa é o de quem está do outro
 * lado. Ver design/10-conversas-privadas.md.
 */

const EU = 'eu';

function pessoa(id: string, displayName: string): User {
  return {
    id,
    username: displayName.toLowerCase().split(' ')[0] ?? id,
    displayName,
    avatarUrl: null,
    bio: null,
    status: 'online',
    customStatus: null,
    roles: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    disabledAt: null,
  } as unknown as User;
}

function conversa(parcial: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    kind: 'direct',
    name: null,
    members: [EU, 'bruno'],
    createdBy: EU,
    createdAt: '2026-09-01T10:00:00.000Z',
    lastMessageAt: '2026-09-04T10:00:00.000Z',
    lastMessage: 'oi',
    lastAuthorId: 'bruno',
    unreadCount: 0,
    mentionCount: 0,
    mutedUntil: null,
    hidden: false,
    ...parcial,
  };
}

const ELENCO = [pessoa(EU, 'Ana Silva'), pessoa('bruno', 'Bruno Lima'), pessoa('carla', 'Carla Nunes')];

describe('visiveis', () => {
  /* Abrir uma direta e fechar sem dizer nada não pode encher a barra lateral
     de conversas que nunca aconteceram. */
  it('esconde a conversa que nunca teve mensagem', () => {
    expect(visiveis([conversa({ lastMessageAt: null })])).toHaveLength(0);
  });

  it('mostra a que tem', () => {
    expect(visiveis([conversa()])).toHaveLength(1);
  });

  it('esconde a que a pessoa escondeu', () => {
    expect(visiveis([conversa({ hidden: true })])).toHaveLength(0);
  });
});

describe('nomeDaConversa', () => {
  it('direta é o nome de quem está do outro lado', () => {
    expect(nomeDaConversa(conversa(), ELENCO, EU)).toBe('Bruno Lima');
  });

  it('grupo sem nome são os primeiros nomes de quem está lá', () => {
    const grupo = conversa({ kind: 'group', members: [EU, 'bruno', 'carla'] });
    expect(nomeDaConversa(grupo, ELENCO, EU)).toBe('Bruno, Carla');
  });

  it('e o nome dado ganha de tudo', () => {
    const grupo = conversa({ kind: 'group', name: 'Deploy', members: [EU, 'bruno', 'carla'] });
    expect(nomeDaConversa(grupo, ELENCO, EU)).toBe('Deploy');
  });

  /* Quem saiu some de `members`, e um grupo esvaziado não pode virar uma
     linha sem rótulo na barra lateral. */
  it('sobra "Conversa" quando não há mais ninguém do outro lado', () => {
    expect(nomeDaConversa(conversa({ members: [EU] }), ELENCO, EU)).toBe('Conversa');
  });
});
