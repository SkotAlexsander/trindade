import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AVISO_DE_ELEMENTOS, ELEMENTOS_POR_QUADRO, type User } from '@trindade/shared';
import { Avatar, IconButton, Menu, MenuItem, Tooltip } from '../../components';
import { ChevronLeft } from '../../components/icones';
import { colorFromId, ensureContrast } from '../../lib/contraste';
import { lerToken } from '../../lib/tokens';
import { useAuth } from '../auth/store';
import { useQuadros, mandarMiniatura, useArquivarQuadro, useRenomearQuadro } from './queries';
import { abrirQuadro, type ProvedorDoQuadro } from './provedor';
import { useQuadroAberto } from './store';
import styles from './quadros.module.css';

/**
 * O quadro em tela cheia, sobre a conversa.
 *
 * Nunca dentro dos 320px do painel: desenhar precisa de espaço, e um canvas
 * numa coluna estreita é um canvas que ninguém usa. Ver design/11-quadro.md.
 *
 * O canvas em si vem de um pedaço carregado sob demanda — quem nunca abre um
 * quadro não baixa o Excalidraw.
 */

const TelaDoQuadro = lazy(() =>
  import('./TelaDoQuadro').then((m) => ({ default: m.TelaDoQuadro })),
);

export function Quadro({ pessoas }: { pessoas: readonly User[] }) {
  const aberto = useQuadroAberto((s) => s.aberto);
  if (!aberto) return null;
  // A `key` garante que trocar de quadro **refaz** tudo: provedor, canvas e
  // contadores de um quadro não valem para o outro.
  return <QuadroAberto key={aberto.boardId} {...aberto} pessoas={pessoas} />;
}

