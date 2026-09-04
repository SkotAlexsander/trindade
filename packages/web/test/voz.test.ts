import { beforeEach, describe, expect, it } from 'vitest';
import type { VoiceState } from '@trindade/shared';
import { naChamada, useVoz } from '../src/features/voice/store';

/**
 * O estado de quem está em qual chamada.
 *
 * A regra que importa está no `connected: false`: sair não é um evento
 * próprio, é um `VOICE_STATE_UPDATE` com a conexão desligada. Guardar esse
 * estado em vez de apagar a linha deixaria avatares de gente que já saiu na
 * grade — e o defeito só apareceria com alguém entrando e saindo bastante.
 */

function estado(over: Partial<VoiceState> & { userId: string }): VoiceState {
  return {
    channelId: 'canal-1',
    muted: false,
    deafened: false,
    screenSharing: false,
    connected: true,
    ...over,
  };
}

beforeEach(() => {
  useVoz.getState().substituirEstados([]);
  useVoz.getState().esquecerChamada();
});

describe('estados de voz', () => {
  it('o READY substitui a lista inteira', () => {
    useVoz.getState().substituirEstados([estado({ userId: 'ana' }), estado({ userId: 'bia' })]);
    expect(Object.keys(useVoz.getState().estados).sort()).toEqual(['ana', 'bia']);

    // Reconectar traz a verdade de novo: o que sumiu da lista sumiu mesmo.
    useVoz.getState().substituirEstados([estado({ userId: 'ana' })]);
    expect(Object.keys(useVoz.getState().estados)).toEqual(['ana']);
  });

  it('sair apaga a linha em vez de guardar um estado desligado', () => {
    useVoz.getState().substituirEstados([estado({ userId: 'ana' })]);
    useVoz.getState().aplicarEstado(estado({ userId: 'ana', connected: false }));
    expect(useVoz.getState().estados).toEqual({});
  });

  it('e a saída de quem nunca entrou não muda nada', () => {
    const antes = useVoz.getState().estados;
    useVoz.getState().aplicarEstado(estado({ userId: 'fantasma', connected: false }));
    expect(useVoz.getState().estados).toBe(antes);
  });

  it('mudo e surdez chegam pelo mesmo evento', () => {
    useVoz.getState().aplicarEstado(estado({ userId: 'ana', muted: true, deafened: true }));
    expect(useVoz.getState().estados.ana).toMatchObject({ muted: true, deafened: true });
  });

  it('naChamada separa por canal', () => {
    useVoz
      .getState()
      .substituirEstados([
        estado({ userId: 'ana' }),
        estado({ userId: 'bia', channelId: 'canal-2' }),
      ]);
    expect(naChamada(useVoz.getState().estados, 'canal-1').map((e) => e.userId)).toEqual(['ana']);
    expect(naChamada(useVoz.getState().estados, 'canal-3')).toEqual([]);
  });
});
