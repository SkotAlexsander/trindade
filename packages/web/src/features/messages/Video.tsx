import { useState } from 'react';
import type { LinkPreview } from '@trindade/shared';
import { Play } from '../../components/icones';
import styles from './anexos.module.css';

/**
 * O vídeo, aqui dentro.
 *
 * **Nada do YouTube é carregado até alguém apertar o play.** O que aparece de
 * início é a nossa miniatura, servida do nosso domínio, buscada e re-encodada
 * pelo servidor como a de qualquer outro cartão de link — é o mesmo motivo de
 * a prévia ser buscada no servidor desde a fase 5: se o navegador de quem lê
 * fosse até o Google só por abrir a conversa, quem manda o link colheria o IP
 * de todo mundo que passou por ali, e a metade cuidadosa do trabalho não teria
 * servido para nada.
 *
 * Apertar o play é a permissão. A partir dali o quadro é do YouTube e o IP vai
 * junto — não há como pedir o vídeo sem pedir ao dono dele. O que dá para
 * fazer é que isso aconteça **por um gesto**, e não por rolar a conversa.
 *
 * `youtube-nocookie.com` em vez de `youtube.com`: o domínio sem cookie não
 * grava a visita no perfil de quem assiste. É o mesmo vídeo, no mesmo player.
 *
 * "Apenas o vídeo, não a navegação" — pedido do dono do projeto — vira os
 * parâmetros abaixo: sem vídeos relacionados de outros canais, sem anotações,
 * com a marca do player reduzida, e dentro da nossa moldura. Ver
 * design/04-mensagens.md, "Vídeo".
 */

export function Video({ previa }: { previa: LinkPreview }) {
  const [tocando, setTocando] = useState(false);
  const [semImagem, setSemImagem] = useState(false);
  const video = previa.video;
  if (!video) return null;

  const parametros = new URLSearchParams({
    autoplay: '1',
    // A navegação do YouTube fica de fora: sem sugestões de outros canais no
    // fim, sem anotações sobrepostas, com a marca reduzida.
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    // No celular, tocar dentro da caixa em vez de assumir a tela inteira.
    playsinline: '1',
  });
  if (video.startAt) parametros.set('start', String(video.startAt));

  if (tocando) {
    return (
      <div className={styles.video} data-tocando="true">
        <iframe
          className={styles.videoQuadro}
          src={`https://www.youtube-nocookie.com/embed/${video.id}?${parametros.toString()}`}
          title={previa.title}
          /* `fullscreen` porque a tela cheia é do vídeo, e negá-la seria
             mesquinho; o resto fica de fora. */
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          /*
           * `strict-origin-when-cross-origin`, e **não** `no-referrer`.
           *
           * Com `no-referrer` o player recusa: "Erro de configuração do player
           * de vídeo — Erro 153". O YouTube exige um referrer para validar de
           * onde o embed está sendo servido, e sem nenhum ele não toca. Foi o
           * que apareceu na primeira captura do roteiro.
           *
           * Esta política manda **só a origem** — `https://dominio/` —, nunca o
           * caminho. O YouTube fica sabendo que existe um embed no nosso
           * domínio, que é o que ele precisa saber, e não em qual conversa.
           */
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className={styles.video}>
      <button
        type="button"
        className={styles.videoCapa}
        onClick={() => setTocando(true)}
        aria-label={`Assistir aqui: ${previa.title}`}
      >
        {previa.thumbUrl && !semImagem ? (
          <img
            className={styles.videoImagem}
            src={previa.thumbUrl}
            alt=""
            loading="lazy"
            onError={() => setSemImagem(true)}
          />
        ) : null}
        <span className={styles.videoPlay} aria-hidden="true">
          <Play size={28} />
        </span>
        <span className={styles.videoLegenda}>
          <span className={styles.videoTitulo}>{previa.title}</span>
          <span className={styles.videoSite}>{previa.siteName}</span>
        </span>
      </button>

      {/* Dito uma vez, em letra pequena, e não num diálogo de consentimento:
          quem clicou já decidiu, e um aviso que interrompe seria teatro. */}
      <p className={styles.videoAviso}>
        Tocar carrega o player do YouTube. Até lá, nada sai daqui.{' '}
        <a href={previa.url} target="_blank" rel="noreferrer noopener">
          Abrir no site
        </a>
      </p>
    </div>
  );
}
