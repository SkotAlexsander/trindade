import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MENCAO_DE_TODOS, type Channel, type User } from '@trindade/shared';
import { analisarMarkdown, type Bloco, type No } from './markdown';
import { linguaConhecida, realcar, type Pedaco } from './realce';
import styles from './messages.module.css';

/**
 * O corpo da mensagem.
 *
 * Nós React em toda parte, nunca `dangerouslySetInnerHTML`. Ver o cabeçalho de
 * `markdown.ts`: quando não se injeta HTML, não há o que sanitizar.
 */

/** Acima disto, o bloco de código nasce colapsado. */
const LINHAS_ATE_COLAPSAR = 15;
/** Quanto tempo o botão de copiar fica dizendo "Copiado". */
const COPIADO_MS = 1500;

export interface ConteudoProps {
  texto: string;
  pessoas: readonly User[];
  canais: readonly Channel[];
  /** Para saber se uma menção é a você — muda a cor da linha inteira. */
  meuUsername: string;
}

export const Conteudo = memo(function Conteudo({ texto, pessoas, canais }: ConteudoProps) {
  const blocos = useMemo(() => analisarMarkdown(texto), [texto]);
  return (
    <>
      {blocos.map((bloco, i) => (
        <BlocoRender key={i} bloco={bloco} pessoas={pessoas} canais={canais} />
      ))}
    </>
  );
});

