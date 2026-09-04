import { forwardRef, useState } from 'react';
import type { UserStatus } from '@trindade/shared';
import { colorFromId, ensureContrast } from '../lib/contraste';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Usado para derivar a cor de fallback — estável e sem guardar nada. */
  id: string;
  name: string;
  src?: string | null;
  size?: AvatarSize;
  status?: UserStatus;
  className?: string;
}

/** Lê um token de cor já resolvido pelo navegador, no tema em vigor. */
function lerToken(nome: string): string {
  if (typeof window === 'undefined') return '#ffffff';
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor || '#ffffff';
}

/** Uma letra até duas palavras, duas se houver sobrenome. */
function iniciais(name: string): string {
  const partes = name.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return (partes[0] ?? '').slice(0, 1).toUpperCase();
  return ((partes[0] ?? '').slice(0, 1) + (partes[partes.length - 1] ?? '').slice(0, 1)).toUpperCase();
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { id, name, src, size = 'md', status, className },
  ref,
) {
  const [quebrou, setQuebrou] = useState(false);
  const mostrarImagem = Boolean(src) && !quebrou;

  const fundo = colorFromId(id);
  // A cor derivada pode cair num tom em que a inicial some, então o texto se
  // ajusta ao fundo sorteado. O valor sai de --text-primary lido em tempo de
  // execução: um hex literal aqui seria a única cor do produto fora de
  // tokens.css, e ficaria errado no tema claro.
  const texto = ensureContrast(lerToken('--text-primary'), fundo);

  return (
    <span
      ref={ref}
      className={[styles.root, styles[size], className].filter(Boolean).join(' ')}
      {...(status ? { 'data-status': status } : {})}
    >
      {mostrarImagem ? (
        <img
          className={styles.face}
          src={src ?? undefined}
          alt={name}
          onError={() => setQuebrou(true)}
        />
      ) : (
        // O nome já aparece ao lado em todo uso; repetir aqui só faria o
        // leitor de tela dizer duas vezes.
        <span className={styles.face} style={{ background: fundo, color: texto }} aria-hidden="true">
          {iniciais(name)}
        </span>
      )}
    </span>
  );
});
