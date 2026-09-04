import { Perm, can, type Poll, type User } from '@trindade/shared';
import { Tooltip, useToast } from '../../components';
import { useAuth } from '../auth/store';
import { prazoDaEnquete, useFecharEnquete, useResultadoParaNotas, useVotar } from './queries';
import styles from './enquetes.module.css';

/**
 * A enquete dentro da mensagem.
 *
 * A barra **é** a informação: a líder em `--accent`, as demais discretas, e o
 * número em `tabular-nums` ao lado. "3 de 5 votaram" e não "60%" — com cinco
 * pessoas, o número absoluto é o que se lê. Ver design/08-projeto.md.
 */
export function Enquete({ poll, pessoas }: { poll: Poll; pessoas: readonly User[] }) {
  const meuId = useAuth((s) => s.user?.id);
  const podeAnotar = can(
    useAuth((s) => s.permissions),
    Perm.MANAGE_NOTES,
  );
  const { show } = useToast();
  const votar = useVotar();
  const fechar = useFecharEnquete();
  const paraNotas = useResultadoParaNotas();

  const prazo = prazoDaEnquete(poll);
  const encerrada = prazo === 'encerrada';
  const lider = Math.max(0, ...poll.options.map((o) => o.count));

  function alternar(optionId: string): void {
    if (encerrada) return;
    const jaTem = poll.myVotes.includes(optionId);
    // No múltiplo o clique liga e desliga cada opção; no único ele troca a
    // escolha, e clicar na que já está marcada tira o voto.
    const optionIds = poll.multiple
      ? jaTem
        ? poll.myVotes.filter((v) => v !== optionId)
        : [...poll.myVotes, optionId]
      : jaTem
        ? []
        : [optionId];
    votar.mutate({ pollId: poll.id, optionIds });
  }

  return (
    <section className={styles.enquete} aria-label={`Enquete: ${poll.question}`}>
      <ul className={styles.opcoes}>
        {poll.options.map((opcao) => {
          const minha = poll.myVotes.includes(opcao.id);
          const nomes = opcao.voters
            .map((id) => pessoas.find((p) => p.id === id)?.displayName)
            .filter(Boolean) as string[];

          const botao = (
            <button
              type="button"
              className={styles.opcao}
              data-minha={minha}
              data-lider={lider > 0 && opcao.count === lider}
              data-encerrada={encerrada}
              disabled={encerrada}
              aria-pressed={minha}
              onClick={() => alternar(opcao.id)}
            >
              <span className={styles.marca} data-marcada={minha} data-multipla={poll.multiple} />
              <span className={styles.rotulo}>{opcao.label}</span>
              {/* A barra vive atrás do texto, e a largura é a proporção sobre a
                  líder: comparar com o total faria três empates parecerem três
                  derrotas. */}
              <span
                className={styles.barra}
                style={{ width: lider > 0 ? `${(opcao.count / lider) * 100}%` : '0%' }}
                aria-hidden="true"
              />
              <span className={styles.contagem}>{opcao.count}</span>
            </button>
          );

          // Quem votou aparece no hover — e só em enquete aberta, porque na
          // anônima o servidor nem manda os nomes.
          return (
            <li key={opcao.id}>
              {nomes.length > 0 ? <Tooltip label={nomes.join(', ')}>{botao}</Tooltip> : botao}
            </li>
          );
        })}
      </ul>

      <p className={styles.rodape}>
        <span>
          {poll.voterCount === 1 ? '1 pessoa votou' : `${poll.voterCount} pessoas votaram`}
        </span>
        {poll.anonymous ? (
          <>
            <span aria-hidden="true">·</span>
            <span>anônima</span>
          </>
        ) : null}
        {prazo ? (
          <>
            <span aria-hidden="true">·</span>
            <span data-encerrada={encerrada || undefined}>{prazo}</span>
          </>
        ) : null}
        {/* Encerrar é de quem perguntou, e some quando já está encerrada. */}
        {!encerrada && poll.createdBy === meuId ? (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className={styles.encerrar}
              onClick={() => fechar.mutate(poll.id)}
            >
              encerrar
            </button>
          </>
        ) : null}

        {/* A sugestão discreta de sempre: decisão tomada vira registro em um
            clique. Só para quem perguntou, e só depois de encerrada — o
            resultado de uma enquete aberta ainda vai mudar. */}
        {encerrada && poll.createdBy === meuId && podeAnotar ? (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              className={styles.paraNotas}
              disabled={paraNotas.isPending || paraNotas.isSuccess}
              onClick={() =>
                paraNotas.mutate(poll.id, {
                  onSuccess: () => show('Resultado adicionado às notas do canal.'),
                  onError: () => show('Não foi possível adicionar às notas.', 'danger'),
                })
              }
            >
              {paraNotas.isSuccess ? 'nas notas' : 'adicionar o resultado às notas'}
            </button>
          </>
        ) : null}
      </p>
    </section>
  );
}
