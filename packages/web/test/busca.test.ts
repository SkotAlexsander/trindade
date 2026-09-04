import { describe, expect, it } from 'vitest';
import { quebrar } from '../src/features/messages/PainelBusca';

/** Só o que ficou aceso, na ordem. */
function acesos(texto: string, termo: string): string[] {
  return quebrar(texto, termo)
    .filter((p) => p.aceso)
    .map((p) => p.texto);
}

/** O texto reconstruído — nada pode se perder no caminho. */
function inteiro(texto: string, termo: string): string {
  return quebrar(texto, termo)
    .map((p) => p.texto)
    .join('');
}

describe('destaque da busca', () => {
  it('acende o termo, sem diferenciar caixa', () => {
    expect(acesos('A Migração passou', 'migração')).toEqual(['Migração']);
  });

  it('acende com acento quando se digita sem', () => {
    // O Postgres acha "migração" quando se digita "migracao" — o destaque tem
    // de concordar com a busca, senão o resultado aparece sem nada aceso.
    expect(acesos('A migração passou', 'migracao')).toEqual(['migração']);
  });

  it('e sem acento quando se digita com', () => {
    expect(acesos('A migracao passou', 'migração')).toEqual(['migracao']);
  });

  it('recorta na posição certa apesar do acento', () => {
    // "migração" tem nove caracteres; sem acento, oito. Sem o mapa de
    // posições o recorte sairia deslocado justamente nas palavras acentuadas.
    const partes = quebrar('a migração é boa', 'migracao');
    expect(partes.map((p) => p.texto)).toEqual(['a ', 'migração', ' é boa']);
    expect(partes.map((p) => p.aceso)).toEqual([false, true, false]);
  });

  it('acende cada palavra do termo', () => {
    expect(acesos('subir para produção amanhã', 'subir producao')).toEqual([
      'subir',
      'produção',
    ]);
  });

  it('ignora palavra de uma letra só', () => {
    expect(acesos('a casa e o cão', 'a e')).toEqual([]);
  });

  it('nunca perde nem duplica texto', () => {
    const texto = 'A migração passou no staging sem erro.';
    for (const termo of ['migracao', 'staging erro', '', 'nada']) {
      expect(inteiro(texto, termo)).toBe(texto);
    }
  });

  it('acende todas as ocorrências', () => {
    expect(acesos('erro, erro e mais erro', 'erro')).toHaveLength(3);
  });
});
