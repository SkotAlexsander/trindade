import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { Expandir, Monitor, X } from '../../components/icones';
import { colorFromId, ensureContrast } from '../../lib/contraste';
import type { Apontamento, Participante, QualidadeDoEspectador } from './sala';
import styles from './grade.module.css';

/**
 * A transmissão em primeiro plano.
 *
 * Aqui moram as quatro coisas que fazem assistir a uma tela alheia funcionar:
 * tela cheia, zoom, janela do sistema e o apontador. Ver
 * design/12-compartilhamento-de-tela.md.
 */

const QUALIDADES: { id: QualidadeDoEspectador; nome: string; nota: string }[] = [
  { id: 'auto', nome: 'Automática', nota: 'segue o tamanho na tela' },
  { id: 'fonte', nome: 'Fonte', nota: 'o que a outra pessoa envia' },
  { id: '720p', nome: '720p', nota: 'economizar dados' },
];

const ZOOM_MAXIMO = 3;

/**
 * `Document Picture-in-Picture` existe no Chrome e no Edge. Onde não existe,
 * cai para o PiP do próprio elemento de vídeo — funciona, só é mais simples.
 * Detecção por capacidade, nunca por versão.
 */
function janelaDoSistema(): 'documento' | 'video' | 'nenhuma' {
  if (typeof window === 'undefined') return 'nenhuma';
  if ('documentPictureInPicture' in window) return 'documento';
  if (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document) return 'video';
  return 'nenhuma';
}

interface ComPiP {
  requestWindow(opcoes: { width: number; height: number }): Promise<Window>;
}

