import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Perm, can, type Channel, type User } from '@trindade/shared';
import { Skeleton, Spinner } from '../../components';
import { ArrowDown } from '../../components/icones';
import { useAuth } from '../auth/store';
import { Message, type AcoesDisponiveis } from './Message';
import { montarSecoes, rotuloDoDia } from './linhas';
import { useCarregarAntigas, useMessages, type MensagemLocal } from './queries';
import { DURACAO_DO_PISCA_MS, useComposer, useDestaque, useFoco, useThread } from './store';
import { useAcoesDaMensagem } from './useAcoes';
import { useMarcarLido } from './leitura';
import { useEnviarMensagem } from './useEnviar';
import styles from './messages.module.css';

/**
 * O histórico, o comportamento de rolagem e o foco itinerante.
 *
 * As regras de rolagem estão em design/04-mensagens.md:
 *
 * - gruda no fim **só** se já estava a menos de 100px do fim
 * - se a pessoa rolou para cima, mensagem nova não move nada; aparece um botão
 * - carregar histórico compensa a altura, senão a tela salta a cada página
 * - carrega mais faltando 600px para o topo, não 0
 */

/** Distância do fim abaixo da qual a lista continua colada. */
const PERTO_DO_FIM = 100;
/** Distância do topo em que o histórico antigo começa a ser buscado. */
const GATILHO_DO_TOPO = 600;
/** Acima disto, as linhas fora da tela deixam de ser desenhadas. */
const LIMITE_SEM_JANELA = 200;

export interface MessageListProps {
  channelId: string;
  pessoas: readonly User[];
  canais: readonly Channel[];
}

