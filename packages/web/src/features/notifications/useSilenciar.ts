import { useToast } from '../../components';
import { api } from '../../lib/http';
import { useLeitura } from '../messages/leitura';
import { caminhoDo, type Alvo } from '../messages/alvo';

/**
 * Silenciar e reativar um alvo — canal ou conversa.
 *
 * Estava dentro do `MenuDeSilenciar`, e o menu do canal precisava do mesmo
 * gesto. Duas cópias de "até eu ligar são dez anos" é como as duas divergem
 * seis meses depois, sem ninguém perceber que divergiram.
 *
 * Ver design/09-notificacoes.md.
 */

export const OPCOES_DE_SILENCIO: { rotulo: string; horas: number | null }[] = [
  { rotulo: 'Por 1 hora', horas: 1 },
  { rotulo: 'Por 8 horas', horas: 8 },
  { rotulo: 'Até eu ligar', horas: null },
];

/** Dez anos. Ver a explicação em `silenciar`. */
const PARA_SEMPRE_MS = 10 * 365 * 86_400_000;

export function ateQuandoSilenciar(horas: number | null): string {
  /* "Até eu ligar" é um prazo de dez anos e não um `null`: `null` já quer
     dizer "não silenciado" no estado de leitura, e usar o mesmo valor para as
     duas coisas apagaria a diferença entre calado para sempre e nunca calado. */
  const ms = horas === null ? PARA_SEMPRE_MS : horas * 3_600_000;
  return new Date(Date.now() + ms).toISOString();
}

export interface Silenciador {
  /** `true` enquanto o prazo não venceu. Silêncio vencido é silêncio nenhum. */
  estaMudo: boolean;
  silenciar: (horas: number | null) => void;
  reativar: () => void;
}

export function useSilenciar(alvo: Alvo): Silenciador {
  const { show } = useToast();
  const leitura = useLeitura((s) => s.porCanal[alvo.id]);
  const oQue = alvo.tipo === 'canal' ? 'canal' : 'conversa';

  const ate = leitura?.mutedUntil ? Date.parse(leitura.mutedUntil) : null;
  const estaMudo = ate !== null && ate > Date.now();

  return {
    estaMudo,
    // O estado volta pelo `READ_STATE_UPDATE`, como em qualquer outra aba sua:
    // não há o que atualizar aqui à mão.
    silenciar: (horas) => {
      void api(`${caminhoDo(alvo)}/mute`, {
        method: 'PUT',
        body: { until: ateQuandoSilenciar(horas) },
      }).catch(() => show(`Não foi possível silenciar o ${oQue}.`, 'danger'));
    },
    reativar: () => {
      void api(`${caminhoDo(alvo)}/mute`, { method: 'DELETE' }).catch(() =>
        show(`Não foi possível reativar o ${oQue}.`, 'danger'),
      );
    },
  };
}
