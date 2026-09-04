import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@trindade/shared';
import { Skeleton, Spinner } from '../../components';
import { ArrowDown } from '../../components/icones';
import { api } from '../../lib/http';
import { useAuth } from '../auth/store';
import { mexerNaReacao } from './queries';
import { Message } from './Message';
import { montarSecoes, rotuloDoDia } from './linhas';
import { useCarregarAntigas, useMessages, type MensagemLocal } from './queries';
import { useEnviarMensagem } from './useEnviar';
import styles from './messages.module.css';

/**
 * O histórico e o comportamento de rolagem.
 *
 * É a parte que a maioria dos clones de chat erra, e as regras estão em
 * design/04-mensagens.md:
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
}

export function MessageList({ channelId, pessoas }: MessageListProps) {
  const qc = useQueryClient();
  const eu = useAuth((s) => s.user);
  const { data, isPending } = useMessages(channelId);
  const { carregar, carregando } = useCarregarAntigas(channelId);
  const { tentarDeNovo, descartar } = useEnviarMensagem();

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

  const reagir = useCallback(
    (messageId: string, emoji: string, tirar: boolean) => {
      if (!eu) return;
      const caminho = `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`;
      // Otimista: o evento do socket confirma, e se a chamada falhar o estado
      // volta ao que era.
      mexerNaReacao(qc, { messageId, channelId, userId: eu.id, emoji }, eu.id, !tirar);
      void api(caminho, { method: tirar ? 'DELETE' : 'PUT' }).catch(() => {
        mexerNaReacao(qc, { messageId, channelId, userId: eu.id, emoji }, eu.id, tirar);
      });
    },
    [qc, channelId, eu],
  );

  if (isPending) return <Esqueleto />;

  return (
    <div className={styles.moldura}>
      <div
        ref={rolagem}
        className={styles.rolagem}
        onScroll={aoRolar}
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
                meuUsername={eu?.username ?? ''}
                onReagir={reagir}
                onTentarDeNovo={tentarDeNovo}
                onDescartar={descartar}
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