export function MessageList({ channelId, pessoas, canais }: MessageListProps) {
  const eu = useAuth((s) => s.user);
  const permissoes = useAuth((s) => s.permissions);
  const { data, isPending } = useMessages(channelId);
  const { carregar, carregando } = useCarregarAntigas(channelId);
  const { tentarDeNovo, descartar } = useEnviarMensagem();
  const { reagir, guardar, fixar, apagar } = useAcoesDaMensagem();

  const responder = useComposer((s) => s.responder);
  const editar = useComposer((s) => s.editar);
  const focoId = useFoco((s) => s.id);
  const focar = useFoco((s) => s.focar);
  const destaqueId = useDestaque((s) => s.id);
  const limparDestaque = useDestaque((s) => s.limpar);
  const pular = useDestaque((s) => s.pular);
  const abrirThread = useThread((s) => s.abrir);

  const rolagem = useRef<HTMLDivElement>(null);
  const coladoNoFim = useRef(true);
  /** `scrollHeight` antes de prepender, para compensar depois. */
  const alturaAntes = useRef<number | null>(null);
  const ultimoId = useRef<string | null>(null);
  const canalAnterior = useRef<string | null>(null);

  const [novas, setNovas] = useState(0);

  const mensagens = useMemo(() => data?.mensagens ?? [], [data]);
  const secoes = useMemo(() => montarSecoes(mensagens), [mensagens]);
  const porId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const mensagensPorId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens]);

  // Canal aberto e janela à vista: o que chegou está lido.
  useMarcarLido(channelId, mensagens[mensagens.length - 1]?.id ?? null);

  const irAoFim = useCallback((comportamento: ScrollBehavior = 'auto') => {
    const el = rolagem.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: comportamento });
    coladoNoFim.current = true;
    setNovas(0);
  }, []);

  // --- posição ------------------------------------------------------------
  //
  // Um `useLayoutEffect` só, e com ordem de prioridade explícita: compensar a
  // prepend e grudar no fim disputam o mesmo `scrollTop`, e em dois efeitos
  // separados vence o que o React resolver rodar por último.
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (!el) return;

    // 1. Trocou de canal: começa no fim, sem animação.
    if (canalAnterior.current !== channelId) {
      canalAnterior.current = channelId;
      ultimoId.current = mensagens[mensagens.length - 1]?.id ?? null;
      coladoNoFim.current = true;
      setNovas(0);
      el.scrollTop = el.scrollHeight;
      return;
    }

    // 2. Carregou histórico antigo: devolve exatamente o que cresceu acima.
    if (alturaAntes.current !== null) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = null;
      return;
    }

    const ultima = mensagens[mensagens.length - 1];
    const chegouCoisaNova = Boolean(ultima) && ultima?.id !== ultimoId.current;
    ultimoId.current = ultima?.id ?? null;
    if (!chegouCoisaNova) return;

    // 3. Mensagem nova: gruda só se já estava perto do fim. Rolar a lista sob
    //    os olhos de quem está lendo o histórico é a agressão clássica deste
    //    tipo de interface.
    if (coladoNoFim.current || ultima?.author.id === eu?.id) {
      el.scrollTop = el.scrollHeight;
      coladoNoFim.current = true;
      return;
    }

    setNovas((n) => n + 1);
  }, [mensagens, channelId, eu?.id]);

  const aoRolar = useCallback(() => {
    const el = rolagem.current;
    if (!el) return;

    const doFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    coladoNoFim.current = doFim < PERTO_DO_FIM;
    if (coladoNoFim.current && novas > 0) setNovas(0);

    if (el.scrollTop < GATILHO_DO_TOPO && data?.temMaisAntigas && !carregando) {
      alturaAntes.current = el.scrollHeight;
      void carregar().then((quantas) => {
        // Nada veio: desarma a compensação para não mexer no `scrollTop` na
        // próxima renderização por outro motivo.
        if (quantas === 0) alturaAntes.current = null;
      });
    }
  }, [carregar, carregando, data?.temMaisAntigas, novas]);

  // Lista curta demais para rolar nunca dispara `scroll`, e aí a primeira
  // página seria a única para sempre.
  useEffect(() => {
    const el = rolagem.current;
    if (!el || isPending) return;
    if (el.scrollHeight <= el.clientHeight) aoRolar();
  }, [isPending, mensagens.length, aoRolar]);

  // --- pular e piscar ------------------------------------------------------
  useEffect(() => {
    if (!destaqueId) return;
    const alvo = rolagem.current?.querySelector<HTMLElement>(`[data-id="${destaqueId}"]`);
    alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const id = setTimeout(limparDestaque, DURACAO_DO_PISCA_MS);
    return () => clearTimeout(id);
  }, [destaqueId, limparDestaque]);

  // --- teclado -------------------------------------------------------------
  //
  // Entra-se na lista por `⇧ Tab` a partir do compositor: ela é um único ponto
  // de parada do Tab, e a última mensagem é o alvo quando ainda não há foco.
  // `↑` **não** entra aqui — no compositor essa tecla já é "editar a última".
  const focoAtual = focoId ?? mensagens[mensagens.length - 1]?.id ?? null;

  const mover = useCallback(
    (passo: number) => {
      const i = mensagens.findIndex((m) => m.id === focoAtual);
      const proxima = mensagens[Math.min(mensagens.length - 1, Math.max(0, i + passo))];
      if (proxima) focar(proxima.id);
    },
    [mensagens, focoAtual, focar],
  );

  const digitarNoCompositor = useCallback(
    (tecla: string) => {
      focar(null);
      const campo = document.getElementById('compositor');
      if (!(campo instanceof HTMLTextAreaElement)) return;
      campo.focus();
      // Pelo setter nativo e com um evento de `input` de verdade: atribuir
      // `campo.value` direto não faz o React ver a mudança, e o primeiro
      // caractere se perderia — que é justamente o que transformaria este
      // atalho em defeito.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(campo, campo.value + tecla);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [focar],
  );

  const aoTeclar = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const alvo = focoAtual ? mensagens.find((m) => m.id === focoAtual) : undefined;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        mover(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        focar(null);
        document.getElementById('compositor')?.focus();
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const acionavel = alvo && !alvo.local && !alvo.deletedAt;
        const meuTexto = alvo?.author.id === eu?.id;

        if (acionavel && alvo) {
          switch (e.key.toLowerCase()) {
            case 'r':
              e.preventDefault();
              responder(alvo);
              return;
            case 'e':
              if (!meuTexto) break;
              e.preventDefault();
              editar(alvo);
              return;
            case 's':
              e.preventDefault();
              guardar(alvo, !alvo.saved);
              return;
            case 'p':
              if (!can(permissoes, Perm.PIN_MESSAGE)) break;
              e.preventDefault();
              fixar(alvo, alvo.pinnedAt === null);
              return;
            case 't':
              e.preventDefault();
              abrirThread(alvo.id);
              return;
            default:
              break;
          }
        }

        // Qualquer outro caractere imprimível leva ao compositor **com a
        // tecla**: perder o primeiro caractere seria pior que não ter o atalho.
        e.preventDefault();
        digitarNoCompositor(e.key);
        return;
      }

      if (e.key === 'Delete' && alvo && !alvo.local && !alvo.deletedAt) {
        const meuTexto = alvo.author.id === eu?.id;
        if (!meuTexto && !can(permissoes, Perm.DELETE_ANY_MESSAGE)) return;
        e.preventDefault();
        if (confirm('Apagar esta mensagem?')) apagar(alvo);
      }
    },
    [
      focoAtual,
      mensagens,
      mover,
      focar,
      eu?.id,
      responder,
      editar,
      guardar,
      fixar,
      apagar,
      permissoes,
      digitarNoCompositor,
      abrirThread,
    ],
  );

  const acoes: AcoesDisponiveis = useMemo(
    () => ({
      podeFixar: can(permissoes, Perm.PIN_MESSAGE),
      podeApagarDosOutros: can(permissoes, Perm.DELETE_ANY_MESSAGE),
      onReagir: reagir,
      onResponder: responder,
      onGuardar: (m) => guardar(m, !m.saved),
      onFixar: (m) => fixar(m, m.pinnedAt === null),
      onEditar: editar,
      onApagar: (m) => {
        if (confirm('Apagar esta mensagem?')) apagar(m);
      },
      onTentarDeNovo: tentarDeNovo,
      onDescartar: descartar,
      onPular: pular,
      onFocar: focar,
      onThread: (m) => abrirThread(m.id),
    }),
    [
      permissoes,
      reagir,
      responder,
      guardar,
      fixar,
      editar,
      apagar,
      tentarDeNovo,
      descartar,
      pular,
      focar,
      abrirThread,
    ],
  );

  if (isPending) return <Esqueleto />;

  return (
    <div className={styles.moldura}>
      <div
        ref={rolagem}
        className={styles.rolagem}
        onScroll={aoRolar}
        onKeyDown={aoTeclar}
        role="log"
        aria-live="polite"
        aria-label="Mensagens"
        data-janela={mensagens.length > LIMITE_SEM_JANELA}
      >
        {carregando ? (
          <div className={styles.carregandoTopo}>
            <Spinner />
          </div>
        ) : null}

        {!data?.temMaisAntigas && mensagens.length > 0 ? (
          <p className={styles.comeco}>Este é o começo da conversa.</p>
        ) : null}

        {mensagens.length === 0 ? (
          <p className={styles.vazio}>Nenhuma mensagem ainda. Escreva a primeira.</p>
        ) : null}

        {secoes.map((secao) => (
          <section key={secao.chave} className={styles.dia}>
            <div className={styles.divisorDia}>
              <span>{rotuloDoDia(secao.data)}</span>
            </div>
            {secao.linhas.map((linha) => (
              <Message
                key={linha.chave}
                mensagem={linha.mensagem}
                cabeca={linha.cabeca}
                autor={porId.get(linha.mensagem.author.id)}
                meuId={eu?.id ?? ''}
                meuUsername={eu?.username ?? ''}
                pessoas={pessoas}
                canais={canais}
                respondida={
                  linha.mensagem.replyToId
                    ? mensagensPorId.get(linha.mensagem.replyToId)
                    : undefined
                }
                focada={linha.mensagem.id === focoAtual}
                assumirFoco={linha.mensagem.id === focoId}
                destacada={linha.mensagem.id === destaqueId}
                acoes={acoes}
              />
            ))}
          </section>
        ))}
      </div>

      {novas > 0 ? (
        <button type="button" className={styles.novas} onClick={() => irAoFim('smooth')}>
          <ArrowDown size={16} />
          {novas === 1 ? '1 mensagem nova' : `${novas} mensagens novas`}
        </button>
      ) : null}
    </div>
  );
}

/** Seis blocos com a proporção real de mensagem. Nada de spinner no shell. */
function Esqueleto() {
  return (
    <div className={styles.esqueleto}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={styles.esqueletoLinha}>
          <Skeleton width="32px" height="32px" radius="var(--r-full)" />
          <div>
            <Skeleton width="120px" height="12px" />
            <Skeleton height="14px" />
            <Skeleton width={`${55 + ((i * 13) % 35)}%`} height="14px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export type { MensagemLocal };
