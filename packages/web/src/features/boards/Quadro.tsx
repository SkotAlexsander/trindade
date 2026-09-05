import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AVISO_DE_ELEMENTOS, ELEMENTOS_POR_QUADRO, type User } from '@trindade/shared';
import {
  Avatar,
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Tooltip,
  useToast,
} from '../../components';
import { ChevronLeft } from '../../components/icones';
import { colorFromId, ensureContrast } from '../../lib/contraste';
import { lerToken } from '../../lib/tokens';
import { useAuth } from '../auth/store';
import type { Attachment } from '@trindade/shared';
import { upload } from '../../lib/http';
import { useEnviarMensagem } from '../messages/useEnviar';
import { canal as canalComoAlvo } from '../messages/alvo';
import { useChannels } from '../channels/queries';
import {
  mandarMiniatura,
  useArquivarQuadro,
  useCriarQuadro,
  useQuadros,
  useRenomearQuadro,
} from './queries';
import { abrirQuadro, type ProvedorDoQuadro } from './provedor';
import { useQuadroAberto } from './store';
import { useApresentacoes } from './apresentacoes';
import * as ws from '../../lib/ws';
import { naChamada, useVoz } from '../voice/store';
import { useChamada } from '../voice/useChamada';
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
  imagemInicial,
  pessoas,
}: {
  boardId: string;
  channelId: string;
  imagemInicial?: { url: string; nome: string };
  pessoas: readonly User[];
}) {
  const eu = useAuth((s) => s.user);
  const fechar = useQuadroAberto((s) => s.fechar);
  const { data: quadros } = useQuadros(channelId);
  const quadro = quadros?.find((q) => q.id === boardId);

  const renomear = useRenomearQuadro();
  const arquivar = useArquivarQuadro(channelId);
  const criar = useCriarQuadro(channelId);
  const abrirOutro = useQuadroAberto((s) => s.abrir);
  const verLista = useQuadroAberto((s) => s.verLista);

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
  const cenaRef = useRef<{
    elementos: readonly unknown[];
    arquivos: unknown;
    selecionados: readonly string[];
  }>({ elementos: [], arquivos: {}, selecionados: [] });
  const podeEditarRef = useRef(podeEditar);
  podeEditarRef.current = podeEditar;

  const aoMudarCena = useCallback(
    (cena: {
      elementos: readonly unknown[];
      arquivos: unknown;
      selecionados: readonly string[];
    }) => {
      cenaRef.current = cena;
    },
    [],
  );

  useEffect(() => {
    return () => {
      const { elementos: cena, arquivos } = cenaRef.current;
      cenaRef.current = { elementos: [], arquivos: {}, selecionados: [] };
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

  /**
   * "Enviar no canal": o desenho vira anexo, com o link de volta.
   *
   * Manda **a seleção**, ou o quadro inteiro quando não há nada selecionado —
   * que é o que a pessoa quer dizer nos dois casos. Serve para "aqui está o
   * diagrama que discutimos" sem obrigar ninguém a abrir o quadro; o link fica
   * na mensagem para quem quiser entrar. Ver design/11-quadro.md.
   */
  const { show } = useToast();
  const { data: canais } = useChannels();
  const enviarMensagem = useEnviarMensagem();
  const [enviando, setEnviando] = useState(false);

  async function enviarNoCanal(): Promise<void> {
    const { elementos: cena, arquivos, selecionados } = cenaRef.current;
    const escolhidos = new Set(selecionados);
    const recorte =
      escolhidos.size > 0
        ? cena.filter((e) => escolhidos.has((e as { id: string }).id))
        : cena;

    if (recorte.length === 0) {
      show('Não há nada desenhado para enviar.', 'danger');
      return;
    }

    setEnviando(true);
    try {
      const { exportToBlob } = await import('@excalidraw/excalidraw');
      const png = await exportToBlob({
        elements: recorte as never,
        appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
        files: (arquivos ?? {}) as never,
        mimeType: 'image/png',
        maxWidthOrHeight: 1600,
      });

      const form = new FormData();
      form.append('file', png, `${quadro?.name ?? 'quadro'}.png`);
      const { attachments } = await upload<{ attachments: Attachment[] }>(
        `/channels/${channelId}/attachments`,
        form,
      );

      const slug = canais?.find((c) => c.id === channelId)?.slug;
      const link = slug ? `${location.origin}/c/${slug}?quadro=${boardId}` : '';

      enviarMensagem.enviar({
        alvo: canalComoAlvo(channelId),
        /* O nome vira o texto do link, e não uma URL crua ao lado dele: um
           endereço com uuid ocupa duas linhas, quebra no meio e não diz nada
           que o nome já não diga. É o mesmo formato da linha de sistema da
           apresentação, em `services/apresentacao.ts`. */
        content: link ? `Do quadro [${quadro?.name ?? 'quadro'}](${link})` : 'Do quadro',
        anexos: attachments,
      });
      show('Enviado no canal.');
      fechar();
    } catch {
      show('Não foi possível enviar no canal.', 'danger');
    } finally {
      setEnviando(false);
    }
  }

  const outros = presentes.filter((id) => id !== eu?.id);
  const cheio = elementos >= ELEMENTOS_POR_QUADRO;
  const perto = !cheio && elementos >= AVISO_DE_ELEMENTOS;

  // --- apresentação ---------------------------------------------------------
  const apresentacao = useApresentacoes((s) => s.porQuadro[boardId]);
  const euApresento = apresentacao?.userId === eu?.id;
  const souPlateia = Boolean(apresentacao) && !euApresento;
  const apresentadora = pessoas.find((p) => p.id === apresentacao?.userId);

  /* Seguir é o padrão, e cada espectador solta por conta própria: soltar não
     interrompe ninguém. Volta a ser verdade quando **outra** apresentação
     começa — a de antes acabou, e a decisão de soltar era sobre aquela. */
  const [seguindo, setSeguindo] = useState(true);
  useEffect(() => {
    setSeguindo(true);
  }, [apresentacao?.startedAt]);

  /* Quem ganhou a caneta durante a apresentação. Vem da awareness de quem
     apresenta: é combinação de palco, não permissão — o servidor continua
     exigindo `MANAGE_NOTES` de quem manda um traço. */
  const [desenhistas, setDesenhistas] = useState<string[]>([]);
  const aoMudarDesenhistas = useCallback((lista: string[]) => setDesenhistas(lista), []);

  function alternarCaneta(userId: string): void {
    const proximo = desenhistas.includes(userId)
      ? desenhistas.filter((id) => id !== userId)
      : [...desenhistas, userId];
    setDesenhistas(proximo);
    provedor?.awareness.setLocalStateField('desenhistas', proximo);
  }

  function apresentar(ligar: boolean): void {
    ws.enviar({ op: 'BOARD_PRESENT', d: { boardId, apresentando: ligar } });
    if (!ligar) {
      setDesenhistas([]);
      provedor?.awareness.setLocalStateField('desenhistas', []);
    }
  }

  /* "Se há chamada ativa no canal, sugerir entrar." Apresentação e chamada são
     independentes de propósito, mas apresentar em silêncio é quase sempre um
     esquecimento. */
  const vozes = useVoz((s) => s.estados);
  const meuCanalDeVoz = useVoz((s) => (s.fase === 'fora' ? null : s.channelId));
  const { entrar: entrarNaChamada } = useChamada();
  const chamadaAqui = naChamada(vozes, channelId).length > 0 && meuCanalDeVoz !== channelId;

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
      <header className={styles.barra} data-apresentando={Boolean(apresentacao)}>
        <IconButton label="Voltar para a conversa" size="sm" onClick={fechar}>
          <ChevronLeft size={18} />
        </IconButton>
        <h2 className={styles.nome}>{quadro?.name ?? 'Quadro'}</h2>

        {souPlateia ? (
          <Button
            size="sm"
            variant={seguindo ? 'ghost' : 'live'}
            onClick={() => setSeguindo((atual) => !atual)}
          >
            {seguindo
              ? `Seguindo ${apresentadora?.displayName.split(' ')[0] ?? 'a apresentação'}`
              : 'Voltar a seguir'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={euApresento ? 'live' : 'ghost'}
            onClick={() => apresentar(!euApresento)}
          >
            {euApresento ? 'Encerrar' : 'Apresentar'}
          </Button>
        )}

        {/* Quem está com este quadro aberto agora. */}
        <span className={styles.avatares}>
          {outros.map((id) => {
            const quem = pessoas.find((p) => p.id === id);
            const nome = quem?.displayName ?? 'Alguém';
            const comCaneta = desenhistas.includes(id);
            const avatar = <Avatar id={id} name={nome} src={quem?.avatarUrl} size="xs" />;

            /* Durante a **sua** apresentação, o avatar é o botão de dar a
               caneta: é onde a pessoa já está olhando quando quer passar a
               vez. Fora da apresentação, é só quem está junto. */
            if (!euApresento) {
              return (
                <Tooltip key={id} label={nome}>
                  <span>{avatar}</span>
                </Tooltip>
              );
            }

            const rotulo = comCaneta ? `Tirar a caneta de ${nome}` : `Dar a caneta a ${nome}`;
            return (
              <Tooltip key={id} label={rotulo}>
                <button
                  type="button"
                  className={styles.caneta}
                  aria-pressed={comCaneta}
                  aria-label={rotulo}
                  onClick={() => alternarCaneta(id)}
                >
                  {avatar}
                </button>
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
            {/* Primeiro item: é o gesto que atravessa a fronteira, e o que
                mais se usa depois de desenhar. */}
            <MenuItem disabled={enviando} onSelect={() => void enviarNoCanal()}>
              Enviar no canal
            </MenuItem>

            <MenuItem
              onSelect={() => {
                const novo = prompt('Nome do quadro', quadro?.name ?? '');
                if (novo === null || novo.trim() === '') return;
                renomear.mutate({ id: boardId, name: novo.trim() });
              }}
            >
              Renomear
            </MenuItem>
            {/* Um quadro por canal dá conta quase sempre; quem precisa de
                outro cria daqui, e a lista fica a um clique. */}
            <MenuItem
              onSelect={() => {
                const nome = prompt('Nome do quadro novo');
                if (nome === null || nome.trim() === '') return;
                criar.mutate(nome.trim(), {
                  onSuccess: ({ board }) => abrirOutro(board.id, channelId),
                  onError: () => show('Não foi possível criar o quadro.', 'danger'),
                });
              }}
            >
              Novo quadro
            </MenuItem>

            <MenuItem onSelect={verLista}>Outros quadros</MenuItem>

            <MenuSeparator />

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

      {euApresento && chamadaAqui ? (
        <p className={styles.sugestao} role="status">
          Há uma chamada acontecendo neste canal.
          <Button size="sm" variant="ghost" onClick={() => void entrarNaChamada(channelId)}>
            Entrar na chamada
          </Button>
        </p>
      ) : null}

      {souPlateia ? (
        <p className={styles.sugestao} data-apresentacao="true" role="status">
          {apresentadora?.displayName.split(' ')[0] ?? 'Alguém'} está apresentando.
          {desenhistas.includes(eu?.id ?? '')
            ? ' Você está com a caneta.'
            : ' Você pode apontar, e desenhar quando receber a caneta.'}
        </p>
      ) : null}

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
              boardId={boardId}
              /* Na plateia, desenhar depende da caneta. Não é permissão — o
                 servidor continua exigindo `MANAGE_NOTES` de quem manda um
                 traço — é a combinação de quem está conduzindo. */
              podeEditar={podeEditar && (!souPlateia || desenhistas.includes(eu?.id ?? ''))}
              cheio={cheio}
              pessoas={pessoas}
              aoMudarCena={aoMudarCena}
              imagemInicial={imagemInicial}
              apresentador={apresentacao?.userId ?? null}
              euApresento={euApresento}
              seguindo={seguindo}
              aoMudarDesenhistas={aoMudarDesenhistas}
            />
          </Suspense>
        ) : (
          <p className={styles.carregando}>Abrindo o quadro…</p>
        )}
      </div>
    </div>
  );
}
