import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components';
import styles from './perfil.module.css';

/**
 * O recortador quadrado.
 *
 * Sempre quadrado, com zoom e arrasto: a pessoa decide o enquadramento em vez
 * de descobrir depois que a interface cortou a cabeça dela. Ver
 * design/05-perfil-e-cargos.md, "Trocar a foto".
 *
 * O recorte acontece **aqui**, no navegador, e o servidor re-encoda de novo
 * por cima. Não é desperdício: o que sai daqui é o enquadramento escolhido, e
 * o que o servidor faz é a garantia de que nenhum byte original — nem o EXIF
 * com as coordenadas de GPS — chega ao disco. As duas coisas resolvem
 * problemas diferentes.
 */

/** O lado do quadro na tela. */
const VIEWPORT = 264;
/** O lado do arquivo que sai. O servidor reduz para 256; sobra folga. */
const SAIDA = 512;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

interface Ponto {
  x: number;
  y: number;
}

export interface RecortadorProps {
  arquivo: File;
  onCancelar: () => void;
  onPronto: (recorte: Blob, previa: string) => void;
}

export function Recortador({ arquivo, onCancelar, onPronto }: RecortadorProps) {
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Ponto>({ x: 0, y: 0 });
  const arrasto = useRef<{ de: Ponto; posInicial: Ponto } | null>(null);
  const tela = useRef<HTMLCanvasElement>(null);

  // O `blob:` fica preso na memória até alguém devolvê-lo, e trocar de foto
  // três vezes sem isso vaza as três.
  useEffect(() => {
    // `descartado` existe por causa do StrictMode: em desenvolvimento o efeito
    // roda, é limpo e roda de novo, e a limpeza revoga o `blob:` enquanto a
    // primeira imagem ainda carrega. Sem a guarda, o `onerror` dessa primeira
    // acendia "não consegui abrir essa imagem" por cima da segunda, que tinha
    // carregado perfeitamente.
    let descartado = false;
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      if (descartado) return;
      setErro(null);
      setImagem(img);
    };
    img.onerror = () => {
      if (descartado) return;
      setErro('não consegui abrir essa imagem');
    };
    img.src = url;
    return () => {
      descartado = true;
      URL.revokeObjectURL(url);
    };
  }, [arquivo]);

  /** A escala mínima que ainda cobre o quadro inteiro. */
  const escalaBase = imagem ? VIEWPORT / Math.min(imagem.width, imagem.height) : 1;

  /**
   * Prende a imagem ao quadro.
   *
   * Sem isto, arrastar até o fim mostra o vazio atrás da foto e o recorte sai
   * com uma faixa transparente — que o servidor achataria em preto.
   */
  const limitar = useCallback(
    (p: Ponto, z: number): Ponto => {
      if (!imagem) return p;
      const larg = imagem.width * escalaBase * z;
      const alt = imagem.height * escalaBase * z;
      const folgaX = Math.max(0, (larg - VIEWPORT) / 2);
      const folgaY = Math.max(0, (alt - VIEWPORT) / 2);
      return {
        x: Math.min(folgaX, Math.max(-folgaX, p.x)),
        y: Math.min(folgaY, Math.max(-folgaY, p.y)),
      };
    },
    [imagem, escalaBase],
  );

  useEffect(() => {
    setPos((p) => limitar(p, zoom));
  }, [zoom, limitar]);

  // --- desenho -------------------------------------------------------------
  useEffect(() => {
    const canvas = tela.current;
    if (!canvas || !imagem) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = VIEWPORT * dpr;
    canvas.height = VIEWPORT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEWPORT, VIEWPORT);

    const larg = imagem.width * escalaBase * zoom;
    const alt = imagem.height * escalaBase * zoom;
    ctx.drawImage(
      imagem,
      VIEWPORT / 2 - larg / 2 + pos.x,
      VIEWPORT / 2 - alt / 2 + pos.y,
      larg,
      alt,
    );
  }, [imagem, zoom, pos, escalaBase]);

  // --- arrasto -------------------------------------------------------------
  function aoPressionar(e: React.PointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { de: { x: e.clientX, y: e.clientY }, posInicial: pos };
  }

  function aoMover(e: React.PointerEvent<HTMLCanvasElement>): void {
    const estado = arrasto.current;
    if (!estado) return;
    setPos(
      limitar(
        {
          x: estado.posInicial.x + (e.clientX - estado.de.x),
          y: estado.posInicial.y + (e.clientY - estado.de.y),
        },
        zoom,
      ),
    );
  }

  function aoSoltar(e: React.PointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.releasePointerCapture(e.pointerId);
    arrasto.current = null;
  }

  /** Recorta o que está à vista e devolve o arquivo. */
  function confirmar(): void {
    const origem = tela.current;
    if (!origem || !imagem) return;

    const saida = document.createElement('canvas');
    saida.width = SAIDA;
    saida.height = SAIDA;
    const ctx = saida.getContext('2d');
    if (!ctx) return;

    const escala = SAIDA / VIEWPORT;
    const larg = imagem.width * escalaBase * zoom * escala;
    const alt = imagem.height * escalaBase * zoom * escala;
    ctx.drawImage(
      imagem,
      SAIDA / 2 - larg / 2 + pos.x * escala,
      SAIDA / 2 - alt / 2 + pos.y * escala,
      larg,
      alt,
    );

    saida.toBlob(
      (blob) => {
        if (!blob) {
          setErro('não consegui recortar essa imagem');
          return;
        }
        onPronto(blob, saida.toDataURL('image/webp'));
      },
      'image/webp',
      0.92,
    );
  }

  return (
    <div className={styles.recortador}>
      {erro ? <p className={styles.erroFoto}>{erro}</p> : null}

      <div className={styles.quadro} style={{ width: VIEWPORT, height: VIEWPORT }}>
        <canvas
          ref={tela}
          className={styles.tela}
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={aoPressionar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          aria-label="Arraste para enquadrar"
        />
        {/* O círculo é só uma máscara por cima: o recorte que sai é o quadrado
            inteiro, porque o avatar é redondo só na exibição, e um dia pode
            não ser. */}
        <div className={styles.mascara} aria-hidden="true" />
      </div>

      <label className={styles.zoom}>
        <span className={styles.zoomRotulo}>Aproximar</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Aproximar"
        />
      </label>

      <div className={styles.acoesFoto}>
        <Button variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button size="sm" onClick={confirmar} disabled={!imagem}>
          Usar esta foto
        </Button>
      </div>
    </div>
  );
}
