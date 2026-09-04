import { describe, expect, it } from 'vitest';
import { TYPING_TTL_MS } from '@trindade/shared';
import { digitandoAgora } from '../src/features/realtime/store';
import { cargoDoTopo, corDoCargo } from '../src/features/messages/Message';

describe('digitandoAgora', () => {
  const agora = 1_000_000;

  it('devolve quem marcou dentro do TTL', () => {
    const porCanal = { c1: { ana: agora - 1_000, bruno: agora - 7_000 } };
    expect(digitandoAgora(porCanal, 'c1', agora).sort()).toEqual(['ana', 'bruno']);
  });

  it('esquece sozinho depois do TTL', () => {
    // Não existe TYPING_STOP no protocolo: quem recebe expira por conta
    // própria. Sem isso, fechar a aba no meio de uma frase deixaria o
    // indicador aceso para sempre.
    const porCanal = { c1: { ana: agora - TYPING_TTL_MS - 1 } };
    expect(digitandoAgora(porCanal, 'c1', agora)).toEqual([]);
  });

  it('não mistura canais', () => {
    const porCanal = { c1: { ana: agora }, c2: { bruno: agora } };
    expect(digitandoAgora(porCanal, 'c2', agora)).toEqual(['bruno']);
    expect(digitandoAgora(porCanal, 'c3', agora)).toEqual([]);
  });
});

describe('cargo do autor', () => {
  const membro = { id: '1', name: 'Membro', color: null, position: 1, permissions: '0' };
  const produto = { id: '2', name: 'Produto', color: '#22d3ee', position: 5, permissions: '0' };
  const admin = { id: '3', name: 'Admin', color: '#e879f9', position: 9, permissions: '0' };

  it('mostra o cargo de maior posição, tenha cor ou não', () => {
    expect(cargoDoTopo([membro, produto, admin])?.name).toBe('Admin');
    const alto = { ...membro, name: 'Fundador', position: 20 };
    expect(cargoDoTopo([alto, produto])?.name).toBe('Fundador');
  });

  it('colore pelo mais alto que tenha cor, que pode ser outro', () => {
    // O cargo exibido é "Fundador", sem cor; a cor vem de "Produto", abaixo
    // dele. São duas escolhas diferentes de propósito.
    const alto = { ...membro, name: 'Fundador', position: 20 };
    expect(cargoDoTopo([alto, produto])?.name).toBe('Fundador');
    expect(corDoCargo([alto, produto])).toBe('#22d3ee');
  });

  it('sem cargo colorido, ninguém colore', () => {
    expect(corDoCargo([membro])).toBeUndefined();
    expect(corDoCargo([])).toBeUndefined();
    expect(corDoCargo(undefined)).toBeUndefined();
    expect(cargoDoTopo(undefined)).toBeUndefined();
  });
});
