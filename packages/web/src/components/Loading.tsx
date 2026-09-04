import type { CSSProperties } from 'react';
import styles from './Overlay.module.css';

/**
 * Só para carregamento de página inteira, nunca dentro de botão: no botão o
 * rótulo em gerúndio diz qual ação está em curso, e o símbolo perde isso.
 */
export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className={styles.spinnerBox} role="status">
      <div className={styles.spinner} />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

/**
 * Bloco com a proporção do conteúdo real, opacidade pulsando em 1,4s.
 *
 * Sem varredura diagonal: ela é decoração que chama atenção justamente para o
 * que ainda não existe. Ver design/00-direcao-visual.md.
 */
export function Skeleton({ width = '100%', height = 'var(--s-4)', radius, className }: SkeletonProps) {
  const estilo: CSSProperties = { width, height };
  if (radius) estilo.borderRadius = radius;
  return (
    <div
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={estilo}
      aria-hidden="true"
    />
  );
}
