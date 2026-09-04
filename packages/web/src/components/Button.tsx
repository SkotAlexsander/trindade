import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Troca o texto pelo gerúndio e desabilita. Nunca troca por spinner: o
   * rótulo é a informação de qual ação está em curso, e um símbolo a perde.
   * Ver design/06-autenticacao.md.
   */
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingLabel,
    fullWidth = false,
    disabled,
    children,
    className,
    ...rest
  },
  ref,
) {
  const classes = [styles.base, styles[size], styles[variant], fullWidth ? styles.full : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      // Leitor de tela precisa saber que a ação está em curso; sem isto o
      // texto muda em silêncio.
      aria-busy={loading || undefined}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'fullWidth'> {
  /** Obrigatório: um botão só com ícone não tem nome acessível sem isto. */
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'ghost', size = 'md', label, children, className, ...rest },
  ref,
) {
  const classes = [
    styles.base,
    styles[size],
    styles[variant],
    styles.icon,
    size === 'md' ? styles.iconMd : styles.iconSm,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...rest} ref={ref} className={classes} aria-label={label} title={undefined}>
      {children}
    </button>
  );
});
