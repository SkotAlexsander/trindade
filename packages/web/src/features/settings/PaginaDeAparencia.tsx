import { Monitor, Moon, Sun } from '../../components/icones';
import { useTheme, type Theme } from '../../lib/tema';
import styles from './ajustes.module.css';

/**
 * Aparência.
 *
 * O menu do servidor oferecia isto desde a fase 4 e a rota caía numa página
 * que dizia "chega numa fase adiante" — com o `useTheme` pronto desde a fase 3
 * e um seletor funcionando em `/dev/ui`, que ninguém fora do desenvolvimento
 * vê.
 *
 * Três opções e nada mais. Não há controle de densidade nem de tamanho de
 * fonte: a densidade é uma decisão de projeto — ver design/00-direcao-visual.md,
 * "Densidade é respeito" — e quem quer texto maior tem o zoom do navegador,
 * que funciona melhor do que qualquer réplica nossa porque também aumenta o
 * alvo de clique.
 */

const TEMAS: { valor: Theme; rotulo: string; dica: string; Icone: typeof Sun }[] = [
  { valor: 'light', rotulo: 'Claro', dica: 'Tinta sobre papel frio.', Icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', dica: 'Quase preto, com neon.', Icone: Moon },
  {
    valor: 'system',
    rotulo: 'Sistema',
    dica: 'Segue o aparelho, e muda com ele.',
    Icone: Monitor,
  },
];

export function PaginaDeAparencia() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <div className={styles.secoes}>
      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Tema</h2>
        <p className={styles.secaoDica}>
          Fica guardado neste navegador, em cookie — é o que permite a página já
          nascer no tema certo, sem a piscada branca de quem só descobre isso
          depois que o JavaScript roda.
        </p>

        <div className={styles.opcoes} role="radiogroup" aria-label="Tema">
          {TEMAS.map(({ valor, rotulo, dica, Icone }) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={theme === valor}
              className={styles.opcao}
              data-escolhido={theme === valor}
              onClick={() => setTheme(valor)}
            >
              <span className={styles.opcaoIcone} aria-hidden="true">
                <Icone size={20} />
              </span>
              <span className={styles.opcaoNome}>{rotulo}</span>
              <span className={styles.opcaoDica}>{dica}</span>
              {valor === 'system' ? (
                <span className={styles.opcaoAgora}>
                  agora: {resolved === 'dark' ? 'escuro' : 'claro'}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Movimento</h2>
        <p className={styles.secaoDica}>
          A interface respeita <code>prefers-reduced-motion</code> do sistema: com
          ele ligado, toda transição e animação daqui cai para quase zero. Não há
          interruptor próprio porque uma preferência de acessibilidade já
          declarada no aparelho não deve precisar ser declarada de novo em cada
          aplicativo.
        </p>
      </section>
    </div>
  );
}
