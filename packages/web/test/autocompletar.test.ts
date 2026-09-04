import { describe, expect, it } from 'vitest';
import type { Channel, User } from '@trindade/shared';
import { gatilhoAtivo, sugerir } from '../src/features/messages/autocompletar';

function pessoa(username: string, displayName: string): User {
  return {
    id: username,
    username,
    displayName,
    avatarUrl: null,
    bio: null,
    accentColor: null,
    status: 'online',
    customStatus: null,
    roles: [],
    disabled: false,
  };
}

function canal(slug: string, kind: Channel['kind'] = 'text'): Channel {
  return {
    id: slug,
    slug,
    name: slug,
    topic: null,
    kind,
    position: 0,
    category: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };
}

const PESSOAS = [pessoa('alex', 'Alex Souza'), pessoa('bruno', 'Bruno Lima'), pessoa('carla', 'Carla Nunes')];
const CANAIS = [canal('geral'), canal('produto'), canal('sala', 'voice')];

describe('gatilhoAtivo', () => {
  it('abre no `@` e acumula o termo', () => {
    expect(gatilhoAtivo('oi @al', 6)).toEqual({ tipo: '@', termo: 'al', inicio: 3 });
  });

  it('abre com o gatilho sozinho', () => {
    expect(gatilhoAtivo('oi @', 4)).toEqual({ tipo: '@', termo: '', inicio: 3 });
  });

  it('abre no começo da linha', () => {
    expect(gatilhoAtivo('#pro', 4)?.tipo).toBe('#');
  });

  it('não abre no meio de uma palavra', () => {
    // O caso que aparece toda vez que alguém escreve um e-mail.
    expect(gatilhoAtivo('alguem@exemplo', 14)).toBeNull();
  });

  it('fecha ao aparecer um espaço', () => {
    expect(gatilhoAtivo('oi @alex tudo', 13)).toBeNull();
  });

  it('desiste depois de um termo longo demais', () => {
    const longo = '@' + 'a'.repeat(40);
    expect(gatilhoAtivo(longo, longo.length)).toBeNull();
  });

  it('usa o gatilho mais próximo do cursor', () => {
    expect(gatilhoAtivo('@alex #pro', 10)).toEqual({ tipo: '#', termo: 'pro', inicio: 6 });
  });

  it('sem gatilho, nada', () => {
    expect(gatilhoAtivo('texto comum', 11)).toBeNull();
  });
});

describe('sugerir', () => {
  it('`@` sozinho já lista todo o elenco', () => {
    // Exigir uma letra antes de mostrar cinco nomes é cerimônia.
    const s = sugerir({ tipo: '@', termo: '', inicio: 0 }, PESSOAS, CANAIS);
    expect(s).toHaveLength(3);
  });

  it('filtra por usuário e por nome de exibição', () => {
    expect(sugerir({ tipo: '@', termo: 'br', inicio: 0 }, PESSOAS, CANAIS)).toHaveLength(1);
    expect(sugerir({ tipo: '@', termo: 'Carla', inicio: 0 }, PESSOAS, CANAIS)).toHaveLength(1);
  });

  it('a troca leva o nome de usuário, não o de exibição', () => {
    const [primeira] = sugerir({ tipo: '@', termo: 'al', inicio: 0 }, PESSOAS, CANAIS);
    expect(primeira?.troca).toBe('@alex ');
  });

  it('canal de voz não entra: não dá para mencionar', () => {
    const s = sugerir({ tipo: '#', termo: '', inicio: 0 }, PESSOAS, CANAIS);
    expect(s.map((x) => x.rotulo)).toEqual(['#geral', '#produto']);
  });

  it('emoji exige duas letras', () => {
    expect(sugerir({ tipo: ':', termo: 'f', inicio: 0 }, PESSOAS, CANAIS)).toEqual([]);
    const s = sugerir({ tipo: ':', termo: 'fog', inicio: 0 }, PESSOAS, CANAIS);
    expect(s[0]?.troca).toBe('🔥 ');
  });
});
