import { useEffect, useState } from 'react';

/**
 * Acompanha uma media query em JavaScript.
 *
 * Só para o que o CSS não resolve — aqui, fechar a gaveta ao trocar de canal.
 * Layout continua sendo decidido por media query no CSS; duplicar breakpoint
 * em JS é como as duas versões saem de sincronia.
 */
export function useMediaQuery(query: string): boolean {
  const [combina, setCombina] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const ouvir = () => setCombina(mq.matches);
    ouvir();
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, [query]);

  return combina;
}