export function TelaEmFoco({
  participante,
  nome,
  qualidade,
  onQualidade,
  onFechar,
  apontamentos,
  onApontar,
}: {
  participante: Participante;
  nome: string;
  qualidade: QualidadeDoEspectador;
  onQualidade: (q: QualidadeDoEspectador) => void;
  onFechar: () => void;
  /** Quem apontou para esta tela — só aparece na tela de quem a transmite. */
  apontamentos: Apontamento[];
  onApontar: (alvo: string, x: number, y: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ escala: 1, x: 0, y: 0 });
  const [cheia, setCheia] = useState(false);
  const [naJanela, setNaJanela] = useState(false);
  // O valor no instante do gesto, sem reassinar os ouvintes a cada pixel.
  const zoomAtual = useRef(zoom);
  zoomAtual.current = zoom;

  const trilha = participante.tela;
  const suporte = janelaDoSistema();

  useEffect(() => {
    const alvo = video.current;
    if (!trilha || !alvo) return;
    trilha.attach(alvo);
    return () => {
      trilha.detach(alvo);
    };
  }, [trilha]);

  // O estado de tela cheia é do navegador, não nosso: sair pelo `Esc` tem de
  // devolver o botão ao lugar certo, e só o evento conta isso.
  useEffect(() => {
    const ouvir = () => setCheia(document.fullscreenElement === palco.current);
    document.addEventListener('fullscreenchange', ouvir);
    return () => document.removeEventListener('fullscreenchange', ouvir);
  }, []);

  const alternarCheia = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void palco.current?.requestFullscreen().catch(() => undefined);
  }, []);

  /**
   * Zoom centrado no cursor: a rolagem aproxima o ponto onde o mouse está, e
   * não o meio da tela. Sem isso, ler uma fonte pequena vira uma perseguição.
   */
  const aoRolar = useCallback((evento: React.WheelEvent) => {
    // O palco não rola nada, então a roda aqui só pode querer dizer zoom. O
    // documento fala em tela cheia; exigir isso esconderia o recurso de quem
    // nunca entra em tela cheia, que é a maioria.
    evento.preventDefault();
    const caixa = evento.currentTarget.getBoundingClientRect();
    const relX = (evento.clientX - caixa.left) / caixa.width - 0.5;
    const relY = (evento.clientY - caixa.top) / caixa.height - 0.5;

    setZoom((z) => {
      const escala = Math.min(ZOOM_MAXIMO, Math.max(1, z.escala - evento.deltaY / 500));
      if (escala === 1) return { escala: 1, x: 0, y: 0 };
      const fator = escala - z.escala;
      return {
        escala,
        // Limitado à borda: a imagem não pode ser arrastada para fora do quadro
        // e deixar faixa preta onde havia tela.
        ...limitar(z.x - relX * caixa.width * fator, z.y - relY * caixa.height * fator, escala, caixa),
      };
    });
  }, []);

  const arrastar = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    // `Alt` é do apontador; e sem zoom não há o que arrastar.
    if (evento.altKey || zoomAtual.current.escala <= 1) return;

    const alvo = evento.currentTarget;
    const caixa = alvo.getBoundingClientRect();
    const inicio = { x: evento.clientX, y: evento.clientY };
    const base = { x: zoomAtual.current.x, y: zoomAtual.current.y };
    alvo.setPointerCapture(evento.pointerId);

    const mover = (e: PointerEvent) => {
      setZoom((z) => ({
        escala: z.escala,
        ...limitar(base.x + (e.clientX - inicio.x), base.y + (e.clientY - inicio.y), z.escala, caixa),
      }));
    };
    const soltar = () => {
      alvo.removeEventListener('pointermove', mover);
      alvo.removeEventListener('pointerup', soltar);
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', soltar);
  }, []);

  /** `Alt` + clique manda a posição relativa para quem transmite. */
  const aoClicar = useCallback(
    (evento: React.MouseEvent<HTMLDivElement>) => {
      if (!evento.altKey || participante.eu) return;
      const caixa = evento.currentTarget.getBoundingClientRect();
      onApontar(
        participante.identity,
        (evento.clientX - caixa.left) / caixa.width,
        (evento.clientY - caixa.top) / caixa.height,
      );
    },
    [onApontar, participante.eu, participante.identity],
  );

  /**
   * A janela do sistema: a transmissão numa janela sempre à frente, para
   * assistir enquanto se trabalha em outra coisa — o uso mais comum numa
   * equipe pequena.
   */
  const abrirNaJanela = useCallback(async () => {
    const elemento = video.current;
    if (!elemento) return;

    if (suporte === 'documento') {
      const pip = (window as unknown as { documentPictureInPicture: ComPiP })
        .documentPictureInPicture;
      const janela = await pip.requestWindow({ width: 480, height: 270 });
      const corpo = janela.document.body;
      corpo.style.margin = '0';
      corpo.style.background = '#000';
      const clone = janela.document.createElement('video');
      clone.autoplay = true;
      clone.muted = true;
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.style.objectFit = 'contain';
      corpo.appendChild(clone);
      trilha?.attach(clone);
      setNaJanela(true);
      janela.addEventListener('pagehide', () => {
        trilha?.detach(clone);
        setNaJanela(false);
      });
      return;
    }

    if (suporte === 'video') {
      await elemento.requestPictureInPicture?.();
      setNaJanela(true);
      elemento.addEventListener('leavepictureinpicture', () => setNaJanela(false), { once: true });
    }
  }, [suporte, trilha]);

  return (
    <div className={styles.foco}>
      <div
        ref={palco}
        className={styles.palco}
        data-cheia={cheia}
        onWheel={aoRolar}
        onPointerDown={arrastar}
        onClick={aoClicar}
        onDoubleClick={() => (zoom.escala > 1 ? setZoom({ escala: 1, x: 0, y: 0 }) : alternarCheia())}
      >
        <video
          ref={video}
          className={styles.telaCheia}
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.escala})`,
          }}
          autoPlay
          playsInline
          muted
        />

        {/* O ponto de quem apontou, na cor de quem apontou. Dois segundos. */}
        {apontamentos.map((a) => (
          <span
            key={a.de}
            className={styles.apontador}
            style={{
              left: `${a.x * 100}%`,
              top: `${a.y * 100}%`,
              borderColor: ensureContrast(colorFromId(a.de), '#000000'),
            }}
            aria-hidden="true"
          />
        ))}

        {zoom.escala > 1 ? (
          <span className={styles.zoom}>{zoom.escala.toFixed(1)}× · duplo clique volta</span>
        ) : null}

        {/* Em tela cheia a barra de baixo não existe — ela ficou fora do
            elemento que foi para a tela cheia. Sem este botão, a única saída
            seria o `Esc`, e "a única saída é uma tecla" não é saída. */}
        {cheia ? (
          <button
            type="button"
            className={styles.sairDaCheia}
            aria-label="Sair da tela cheia"
            onClick={alternarCheia}
          >
            <X size={16} /> Sair da tela cheia
          </button>
        ) : null}
      </div>

      <div className={styles.barraDaTela}>
        <span className={styles.deQuem}>
          <Monitor size={14} /> {participante.eu ? 'Sua tela' : `Tela de ${nome}`}
        </span>

        {/* A escolha é de quem assiste, e vale só para ele: quem transmite não
            sabe nem se importa. É o simulcast que torna isso possível. */}
        {participante.eu ? null : (
          <label className={styles.qualidade}>
            <span className="visually-hidden">Qualidade</span>
            <select
              value={qualidade}
              onChange={(e) => onQualidade(e.target.value as QualidadeDoEspectador)}
            >
              {QUALIDADES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nome} — {q.nota}
                </option>
              ))}
            </select>
          </label>
        )}

        <Tooltip label="Tela cheia (ou duplo clique)">
          <button
            type="button"
            className={styles.acaoDaTela}
            aria-label="Tela cheia"
            onClick={alternarCheia}
          >
            <Expandir size={14} />
          </button>
        </Tooltip>

        {/* Desabilitado **com o motivo**, nunca escondido. */}
        <Tooltip
          label={
            suporte === 'nenhuma'
              ? 'Este navegador não abre a transmissão numa janela à parte.'
              : 'Janela flutuante do sistema'
          }
        >
          <button
            type="button"
            className={styles.acaoDaTela}
            aria-label="Abrir numa janela do sistema"
            disabled={suporte === 'nenhuma' || naJanela}
            onClick={() => void abrirNaJanela()}
          >
            <Monitor size={14} />
          </button>
        </Tooltip>

        <button type="button" className={styles.fechar} onClick={onFechar}>
          <X size={14} /> Voltar à grade
        </button>
      </div>
    </div>
  );
}

/**
 * Prende a imagem ampliada dentro do quadro.
 *
 * Sem isto, arrastar leva a tela para longe e sobra fundo preto onde deveria
 * haver imagem — o zoom deixa de ser leitura e vira briga com o mouse.
 */
function limitar(x: number, y: number, escala: number, caixa: DOMRect): { x: number; y: number } {
  const folgaX = (caixa.width * (escala - 1)) / 2;
  const folgaY = (caixa.height * (escala - 1)) / 2;
  return {
    x: Math.min(folgaX, Math.max(-folgaX, x)),
    y: Math.min(folgaY, Math.max(-folgaY, y)),
  };
}
