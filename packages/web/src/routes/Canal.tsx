import { useParams } from 'react-router-dom';
import { Composer } from '../features/messages/Composer';
import { Digitando } from '../features/messages/Digitando';
import { MessageList } from '../features/messages/MessageList';
import { useChannels, useUsers } from '../features/channels/queries';
import styles from '../features/messages/canal.module.css';

/**
 * A conversa: histórico, quem está digitando, compositor.
 *
 * A rolagem é da lista, não desta rota — ela precisa do próprio elemento para
 * medir alturas e compensar a posição ao carregar histórico antigo.
 */
export function Canal() {
  const { slug } = useParams<{ slug: string }>();
  const { data: canais } = useChannels();
  const { data: pessoas } = useUsers();
  const canal = canais?.find((c) => c.slug === slug);

  if (!canal) {
    return (
      <div className={styles.semCanal}>
        <p>Escolha um canal para começar.</p>
      </div>
    );
  }

  // Canal de voz ainda não tem tela: a chamada é da fase 7.
  if (canal.kind === 'voice') {
    return (
      <div className={styles.semCanal}>
        <strong>{canal.name}</strong>
        <p>Canais de voz entram na fase 7.</p>
      </div>
    );
  }

  return (
    <div className={styles.canal}>
      {/* A chave força a lista a recomeçar ao trocar de canal: posição de
          rolagem e contadores de um canal não valem para o outro. */}
      <MessageList
        key={canal.id}
        channelId={canal.id}
        pessoas={pessoas ?? []}
        canais={canais ?? []}
      />
      <Digitando channelId={canal.id} pessoas={pessoas ?? []} />
      <Composer canal={canal} />
    </div>
  );
}
