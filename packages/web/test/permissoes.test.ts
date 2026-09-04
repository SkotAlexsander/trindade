import { describe, expect, it } from 'vitest';
import { Perm, type PermName } from '@trindade/shared';
import {
  GRUPOS,
  alternarBit,
  nomesListados,
  temBit,
} from '../src/features/roles/permissoes';

/**
 * O catálogo de permissões em linguagem de gente.
 *
 * O risco real aqui é silencioso: alguém acrescenta um bit em `perms.ts` e
 * esquece de descrevê-lo. A permissão passa a existir no servidor e nunca
 * aparece na tela de cargos — ninguém consegue concedê-la, e ninguém percebe
 * que ela sumiu porque nada quebra.
 */

describe('catálogo de permissões', () => {
  const listadas = nomesListados();

  it('descreve toda permissão que existe, menos ADMINISTRATOR', () => {
    const todas = Object.keys(Perm) as PermName[];
    const faltando = todas.filter((n) => n !== 'ADMINISTRATOR' && !listadas.includes(n));
    expect(faltando, `sem descrição: ${faltando.join(', ')}`).toEqual([]);
  });

  it('deixa ADMINISTRATOR fora dos grupos, de propósito', () => {
    // Ele não é mais uma permissão da lista: é a que dispensa a lista inteira,
    // e por isso mora sozinho no fim, com o aviso.
    expect(listadas).not.toContain('ADMINISTRATOR');
  });

  it('não repete nenhuma', () => {
    expect(new Set(listadas).size).toBe(listadas.length);
  });

  it('usa a linguagem de quem administra, não a da constante', () => {
    for (const grupo of GRUPOS) {
      for (const item of grupo.itens) {
        expect(item.rotulo).not.toMatch(/^[A-Z_]+$/);
        expect(item.rotulo.length).toBeGreaterThan(3);
      }
    }
  });

  it('explica as que têm consequência para outras pessoas', () => {
    const comConsequencia: PermName[] = [
      'DELETE_ANY_MESSAGE',
      'PIN_MESSAGE',
      'MANAGE_ROLES',
      'MANAGE_MEMBERS',
    ];
    for (const nome of comConsequencia) {
      const item = GRUPOS.flatMap((g) => g.itens).find((i) => i.nome === nome);
      expect(item?.detalhe, `${nome} sem detalhe`).toBeTruthy();
    }
  });
});

describe('bits', () => {
  it('liga e desliga sem tocar nos vizinhos', () => {
    const inicial = Perm.SEND_MESSAGE | Perm.ATTACH_FILE;
    const comPin = alternarBit(inicial, 'PIN_MESSAGE', true);
    expect(temBit(comPin, 'PIN_MESSAGE')).toBe(true);
    expect(temBit(comPin, 'SEND_MESSAGE')).toBe(true);

    const semAnexo = alternarBit(comPin, 'ATTACH_FILE', false);
    expect(temBit(semAnexo, 'ATTACH_FILE')).toBe(false);
    expect(temBit(semAnexo, 'PIN_MESSAGE')).toBe(true);
    expect(temBit(semAnexo, 'SEND_MESSAGE')).toBe(true);
  });

  it('desligar o que já está desligado não muda nada', () => {
    const inicial = Perm.SEND_MESSAGE;
    expect(alternarBit(inicial, 'MANAGE_ROLES', false)).toBe(inicial);
  });

  it('temBit não confunde ADMINISTRATOR com ter tudo', () => {
    // Diferente de `can`, que é a pergunta do servidor: aqui a tela precisa
    // desenhar o interruptor no estado real do cargo, e um cargo com
    // ADMINISTRATOR e mais nada tem todos os outros **desligados**.
    expect(temBit(Perm.ADMINISTRATOR, 'SEND_MESSAGE')).toBe(false);
    expect(temBit(Perm.ADMINISTRATOR, 'ADMINISTRATOR')).toBe(true);
  });
});