function QuadroAberto({
  boardId,
  channelId,
  pessoas,
}: {
  boardId: string;
  channelId: string;
  pessoas: readonly User[];
}) {
  const eu = useAuth((s) => s.user);
  const fechar = useQuadroAberto((s) => s.fechar);
  const { data: quadros } = useQuadros(channelId);
  const quadro = quadros?.find((q) => q.id === boardId);

  const renomear = useRenomearQuadro();
  const arquivar = useArquivarQuadro(channelId);

  const [provedor, setProvedor] = useState<ProvedorDoQuadro | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [elementos, setElementos] = useState(0);
  const [presentes, setPresentes] = useState<string[]>([]);

  const cor = useMemo(
    () => (eu ? ensureContrast(colorFromId(eu.id), lerToken('--bg-app', '#0b1120')) : '#22d3ee'),
    [eu],
  );

  /* O provedor nasce e morre **dentro do efeito**, como o das notas: no
     StrictMode o efeito roda, é limpo e roda de novo, e criar na renderização
     deixaria a limpeza matando o provedor que a renderização criou. */
  useEffect(() => {
    if (!eu) return;

    const conexao = abrirQuadro({
      boardId,
      eu: { id: eu.id, nome: eu.displayName, cor },
      aoReceberEstado: ({ podeEditar: permitido, elementos: quantos }) => {
        setPodeEditar(permitido);
        setElementos(quantos);
        setPronto(true);
      },
      aoContar: setElementos,
      aoMudarPresenca: setPresentes,
    });
    setProvedor(conexao);

    return () => {
      conexao.destruir();
      setProvedor(null);
      setPronto(false);
      setPresentes([]);
    };
  }, [boardId, eu, cor]);

  /**
   * A miniatura, ao sair.
   *
   * Sai do navegador porque quem sabe desenhar a cena é quem a está
   * desenhando. E sai do **último estado conhecido**, guardado a cada
   * alteração: no instante do desmonte o Excalidraw já esvaziou a própria
   * cena, e perguntar a ele ali devolve zero elementos e uma miniatura em
   * branco — foi exatamente o que aconteceu na primeira versão.
   */
  const cenaRef = useRef<{ elementos: readonly unknown[]; arquivos: unknown }>({
    elementos: [],
    arquivos: {},
  });
  const podeEditarRef = useRef(podeEditar);
  podeEditarRef.current = podeEditar;

  const aoMudarCena = useCallback((cena: { elementos: readonly unknown[]; arquivos: unknown }) => {
    cenaRef.current = cena;
  }, []);

  useEffect(() => {
    return () => {
      const { elementos: cena, arquivos } = cenaRef.current;
      cenaRef.current = { elementos: [], arquivos: {} };
      if (!podeEditarRef.current || cena.length === 0) return;

      // Assíncrono e sem `await`: o desmonte não espera ninguém, e a miniatura
      // é enfeite da lista. Falhar aqui não pode parecer desenho perdido.
      void (async () => {
        try {
          const { exportToBlob } = await import('@excalidraw/excalidraw');
          const png = await exportToBlob({
            elements: cena as never,
            appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
            files: (arquivos ?? {}) as never,
            mimeType: 'image/png',
            maxWidthOrHeight: 800,
          });
          await mandarMiniatura(boardId, png);
        } catch {
          /* sem miniatura: o cartão fica com o nome, que é o que importa. */
        }
      })();
    };
  }, [boardId]);

  const outros = presentes.filter((id) => id !== eu?.id);
  const cheio = elementos >= ELEMENTOS_POR_QUADRO;
  const perto = !cheio && elementos >= AVISO_DE_ELEMENTOS;

  return (
    <div
      className={styles.telaCheia}
      role="dialog"
      aria-label={`Quadro ${quadro?.name ?? ''}`}
      /* Lido pelo roteiro de e2e: a contagem é do servidor, e é ela que decide
         o teto. Sem um lugar onde ela apareça, "duas pessoas desenhando ao
         mesmo tempo" só se verifica olhando dois monitores. */
      data-elementos={elementos}
    >
      <header className={styles.barra}>
        <IconButton label="Voltar para a conversa" size="sm" onClick={fechar}>
          <ChevronLeft size={18} />
        </IconButton>
        <h2 className={styles.nome}>{quadro?.name ?? 'Quadro'}</h2>

        {/* Quem está com este quadro aberto agora. */}
        <span className={styles.avatares}>
          {outros.map((id) => {
            const quem = pessoas.find((p) => p.id === id);
            return (
              <Tooltip key={id} label={quem?.displayName ?? 'Alguém'}>
                <span>
                  <Avatar
                    id={id}
                    name={quem?.displayName ?? 'Alguém'}
                    src={quem?.avatarUrl}
                    size="xs"
                  />
                </span>
              </Tooltip>
            );
          })}
        </span>

        {podeEditar ? (
          <Menu
            label="Mais"
            placement="bottom-end"
            trigger={
              <IconButton label="Mais ações do quadro" title="Mais ações" size="sm">
                <span aria-hidden="true">···</span>
              </IconButton>
            }
          >
            <MenuItem
              onSelect={() => {
                const novo = prompt('Nome do quadro', quadro?.name ?? '');
                if (novo === null || novo.trim() === '') return;
                renomear.mutate({ id: boardId, name: novo.trim() });
              }}
            >
              Renomear
            </MenuItem>
            {/* Arquivar, não apagar: um quadro é o desenho de uma conversa que
                aconteceu, e um clique errado não pode acabar com ela. */}
            <MenuItem
              onSelect={() => {
                if (!confirm('Arquivar este quadro? Ele sai da lista e o desenho continua.')) {
                  return;
                }
                arquivar.mutate(boardId, { onSuccess: fechar });
              }}
            >
              Arquivar
            </MenuItem>
          </Menu>
        ) : null}
      </header>

      {perto || cheio ? (
        <p className={styles.aviso} data-cheio={cheio} role="status">
          {cheio
            ? `Este quadro chegou aos ${ELEMENTOS_POR_QUADRO} elementos. Dá para mover e apagar o que já está aqui, mas não desenhar mais — um quadro deste tamanho já são dois.`
            : `${elementos} de ${ELEMENTOS_POR_QUADRO} elementos. Perto do limite: talvez seja hora de começar outro quadro.`}
        </p>
      ) : null}

      {!podeEditar && pronto ? (
        <p className={styles.somenteLeitura}>Você pode ver este quadro, mas não desenhar nele.</p>
      ) : null}

      <div className={styles.palco}>
        {pronto && provedor ? (
          <Suspense fallback={<p className={styles.carregando}>Abrindo o quadro…</p>}>
            <TelaDoQuadro
              key={provedor.id}
              provedor={provedor}
              podeEditar={podeEditar}
              cheio={cheio}
              pessoas={pessoas}
              aoMudarCena={aoMudarCena}
            />
          </Suspense>
        ) : (
          <p className={styles.carregando}>Abrindo o quadro…</p>
        )}
      </div>
    </div>
  );
}
