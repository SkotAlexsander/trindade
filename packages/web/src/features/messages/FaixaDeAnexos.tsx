import { Arquivo, X } from '../../components/icones';
import { tamanhoLegivel, useAnexos, type AnexoPendente } from './useAnexos';
import styles from './anexos.module.css';

/**
 * A faixa de anexos pendentes, acima do campo.
 *
 * Miniaturas de 56px com barra de progresso de 2px na base. O upload já está
 * em curso quando isto aparece — ver design/04-mensagens.md, "Anexo pendente".
 */
export function FaixaDeAnexos({ channelId }: { channelId: string }) {
  const lista = useAnexos((s) => s.porCanal[channelId]);
  const remover = useAnexos((s) => s.remover);

  if (!lista || lista.length === 0) return null;

  return (
    <div className={styles.faixa} aria-label="Arquivos anexados">
      {lista.map((a: AnexoPendente) => (
        <div
          key={a.chave}
          className={styles.pendente}
          data-estado={a.estado}
          title={`${a.nome} — ${tamanhoLegivel(a.tamanho)}`}
        >
          {a.miniatura ? (
            <img className={styles.pendenteMiniatura} src={a.miniatura} alt="" />
          ) : (
            <span className={styles.pendenteArquivo}>
              <Arquivo size={20} />
            </span>
          )}
          {/* O nome só aparece quando não há miniatura para reconhecer; sobre
              a imagem ele seria uma tarja tapando o que a pessoa quer ver. */}
          {a.miniatura ? null : <span className={styles.pendenteNome}>{a.nome}</span>}

          <button
            type="button"
            className={styles.pendenteRemover}
            aria-label={`Remover ${a.nome}`}
            onClick={() => remover(channelId, a.chave)}
          >
            <X size={12} />
          </button>

          {a.estado !== 'pronto' ? (
            <span
              className={styles.barra}
              style={{ width: `${Math.round(a.progresso * 100)}%` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      ))}

      {lista
        .filter((a) => a.estado === 'falhou')
        .map((a) => (
          <p key={`erro-${a.chave}`} className={styles.erroDoAnexo}>
            {a.nome}: {a.erro ?? 'não subiu'}
          </p>
        ))}
    </div>
  );
}
