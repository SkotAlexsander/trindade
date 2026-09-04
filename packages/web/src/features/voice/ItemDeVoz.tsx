import type React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../components';
import { Volume } from '../../components/icones';
import { useUsers } from '../channels/queries';
import canais from '../channels/channels.module.css';
import type { ChannelWithState } from '../channels/canais';
import { naChamada, useVoz } from './store';
import { useChamada } from './useChamada';
import styles from './voz.module.css';

/**
 * Um canal de voz na lista.
 *
 * Clicar **conecta e abre a conversa** — a chamada e o que se escreve durante
 * ela são a mesma sala, e por isso o canal de voz tem histórico, menção e não
 * lido como qualquer outro. Não há antessala: com cinco pessoas conhecidas,
 * uma tela de pré-visualização é cerimônia.
 *
 * Quem está fora vê os avatares de quem está dentro, com anel em quem fala.
 * Isso basta: a informação está disponível de relance e não exige ação, e é a
 * razão de **não** existir notificação de "fulano entrou na chamada" — numa
 * equipe de cinco isso dispararia o dia inteiro.
 */
export function ItemDeVoz({
  canal,
  className,
  arrastando = false,
  arrasto,
}: {
  canal: ChannelWithState;
  className: string;
  arrastando?: boolean;
  /** Os mesmos punhos de arrastar do item de texto: reordenar continua valendo. */
  arrasto?: {
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { data: pessoas } = useUsers();
  const estados = useVoz((s) => s.estados);
  const falando = useVoz((s) => s.falando);
  const meuCanal = useVoz((s) => (s.fase === 'fora' ? null : s.channelId));
  const { entrar } = useChamada();

  const dentro = naChamada(estados, canal.id);
  const naSala = meuCanal === canal.id;

  function aoClicar(): void {
    // Abrir a conversa acontece sempre; entrar na chamada, só quando ainda não
    // se está nela — clicar de novo no canal em que você já está seria sair e
    // voltar, com os dois sons e um instante mudo no meio.
    navigate(`/c/${canal.slug}`);
    if (!naSala) void entrar(canal.id);
  }

  return (
    <>
      <button
        type="button"
        className={[className, slug === canal.slug ? canais.ativo : ''].filter(Boolean).join(' ')}
        data-conectado={naSala}
        data-unread={canal.unread}
        data-arrastando={arrastando}
        onClick={aoClicar}
        {...arrasto}
      >
        <span className={canais.icone}>
          <Volume size={16} />
        </span>
        <span className={canais.nome}>{canal.name}</span>
        {canal.mentions > 0 ? (
          <span className={canais.mencoes} aria-label={`${canal.mentions} menções`}>
            {canal.mentions > 9 ? '9+' : canal.mentions}
          </span>
        ) : canal.unread ? (
          <span className={canais.ponto} aria-label="não lido" />
        ) : null}
      </button>

      {dentro.length > 0 ? (
        <div className={styles.noCanal} aria-label={`${dentro.length} na chamada`}>
          {dentro.map((estado) => {
            const pessoa = pessoas?.find((p) => p.id === estado.userId);
            if (!pessoa) return null;
            return (
              <span
                key={estado.userId}
                data-falando={falando.has(estado.userId)}
                title={pessoa.displayName}
              >
                <Avatar
                  id={pessoa.id}
                  name={pessoa.displayName}
                  src={pessoa.avatarUrl}
                  size="xs"
                />
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
