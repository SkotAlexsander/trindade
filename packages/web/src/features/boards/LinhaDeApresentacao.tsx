import { useNavigate } from 'react-router-dom';
import { useApresentacoes, apresentacaoNoCanal } from './apresentacoes';
import { useQuadroAberto } from './store';
import styles from './quadros.module.css';

/**
 * "◉ Fluxo de onboarding", indentado sob o canal enquanto alguém apresenta.
 *
 * É o mesmo lugar em que os avatares da chamada aparecem, e pela mesma razão:
 * uma coisa ao vivo acontecendo ali dentro precisa ser vista por quem está
 * olhando a lista, não só por quem já abriu o quadro. Clicar entra na
 * apresentação. Ver design/11-quadro.md.
 */
export function LinhaDeApresentacao({ channelId, slug }: { channelId: string; slug: string }) {
  const navigate = useNavigate();
  const abrir = useQuadroAberto((s) => s.abrir);
  const apresentacao = useApresentacoes((s) => apresentacaoNoCanal(s.porQuadro, channelId));

  if (!apresentacao) return null;

  return (
    <button
      type="button"
      className={styles.linhaAoVivo}
      onClick={() => {
        // O canal primeiro: o quadro cobre a conversa, e sair dele tem de
        // deixar a pessoa no lugar de que ele fala.
        navigate(`/c/${slug}`);
        abrir(apresentacao.boardId, channelId);
      }}
    >
      <span className={styles.pontoAoVivo} aria-hidden="true" />
      <span className={styles.nomeAoVivo}>{apresentacao.boardName}</span>
    </button>
  );
}
