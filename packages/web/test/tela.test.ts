import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  acimaDoSuportado,
  camadasDe,
  emMbps,
  presetPorId,
  redeLimitando,
  suportadoPor,
} from '../src/features/voice/presets';

/**
 * Os presets de transmissão.
 *
 * Números escritos à mão erram em silêncio: um preset com `contentHint`
 * trocado deixa a tela de código borrada sob pressão de banda, e ninguém
 * associa uma coisa à outra. A tabela está em
 * design/12-compartilhamento-de-tela.md.
 */

describe('a tabela de presets', () => {
  it('tem os seis, na ordem do documento', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'texto',
      'padrao',
      'fluido',
      'nitido',
      'nitidoFluido',
      'fonte',
    ]);
  });

  it('e cresce em bitrate do primeiro ao último', () => {
    const bitrates = PRESETS.map((p) => p.bitrate);
    expect([...bitrates].sort((a, b) => a - b)).toEqual(bitrates);
  });

  it('texto e código mantém resolução, fluido mantém quadros', () => {
    // É a diferença entre uma tela de código que fica borrada e ilegível e uma
    // que apenas atualiza mais devagar.
    expect(presetPorId('texto').dica).toBe('detail');
    expect(presetPorId('nitido').dica).toBe('detail');
    expect(presetPorId('fluido').dica).toBe('motion');
    expect(presetPorId('nitidoFluido').dica).toBe('motion');
  });

  it('id desconhecido cai no padrão em vez de quebrar', () => {
    // O id vem do `localStorage`, que é editável por quem senta na máquina.
    expect(presetPorId('turbo').id).toBe('padrao');
  });
});

describe('as camadas do simulcast', () => {
  it('acompanham o preset, com 360p sempre embaixo', () => {
    const [baixa, meia] = camadasDe(presetPorId('nitidoFluido'));
    expect(baixa).toMatchObject({ largura: 640, altura: 360 });
    expect(meia?.largura).toBe(1280);
    expect(meia?.altura).toBe(720);
  });

  it('e a do meio não carrega os 60 quadros do preset alto', () => {
    // Ela existe para quem já está com a banda apertada.
    expect(camadasDe(presetPorId('nitidoFluido'))[1]?.fps).toBe(30);
    expect(camadasDe(presetPorId('texto'))[1]?.fps).toBe(15);
  });
});

describe('"sua conexão suporta até"', () => {
  it('escolhe o maior preset que cabe, com folga', () => {
    // 20% de folga: uma transmissão que usa cada bit disponível engasga.
    expect(suportadoPor(7_000_000)?.id).toBe('padrao');
    expect(suportadoPor(30_000_000)?.id).toBe('fonte');
  });

  it('sem medida, não inventa', () => {
    expect(suportadoPor(null)).toBeNull();
    expect(suportadoPor(0)).toBeNull();
  });

  it('marca os presets acima, sem proibir nenhum', () => {
    const suportado = suportadoPor(7_000_000);
    expect(acimaDoSuportado(presetPorId('nitido'), suportado)).toBe(true);
    expect(acimaDoSuportado(presetPorId('texto'), suportado)).toBe(false);
    // Sem medida nenhuma, nada é marcado — avisar por chute é pior que calar.
    expect(acimaDoSuportado(presetPorId('fonte'), null)).toBe(false);
  });
});

describe('a linha âmbar de rede limitando', () => {
  it('acende quando o codificador diz que é banda', () => {
    expect(redeLimitando('bandwidth')).toBe(true);
  });

  it('e não confunde bitrate baixo com rede apertada', () => {
    // Uma tela de documento parado codifica muito abaixo do alvo porque não há
    // o que enviar. A primeira versão comparava com o alvo do preset e acusava
    // "rede limitando" justamente quando estava tudo certo.
    expect(redeLimitando('none')).toBe(false);
    expect(redeLimitando('cpu')).toBe(false);
    expect(redeLimitando('other')).toBe(false);
  });
});

describe('o número que a pessoa lê', () => {
  it('vem em Mbps com vírgula', () => {
    expect(emMbps(4_800_000)).toBe('4,8 Mbps');
  });
});
