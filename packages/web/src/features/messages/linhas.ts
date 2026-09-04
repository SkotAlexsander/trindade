import { mesmaSequencia } from '@trindade/shared';
import type { MensagemLocal } from './queries';

/**
 * Transforma a lista plana no que a tela desenha: uma seção por dia, e dentro
 * dela as mensagens marcadas como cabeça ou continuação de bloco.
 *
 * A seção não é organização à toa — é o que faz o divisor de dia grudado
 * funcionar. Com todos os divisores no mesmo pai, `position: sticky` prende
 * cada um ao container inteiro e eles se empilham sobrepostos no topo. Dentro
 * de uma seção por dia, cada divisor só gruda enquanto o dia dele está na
 * tela, e o seguinte o empurra para fora. Ver design/04-mensagens.md.
 */

export interface LinhaMensagem {
  chave: string;
  mensagem: MensagemLocal;
  cabeca: boolean;
}

export interface SecaoDeDia {
  chave: string;
  /** ISO de uma mensagem do dia — o rótulo sai daqui. */
  data: string;
  linhas: LinhaMensagem[];
}

/** Chave local do dia — `toDateString` já usa o fuso de quem lê. */
function diaDe(iso: string): string {
  return new Date(iso).toDateString();
}

export function montarSecoes(mensagens: readonly MensagemLocal[]): SecaoDeDia[] {
  const secoes: SecaoDeDia[] = [];

  for (let i = 0; i < mensagens.length; i += 1) {
    const mensagem = mensagens[i];
    if (!mensagem) continue;

    const dia = diaDe(mensagem.createdAt);
    let secao = secoes[secoes.length - 1];
    const virouODia = !secao || secao.chave !== dia;

    if (virouODia) {
      secao = { chave: dia, data: mensagem.createdAt, linhas: [] };
      secoes.push(secao);
    }

    // Trocar de dia sempre abre bloco novo, mesmo que `mesmaSequencia` já
    // cubra o caso: a primeira do dia logo abaixo do divisor não pode
    // aparecer sem avatar nem nome.
    const anterior = mensagens[i - 1];
    const cabeca = virouODia || !mesmaSequencia(anterior, mensagem);

    secao?.linhas.push({ chave: mensagem.id, mensagem, cabeca });
  }

  return secoes;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** "hoje", "ontem", ou a data por extenso. */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const data = new Date(iso);
  const meiaNoiteHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const meiaNoiteData = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const dias = Math.round((meiaNoiteHoje.getTime() - meiaNoiteData.getTime()) / DIA_MS);

  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';

  return data.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(data.getFullYear() === agora.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
