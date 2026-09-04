import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, Message, User } from '@trindade/shared';
import { Spinner } from '../../components';
import { api } from '../../lib/http';
import { useAuth } from '../auth/store';
import { Conteudo } from './Conteudo';
import { CompositorSimples } from './CompositorSimples';
import { alvoDaMensagem } from './alvo';
import { hora, rotuloDoDia } from './linhas';
import { chaveDaThread, type CacheDeThread } from './queries';
import { useThread } from './store';
import styles from './messages.module.css';

/**
 * A thread, no painel direito.
 *
 * A mensagem-mãe fixa no topo, as respostas abaixo, e um compositor próprio.
 * As respostas **não aparecem no canal**: quem quis tirar uma conversa da
 * linha principal não quer vê-la de volta lá.
 */

export interface PainelThreadProps {
  pessoas: readonly User[];
  canais: readonly Channel[];
}

interface Resposta {
  parent: Message;
  replies: Message[];
}

export function PainelThread({ pessoas, canais }: PainelThreadProps) {
  const parentId = useThread((s) => s.parentId);
  const eu = useAuth((s) => s.user);
  const fim = useRef<HTMLDivElement>(null);

  const { data, isPending } = useQuery({
    queryKey: chaveDaThread(parentId ?? ''),
    enabled: Boolean(parentId),
    staleTime: Infinity,
    queryFn: async (): Promise<CacheDeThread> => {
      const r = await api<Resposta>(`/messages/${parentId}/thread`);
      return { parent: r.parent, replies: r.replies };
    },
  });

  const quantas = data?.replies.length ?? 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [quantas]);

  if (!parentId) return null;
  if (isPending) return <Spinner />;
  if (!data) return <p className={styles.painelDica}>Esta mensagem não existe mais.</p>;

  return (
    <div className={styles.thread}>
      <div className={styles.threadRolagem}>
        <article className={styles.threadPai}>
          <Cabeca mensagem={data.parent} />
          <Conteudo
            texto={data.parent.content ?? ''}
            pessoas={pessoas}
            canais={canais}
            meuUsername={eu?.username ?? ''}
          />
        </article>

        <div className={styles.threadDivisor}>
          {quantas === 0
            ? 'Sem respostas ainda'
            : quantas === 1
              ? '1 resposta'
              : `${quantas} respostas`}
        </div>

        {data.replies.map((r) => (
          <article key={r.id} className={styles.threadResposta} data-local={r.local ?? undefined}>
            <Cabeca mensagem={r} />
            {r.deletedAt ? (
              <p className={styles.apagada}>Mensagem apagada</p>
            ) : (
              <Conteudo
                texto={r.content ?? ''}
                pessoas={pessoas}
                canais={canais}
                meuUsername={eu?.username ?? ''}
              />
            )}
          </article>
        ))}
        <div ref={fim} />
      </div>

      <CompositorSimples
        alvo={alvoDaMensagem(data.parent)}
        parentId={data.parent.id}
        rotulo="Responder na thread"
      />
    </div>
  );
}

function Cabeca({ mensagem }: { mensagem: Message }) {
  return (
    <div className={styles.threadCabeca}>
      <strong>{mensagem.author.displayName}</strong>
      <time dateTime={mensagem.createdAt}>
        {rotuloDoDia(mensagem.createdAt)} {hora(mensagem.createdAt)}
      </time>
    </div>
  );
}
