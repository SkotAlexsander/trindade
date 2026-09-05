import { useState } from 'react';
import { Perm, can, type User } from '@trindade/shared';
import { Button, useToast } from '../../components';
import { useAuth } from '../auth/store';
import { haQuantoTempo } from '../messages/linhas';
import { useCriarQuadro, useQuadros } from './queries';
import { useQuadroAberto } from './store';
import styles from './quadros.module.css';

/**
 * A lista de quadros do canal, no painel direito.
 *
 * Cartão com miniatura, nome e quem mexeu por último. Clicar abre em tela
 * cheia sobre a conversa — o painel é onde os quadros ficam, não onde se
 * desenha. Ver design/11-quadro.md.
 */
export function PainelDeQuadros({
  channelId,
  pessoas,
}: {
  channelId: string;
  pessoas: readonly User[];
}) {
  const { data: quadros, isPending } = useQuadros(channelId);
  const abrir = useQuadroAberto((s) => s.abrir);
  const criar = useCriarQuadro(channelId);
  const { show } = useToast();
  const permissoes = useAuth((s) => s.permissions);
  const podeCriar = can(permissoes, Perm.MANAGE_NOTES);

  const [nome, setNome] = useState('');

  function criarQuadro(evento: React.FormEvent): void {
    evento.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;

    criar.mutate(limpo, {
      onSuccess: ({ board }) => {
        setNome('');
        // Abre o que acabou de nascer: ninguém cria um quadro para olhar o
        // cartão dele.
        abrir(board.id, channelId);
      },
      onError: () => show('Não foi possível criar o quadro.', 'danger'),
    });
  }

  return (
    <div className={styles.painel}>
      {podeCriar ? (
        <form className={styles.novo} onSubmit={criarQuadro}>
          <input
            type="text"
            value={nome}
            maxLength={48}
            placeholder="Nome do quadro"
            aria-label="Nome do quadro novo"
            onChange={(e) => setNome(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!nome.trim() || criar.isPending}>
            Criar
          </Button>
        </form>
      ) : null}

      {isPending ? <p className={styles.vazio}>Carregando…</p> : null}

      {!isPending && (quadros?.length ?? 0) === 0 ? (
        <p className={styles.vazio}>
          Nenhum quadro aqui ainda. Um quadro serve para desenhar junto o que não
          cabe numa frase.
        </p>
      ) : null}

      <ul className={styles.lista}>
        {(quadros ?? []).map((quadro) => {
          const quem = pessoas.find((p) => p.id === (quadro.updatedBy ?? quadro.createdBy));
          return (
            <li key={quadro.id}>
              <button
                type="button"
                className={styles.cartao}
                onClick={() => abrir(quadro.id, channelId)}
              >
                <span className={styles.miniatura}>
                  {quadro.thumbnailUrl ? (
                    // Sem `alt` descritivo: o nome do quadro está logo abaixo, e
                    // repeti-lo faria o leitor de tela dizer tudo duas vezes.
                    <img src={quadro.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.semMiniatura} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.tituloDoCartao}>{quadro.name}</span>
                <span className={styles.meta}>
                  {quem ? `${quem.displayName.split(' ')[0]} · ` : ''}
                  {haQuantoTempo(quadro.updatedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