function BlocoRender({
  bloco,
  pessoas,
  canais,
}: {
  bloco: Bloco;
  pessoas: readonly User[];
  canais: readonly Channel[];
}) {
  switch (bloco.tipo) {
    case 'paragrafo':
      return (
        <p className={styles.corpo}>
          <Nos nos={bloco.filhos} pessoas={pessoas} canais={canais} />
        </p>
      );
    case 'citacao':
      return (
        <blockquote className={styles.citacaoTexto2}>
          <Nos nos={bloco.filhos} pessoas={pessoas} canais={canais} />
        </blockquote>
      );
    case 'lista': {
      const Tag = bloco.ordenada ? 'ol' : 'ul';
      return (
        <Tag className={styles.lista}>
          {bloco.itens.map((item, i) => (
            <li key={i}>
              <Nos nos={item} pessoas={pessoas} canais={canais} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'bloco-de-codigo':
      return <BlocoDeCodigo lingua={bloco.lingua} valor={bloco.valor} />;
  }
}

function Nos({
  nos,
  pessoas,
  canais,
}: {
  nos: readonly No[];
  pessoas: readonly User[];
  canais: readonly Channel[];
}): ReactNode {
  return nos.map((no, i) => (
    <Fragment key={i}>
      <NoRender no={no} pessoas={pessoas} canais={canais} />
    </Fragment>
  ));
}

function NoRender({
  no,
  pessoas,
  canais,
}: {
  no: No;
  pessoas: readonly User[];
  canais: readonly Channel[];
}): ReactNode {
  const navigate = useNavigate();

  switch (no.tipo) {
    case 'texto':
      return no.valor;
    case 'quebra':
      return <br />;
    case 'negrito':
      return (
        <strong>
          <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
        </strong>
      );
    case 'italico':
      return (
        <em>
          <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
        </em>
      );
    case 'riscado':
      return (
        <s>
          <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
        </s>
      );
    case 'codigo':
      return <code className={styles.codigoEmLinha}>{no.valor}</code>;
    case 'spoiler':
      return (
        <Spoiler>
          <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
        </Spoiler>
      );
    case 'link': {
      /* Link para dentro do produto navega **aqui**, sem abrir aba nova: uma
         aba a mais refaz o READY, reconecta o socket e derruba a chamada — e
         quem clicou só queria ir para um canal ou abrir um quadro. É o caso
         das linhas de sistema, que trazem o endereço completo. */
      const daCasa = no.href.startsWith(`${location.origin}/`);
      if (daCasa) {
        const destino = no.href.slice(location.origin.length);
        return (
          <a
            className={styles.link}
            href={no.href}
            onClick={(evento) => {
              // Ctrl/⌘ e o botão do meio continuam abrindo aba nova: quem pede
              // isso está pedindo de propósito.
              if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
              evento.preventDefault();
              navigate(destino);
            }}
          >
            <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
          </a>
        );
      }

      return (
        // `noopener` sempre: sem ele a página aberta ganha `window.opener` e
        // pode navegar a nossa aba para onde quiser.
        <a
          className={styles.link}
          href={no.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <Nos nos={no.filhos} pessoas={pessoas} canais={canais} />
        </a>
      );
    }
    case 'mencao': {
      /* `@todos` não é ninguém, e é a única menção que não vira nome: ela
         chama o grupo, e some da tela como "@todos" mesmo. */
      if (no.username === MENCAO_DE_TODOS) {
        return (
          <span className={styles.mencao} data-todos="true">
            @{MENCAO_DE_TODOS}
          </span>
        );
      }

      const pessoa = pessoas.find((p) => p.username === no.username);
      // Menção a quem não existe é texto, não um objeto quebrado.
      if (!pessoa) return `@${no.username}`;
      return (
        <span className={styles.mencao} data-id={pessoa.id}>
          @{pessoa.displayName}
        </span>
      );
    }
    case 'canal': {
      const canal = canais.find((c) => c.slug === no.slug);
      if (!canal) return `#${no.slug}`;
      return (
        <button
          type="button"
          className={styles.mencao}
          onClick={() => navigate(`/c/${canal.slug}`)}
        >
          #{canal.name}
        </button>
      );
    }
  }
}

/**
 * Spoiler: some até alguém clicar, e não volta.
 *
 * Voltar a esconder depois de revelado seria brincadeira: quem clicou já leu.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <button
      type="button"
      className={styles.spoiler}
      data-aberto={aberto}
      aria-label={aberto ? undefined : 'Revelar spoiler'}
      onClick={() => setAberto(true)}
    >
      {children}
    </button>
  );
}

function BlocoDeCodigo({ lingua, valor }: { lingua: string | null; valor: string }) {
  const [pedacos, setPedacos] = useState<Pedaco[][] | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linhas = useMemo(() => valor.split('\n'), [valor]);
  const comprido = linhas.length > LINHAS_ATE_COLAPSAR;
  const conhecida = linguaConhecida(lingua);

  useEffect(() => {
    if (!conhecida) return;
    let vivo = true;
    void realcar(valor, conhecida).then((r) => {
      if (vivo) setPedacos(r);
    });
    return () => {
      vivo = false;
    };
  }, [valor, conhecida]);

  useEffect(
    () => () => {
      if (relogio.current) clearTimeout(relogio.current);
    },
    [],
  );

  function copiar(): void {
    void navigator.clipboard?.writeText(valor);
    setCopiado(true);
    // Sem toast. Toast para uma cópia de código é excesso: a confirmação
    // pertence ao botão que foi clicado.
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = setTimeout(() => setCopiado(false), COPIADO_MS);
  }

  return (
    <div className={styles.bloco} data-colapsado={comprido && !aberto}>
      <div className={styles.blocoBarra}>
        <span className={styles.blocoLingua}>{lingua ?? 'texto'}</span>
        <button type="button" className={styles.blocoCopiar} onClick={copiar}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      <pre className={styles.blocoCodigo}>
        <code>
          {pedacos
            ? pedacos.map((linha, i) => (
                <Fragment key={i}>
                  {linha.map((p, j) => (
                    <span key={j} style={p.cor ? { color: p.cor } : undefined}>
                      {p.texto}
                    </span>
                  ))}
                  {'\n'}
                </Fragment>
              ))
            : valor}
        </code>
      </pre>

      {comprido && !aberto ? (
        <button type="button" className={styles.mostrarTudo} onClick={() => setAberto(true)}>
          Mostrar tudo · {linhas.length} linhas
        </button>
      ) : null}
    </div>
  );
}
