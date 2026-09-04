import { useCallback, useEffect, useMemo, useState } from 'react';
import { decode as decodeBlurhash } from 'blurhash';
import type { Attachment } from '@trindade/shared';
import { IconButton } from '../../components';
import { Arquivo, ChevronLeft, ChevronRight, Download, X } from '../../components/icones';
import { tamanhoLegivel } from './useAnexos';
import styles from './anexos.module.css';

/**
 * Anexos de uma mensagem.
 *
 * Imagem em grade, arquivo em linha, e a lightbox para ver de perto. Ver
 * design/04-mensagens.md, "Anexo".
 */

const LARGURA_MAXIMA = 400;
const ALTURA_MAXIMA = 300;

/** A mancha de cor no lugar da imagem enquanto ela não chega. */
const desenhados = new Map<string, string>();

function pintarBlurhash(hash: string): string | null {
  const pronto = desenhados.get(hash);
  if (pronto !== undefined) return pronto;
  try {
    const pixels = decodeBlurhash(hash, 32, 32);
    const tela = document.createElement('canvas');
    tela.width = 32;
    tela.height = 32;
    const ctx = tela.getContext('2d');
    if (!ctx) return null;
    const imagem = ctx.createImageData(32, 32);
    imagem.data.set(pixels);
    ctx.putImageData(imagem, 0, 0);
    const url = tela.toDataURL();
    desenhados.set(hash, url);
    return url;
  } catch {
    return null;
  }
}

/** O espaço que a imagem vai ocupar, calculado antes de ela carregar. */
function caixa(anexo: Attachment): { width: number; height: number } {
  const w = anexo.width ?? LARGURA_MAXIMA;
  const h = anexo.height ?? ALTURA_MAXIMA;
  const escala = Math.min(LARGURA_MAXIMA / w, ALTURA_MAXIMA / h, 1);
  return { width: Math.round(w * escala), height: Math.round(h * escala) };
}

export interface AnexosProps {
  anexos: readonly Attachment[];
}

export function Anexos({ anexos }: AnexosProps) {
  const imagens = useMemo(() => anexos.filter((a) => a.contentType.startsWith('image/')), [anexos]);
  const arquivos = useMemo(
    () => anexos.filter((a) => !a.contentType.startsWith('image/')),
    [anexos],
  );
  const [aberta, setAberta] = useState<number | null>(null);

  if (anexos.length === 0) return null;

  // Acima de quatro, as quatro primeiras e um "+N" na última: a grade cresceria
  // até empurrar a conversa inteira para fora da tela.
  const visiveis = imagens.slice(0, 4);
  const sobram = imagens.length - visiveis.length;

  return (
    <>
      {visiveis.length > 0 ? (
        <div className={styles.grade} data-quantas={Math.min(visiveis.length, 4)}>
          {visiveis.map((anexo, i) => {
            const { width, height } = caixa(anexo);
            const mancha = anexo.blurhash ? pintarBlurhash(anexo.blurhash) : null;
            const ultima = i === visiveis.length - 1 && sobram > 0;
            return (
              <button
                key={anexo.id}
                type="button"
                className={styles.imagemBotao}
                onClick={() => setAberta(i)}
                aria-label={`Abrir ${anexo.filename}`}
                // As dimensões vêm do servidor e são aplicadas antes do
                // carregamento: sem elas a conversa pula para baixo quando cada
                // imagem chega, e quem está lendo perde a linha.
                style={
                  imagens.length === 1
                    ? { width, height, ...(mancha ? { backgroundImage: `url(${mancha})` } : {}) }
                    : mancha
                      ? { backgroundImage: `url(${mancha})` }
                      : undefined
                }
              >
                <img
                  src={anexo.url}
                  alt={anexo.filename}
                  loading="lazy"
                  decoding="async"
                  {...(anexo.width && anexo.height
                    ? { width: anexo.width, height: anexo.height }
                    : {})}
                />
                {ultima ? <span className={styles.mais}>+{sobram}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {arquivos.map((anexo) => (
        <a
          key={anexo.id}
          className={styles.arquivo}
          href={anexo.url}
          // O servidor manda `Content-Disposition: attachment` em tudo que não
          // é imagem re-encodada; o `download` aqui só repete a intenção.
          download={anexo.filename}
        >
          <span className={styles.arquivoIcone}>
            <Arquivo size={20} />
          </span>
          <span className={styles.arquivoTexto}>
            <span className={styles.arquivoNome}>{anexo.filename}</span>
            <span className={styles.arquivoTamanho}>{tamanhoLegivel(anexo.byteSize)}</span>
          </span>
          <span className={styles.arquivoBaixar} aria-hidden="true">
            <Download size={18} />
          </span>
        </a>
      ))}

      {aberta !== null ? (
        <Lightbox imagens={imagens} inicial={aberta} onFechar={() => setAberta(null)} />
      ) : null}
    </>
  );
}

function Lightbox({
  imagens,
  inicial,
  onFechar,
}: {
  imagens: readonly Attachment[];
  inicial: number;
  onFechar: () => void;
}) {
  const [i, setI] = useState(inicial);
  const atual = imagens[i];

  const andar = useCallback(
    (passo: number) => setI((n) => (n + passo + imagens.length) % imagens.length),
    [imagens.length],
  );

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowRight') andar(1);
      if (e.key === 'ArrowLeft') andar(-1);
    }
    document.addEventListener('keydown', aoTeclar);
    // A rolagem de fundo trava enquanto a lightbox está aberta: rolar a
    // conversa atrás de uma foto em tela cheia não faz sentido nenhum.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [andar, onFechar]);

  if (!atual) return null;

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={atual.filename}
      onClick={onFechar}
    >
      <div className={styles.lightboxTopo} onClick={(e) => e.stopPropagation()}>
        <span className={styles.lightboxNome}>{atual.filename}</span>
        {imagens.length > 1 ? (
          <span className={styles.lightboxContagem}>
            {i + 1} de {imagens.length}
          </span>
        ) : null}
        <a
          className={styles.lightboxBaixar}
          href={atual.url}
          download={atual.filename}
          aria-label="Baixar"
        >
          <Download size={18} />
        </a>
        <IconButton label="Fechar" size="sm" onClick={onFechar}>
          <X size={18} />
        </IconButton>
      </div>

      {imagens.length > 1 ? (
        <button
          type="button"
          className={styles.seta}
          data-lado="esquerda"
          aria-label="Anterior"
          onClick={(e) => {
            e.stopPropagation();
            andar(-1);
          }}
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}

      {/* O clique na imagem não fecha: quem quer ampliar não quer sair. */}
      <img
        className={styles.lightboxImagem}
        src={atual.url}
        alt={atual.filename}
        onClick={(e) => e.stopPropagation()}
      />

      {imagens.length > 1 ? (
        <button
          type="button"
          className={styles.seta}
          data-lado="direita"
          aria-label="Próxima"
          onClick={(e) => {
            e.stopPropagation();
            andar(1);
          }}
        >
          <ChevronRight size={24} />
        </button>
      ) : null}
    </div>
  );
}
