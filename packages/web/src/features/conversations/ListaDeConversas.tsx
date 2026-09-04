import { NavLink } from 'react-router-dom';
import type { Conversation, User } from '@trindade/shared';
import { Avatar } from '../../components';
import { SinoCortado } from '../../components/icones';
import { useAuth } from '../auth/store';
import { useLeitura } from '../messages/leitura';
import { nomeDaConversa, visiveis } from './queries';
import styles from './conversas.module.css';

/**
 * A seção "Conversas", acima dos canais.
 *
 * Só aparecem as que têm mensagem: uma direta recém-criada e vazia continua no
 * banco e continua invisível aqui. Ordenadas pela última mensagem — com no
 * máximo uma dúzia de entradas, não precisa de mais nada.
 * Ver design/10-conversas-privadas.md.
 */
export function ListaDeConversas({
  conversas,
  pessoas,
}: {
  conversas: readonly Conversation[];
  pessoas: readonly User[];
}) {
  const meuId = useAuth((s) => s.user?.id) ?? '';
  const leitura = useLeitura((s) => s.porCanal);

  const lista = visiveis(conversas);
  if (lista.length === 0) return null;

  return (
    <nav aria-label="Conversas" className={styles.secao}>
      <div className={styles.titulo}>
        <span className="section-label">Conversas</span>
      </div>

      {lista.map((conversa) => {
        const outros = conversa.members
          .filter((id) => id !== meuId)
          .map((id) => pessoas.find((p) => p.id === id))
          .filter((p): p is User => Boolean(p));

        // O estado de leitura vem do mesmo mapa dos canais, indexado pelo id
        // do alvo — e o do servidor, na carga da lista, é o piso.
        const estado = leitura[conversa.id];
        const mencoes = estado?.mentionCount ?? conversa.mentionCount;
        const naoLidas = estado?.unreadCount ?? conversa.unreadCount;
        const mudoAte = estado?.mutedUntil ?? conversa.mutedUntil;
        const silenciada = Boolean(mudoAte) && Date.parse(mudoAte as string) > Date.now();

        return (
          <NavLink
            key={conversa.id}
            to={`/d/${conversa.id}`}
            className={({ isActive }) =>
              [styles.item, isActive ? styles.ativo : ''].filter(Boolean).join(' ')
            }
            data-unread={naoLidas > 0}
            data-silenciada={silenciada}
          >
            {/* Direta: um avatar com anel de status. Grupo: dois sobrepostos —
                a forma diz o tipo antes de qualquer nome. */}
            <span className={styles.avatares} data-grupo={conversa.kind === 'group'}>
              {outros.slice(0, 2).map((p) => (
                <Avatar
                  key={p.id}
                  id={p.id}
                  name={p.displayName}
                  src={p.avatarUrl}
                  size="xs"
                  {...(conversa.kind === 'direct' ? { status: p.status } : {})}
                />
              ))}
            </span>

            <span className={styles.nome}>{nomeDaConversa(conversa, pessoas, meuId)}</span>

            {silenciada ? (
              <span className={styles.sino} aria-label="silenciada">
                <SinoCortado size={12} />
              </span>
            ) : null}

            {mencoes > 0 ? (
              <span className={styles.mencoes} aria-label={`${mencoes} não lidas`}>
                {mencoes > 9 ? '9+' : mencoes}
              </span>
            ) : naoLidas > 0 ? (
              <span className={styles.ponto} aria-label="não lido" />
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
