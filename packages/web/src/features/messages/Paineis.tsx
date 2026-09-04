import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Channel, Message } from '@trindade/shared';
import { Avatar, Spinner } from '../../components';
import { api } from '../../lib/http';
import { hora, rotuloDoDia } from './linhas';
import { useDestaque } from './store';
import styles from './messages.module.css';

/**
 * Os dois painéis de mensagem separada: fixadas e guardadas.
 *
 * Mesma linha visual, propósitos opostos — fixadas é do canal e todo mundo vê
 * a mesma lista; guardadas é sua e atravessa canais. A diferença aparece no
 * cabeçalho e no fato de a linha de guardadas nomear o canal de origem.
 * Ver design/04-mensagens.md, "Fixar e guardar".
 */

const LIMITE = 25;

interface Guardada extends Message {
  channel: { id: string; slug: string; name: string };
  savedAt: string;
}

function useFixadas(channelId: string | undefined) {
  return useQuery({
    queryKey: ['fixadas', channelId],
    enabled: Boolean(channelId),
    queryFn: () =>
      api<{ messages: Message[] }>(`/channels/${channelId}/pins`).then((r) => r.messages),
  });
}

function useGuardadas() {
  return useQuery({
    queryKey: ['guardadas'],
    queryFn: () => api<{ messages: Guardada[] }>('/saved?limit=50').then((r) => r.messages),
  });
}

interface LinhaProps {
  mensagem: Message;
  /** Só nas guardadas: elas atravessam canais e a origem é metade do valor. */
  canal?: { slug: string; name: string };
  onAbrir: () => void;
}

function Linha({ mensagem, canal, onAbrir }: LinhaProps) {
  return (
    <button type="button" className={styles.linhaPainel} onClick={onAbrir}>
      <span className={styles.linhaMeta}>
        {canal ? <span className={styles.linhaCanal}>#{canal.name}</span> : null}
        <span>{rotuloDoDia(mensagem.createdAt)}</span>
        <span>{hora(mensagem.createdAt)}</span>
      </span>
      <span className={styles.linhaAutor}>
        <Avatar
          id={mensagem.author.id}
          name={mensagem.author.displayName}
          src={mensagem.author.avatarUrl}
          size="xs"
        />
        <strong>{mensagem.author.displayName}</strong>
      </span>
      <span className={styles.linhaTexto}>{mensagem.content}</span>
    </button>
  );
}

function Vazio({ titulo, dica }: { titulo: string; dica: string }) {
  return (
    <div className={styles.painelVazio}>
      <p>{titulo}</p>
      {/* O texto ensina o gesto. "Nenhum item" não ensina nada. */}
      <p className={styles.painelDica}>{dica}</p>
    </div>
  );
}

export function PainelFixadas({ canal }: { canal: Channel | undefined }) {
  const { data, isPending } = useFixadas(canal?.id);
  const pular = useDestaque((s) => s.pular);

  if (isPending) return <Spinner />;
  if (!data || data.length === 0) {
    return (
      <Vazio
        titulo="Nada fixado neste canal."
        dica="Passe o mouse numa mensagem e clique no alfinete para deixá-la aqui para todo mundo."
      />
    );
  }

  return (
    <>
      {/* O aviso empurra para a ferramenta certa em vez de só reclamar do
          número. Ver design/08-projeto.md. */}
      {data.length > LIMITE ? (
        <p className={styles.avisoPainel}>
          Muita coisa fixada. Vale mover as decisões antigas para as notas.
        </p>
      ) : null}
      {data.map((m) => (
        <Linha key={m.id} mensagem={m} onAbrir={() => pular(m.id)} />
      ))}
    </>
  );
}

export function PainelGuardadas() {
  const { data, isPending } = useGuardadas();
  const pular = useDestaque((s) => s.pular);
  const navigate = useNavigate();

  if (isPending) return <Spinner />;
  if (!data || data.length === 0) {
    return (
      <Vazio
        titulo="Nada guardado ainda."
        dica="Passe o mouse numa mensagem e clique no marcador para voltar nela depois. Só você vê esta lista."
      />
    );
  }

  return (
    <>
      {data.map((m) => (
        <Linha
          key={m.id}
          mensagem={m}
          canal={m.channel}
          onAbrir={() => {
            // Troca de canal antes de pedir o pulo: a lista do canal certo é
            // quem sabe rolar até a mensagem e piscá-la.
            navigate(`/c/${m.channel.slug}`);
            pular(m.id);
          }}
        />
      ))}
    </>
  );
}
