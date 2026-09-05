import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LinkPreview } from '@trindade/shared';
import { api } from '../../lib/http';
import { Video } from './Video';
import styles from './anexos.module.css';

/**
 * O cartão de um link.
 *
 * Quem busca é o servidor — inclusive a miniatura, que chega do nosso domínio.
 * Se o navegador de quem lê baixasse a imagem do site de origem, abrir a
 * conversa entregaria o IP de todos os leitores a quem mandou o link. É o
 * mesmo princípio de privacidade das chamadas, aplicado ao texto. Ver
 * design/04-mensagens.md, "Link".
 */

export function PreviaDeLink({ url }: { url: string }) {
  const [semImagem, setSemImagem] = useState(false);

  const { data } = useQuery({
    queryKey: ['link-preview', url],
    queryFn: () =>
      api<{ preview: LinkPreview | null }>(`/link-preview?url=${encodeURIComponent(url)}`),
    // Seis horas, os mesmos do cache do servidor. Um cartão que se refaz
    // sozinho a cada foco de janela pisca sem motivo.
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  const previa = data?.preview;
  // Sem cartão não há espaço reservado: um esqueleto que às vezes vira nada
  // faz a conversa pular. O cartão entra quando existe, e só então.
  if (!previa) return null;

  /* Vídeo tem cartão próprio: um link que dá para assistir aqui não deve
     parecer um link que abre outra aba. Ver `Video.tsx`. */
  if (previa.video) return <Video previa={previa} />;

  return (
    <a
      className={styles.previa}
      href={previa.url}
      target="_blank"
      rel="noreferrer noopener"
      data-com-imagem={Boolean(previa.thumbUrl) && !semImagem}
    >
      <span className={styles.previaTexto}>
        <span className={styles.previaSite}>{previa.siteName}</span>
        <span className={styles.previaTitulo}>{previa.title}</span>
        {previa.description ? (
          <span className={styles.previaDescricao}>{previa.description}</span>
        ) : null}
      </span>
      {previa.thumbUrl && !semImagem ? (
        <img
          className={styles.previaImagem}
          src={previa.thumbUrl}
          alt=""
          loading="lazy"
          // A miniatura mora no cache em memória do servidor: reiniciar a API
          // a derruba antes do cartão. Some a imagem, fica o cartão.
          onError={() => setSemImagem(true)}
        />
      ) : null}
    </a>
  );
}
