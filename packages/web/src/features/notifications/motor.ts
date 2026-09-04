import { create } from 'zustand';
import { useAuth } from '../auth/store';
import { useLeitura } from '../messages/leitura';
import { usePresenca } from '../realtime/store';
import { useVoz } from '../voice/store';
import { mostrar, pedirPermissao, resumir } from './desktop';
import { lerAvisos } from './preferencias';
import { decidir, type Acontecimento, type Decisao, type Motivo } from './regras';
import { tocarAviso } from './sons';

/**
 * Onde a regra vira efeito.
 *
 * A decisão está em `regras.ts`, pura e testada; aqui ficam as três coisas que
 * só existem num navegador — tocar, mostrar e contar — e a memória curta de que
 * o cooldown e o agrupamento precisam.
 *
 * Ver design/09-notificacoes.md.
 */

interface Historico {
  /** Quando este canal notificou pela última vez. */
  quando: number;
  /** Quem causou, para agrupar mensagens seguidas da mesma pessoa. */
  autorId: string | null;
}

interface MotorState {
  /** A janela do produto está em foco? */
  emFoco: boolean;
  /** O canal aberto na tela, ou `null` fora de um canal. */
  canalAberto: string | null;
  porCanal: Record<string, Historico>;
  definirFoco: (emFoco: boolean) => void;
  definirCanalAberto: (channelId: string | null) => void;
  registrar: (channelId: string, historico: Historico) => void;
}

export const useMotor = create<MotorState>((set) => ({
  emFoco: typeof document === 'undefined' || document.visibilityState === 'visible',
  canalAberto: null,
  porCanal: {},
  definirFoco: (emFoco) => set({ emFoco }),
  definirCanalAberto: (canalAberto) => set({ canalAberto }),
  registrar: (channelId, historico) =>
    set((s) => ({ porCanal: { ...s.porCanal, [channelId]: historico } })),
}));

export interface Chegada {
  motivo: Motivo;
  channelId: string;
  autorId: string | null;
  /** "Bruno Lima em #geral" — o título da notificação. */
  titulo: string;
  /** O texto, que será truncado em 120 caracteres. */
  corpo: string;
  /** Para onde o clique leva. */
  ir: () => void;
}

/**
 * Um acontecimento chegou: decide e executa.
 *
 * Toda a leitura de estado é feita aqui dentro, com `getState()`, e não por
 * hooks: isto é chamado de dentro do gateway, que não é um componente, e
 * transformar em hook obrigaria a re-renderizar a árvore a cada mensagem só
 * para ter os valores à mão.
 */
export function avisar(chegada: Chegada): Decisao {
  const eu = useAuth.getState().user;
  if (!eu) return NADA;

  const motor = useMotor.getState();
  const leitura = useLeitura.getState().porCanal[chegada.channelId];
  const historico = motor.porCanal[chegada.channelId];
  const agora = Date.now();

  const evento: Acontecimento = {
    motivo: chegada.motivo,
    channelId: chegada.channelId,
    autorId: chegada.autorId,
    quando: agora,
  };

  const decisao = decidir(evento, {
    meuId: eu.id,
    prefs: lerAvisos(),
    emFoco: motor.emFoco,
    canalAberto: motor.canalAberto === chegada.channelId,
    ocupado: usePresenca.getState().porUsuario[eu.id]?.status === 'busy',
    compartilhandoTela: useVoz.getState().transmitindo,
    silenciadoAte: leitura?.mutedUntil ? Date.parse(leitura.mutedUntil) : null,
    ultimoAvisoDoCanal: historico?.quando ?? null,
    ultimoAutorDoCanal: historico?.autorId ?? null,
    agora,
  });

  if (decisao.som) tocarAviso(decisao.som);

  if (decisao.desktop && lerAvisos().desktop) {
    /* A permissão é pedida **aqui**, na primeira vez que há motivo — e a
       resposta chega depois, então a notificação desta vez pode não sair. É o
       preço de não pedir no primeiro acesso, e é um preço barato: quem
       concedeu vê a próxima, e quem negou não veria nenhuma de qualquer jeito. */
    void pedirPermissao().then((permissao) => {
      if (permissao !== 'concedida') return;
      mostrar({
        titulo: chegada.titulo,
        corpo: resumir(chegada.corpo),
        // A `tag` por canal é o que agrupa: a segunda notificação substitui a
        // primeira em vez de empilhar.
        tag: decisao.agrupa ? `canal:${chegada.channelId}` : `canal:${chegada.channelId}:${agora}`,
        ir: chegada.ir,
      });
    });
  }

  if (decisao.som || decisao.desktop || decisao.badge) {
    useMotor.getState().registrar(chegada.channelId, { quando: agora, autorId: chegada.autorId });
  }

  // Devolve a decisão porque quem chamou também precisa dela: o contador do
  // título conta exatamente o que `badge` diz, e não uma segunda regra
  // parecida escrita no gateway.
  return decisao;
}

const NADA: Decisao = { som: null, desktop: false, badge: false, agrupa: false };

/**
 * O contador do título: `(3) Trindade`.
 *
 * Sai da soma de `mentionCount` do estado de leitura, e não de um contador
 * próprio. O servidor conta no READY e o cliente soma a cada evento; ter um
 * segundo número aqui criaria o dia em que o título diz 3 e a lista diz 1.
 *
 * Zera ao **abrir o canal com a janela à vista**, que é quando `marcarLido`
 * roda — e não ao focar a janela, que não é ler.
 */
export function contarChamados(porCanal: Record<string, { mentionCount: number }>): number {
  return Object.values(porCanal).reduce((total, c) => total + c.mentionCount, 0);
}
