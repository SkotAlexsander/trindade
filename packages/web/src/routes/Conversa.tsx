import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Composer } from '../features/messages/Composer';
import { Digitando } from '../features/messages/Digitando';
import { MessageList } from '../features/messages/MessageList';
import { useChannels, useUsers } from '../features/channels/queries';
import { conversa as conversaComoAlvo } from '../features/messages/alvo';
import { nomeDaConversa, useConversas } from '../features/conversations/queries';
import { AvisoDePrivacidade } from '../features/conversations/AvisoDePrivacidade';
import { useAuth } from '../features/auth/store';
import styles from '../features/messages/canal.module.css';

/**
 * Uma conversa privada.
 *
 * A mesma lista, o mesmo compositor e o mesmo "está digitando" do canal — o
 * que muda é o alvo e o nome no placeholder. Duplicar isso aqui seria manter
 * duas rolagens e dois compositores em dia. Ver design/10-conversas-privadas.md.
 */
export function Conversa() {
  const { id } = useParams<{ id: string }>();
  const meuId = useAuth((s) => s.user?.id) ?? '';
  const { data: conversas } = useConversas();
  const { data: pessoas } = useUsers();
  const { data: canais } = useChannels();

  const conversa = conversas?.find((c) => c.id === id);
  const alvo = useMemo(() => conversaComoAlvo(id ?? ''), [id]);

  if (!id) return null;

  const nome = conversa ? nomeDaConversa(conversa, pessoas ?? [], meuId) : 'Conversa';

  return (
    <div className={styles.canal}>
      <MessageList key={id} alvo={alvo} pessoas={pessoas ?? []} canais={canais ?? []} />
      {/* A promessa aparece uma vez, na primeira abertura de uma direta, e
          some para sempre. Ver `AvisoDePrivacidade`. */}
      {conversa?.kind === 'direct' ? <AvisoDePrivacidade /> : null}
      <Digitando channelId={id} pessoas={pessoas ?? []} />
      <Composer
        alvo={alvo}
        nome={nome}
        preposicao="para"
        pessoas={pessoas ?? []}
        canais={canais ?? []}
      />
    </div>
  );
}
