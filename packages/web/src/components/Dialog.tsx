import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './Button';
import { X } from './icones';
import styles from './Overlay.module.css';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Diálogo modal sobre o `<dialog>` nativo com `showModal()`.
 *
 * A primeira versão usava o `FloatingFocusManager`, e o foco vazava: no
 * terceiro Tab ele passava pela guarda e caía nos botões da página atrás.
 * O elemento nativo resolve as quatro exigências de uma vez e sem guarda —
 * prende o foco, torna o resto da página inerte, fecha no `Escape` e devolve
 * o foco ao elemento que abriu — porque quem implementa isso é o navegador.
 *
 * O que ele não faz sozinho é fechar ao clicar no véu; isso está abaixo.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const descricaoId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // `close` cobre tanto o Escape quanto o `close()` programático, então o
  // estado de fora nunca fica dessincronizado do elemento.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const aoFechar = () => onOpenChange(false);
    dialog.addEventListener('close', aoFechar);
    return () => dialog.removeEventListener('close', aoFechar);
  }, [onOpenChange]);

  /** O clique no véu chega como clique no próprio `<dialog>`, não num filho. */
  function aoClicar(event: MouseEvent<HTMLDialogElement>): void {
    if (event.target === ref.current) onOpenChange(false);
  }

  return (
    <dialog
      ref={ref}
      className={`${styles.surface} ${styles.dialog} chamfer`}
      aria-labelledby={tituloId}
      aria-describedby={description ? descricaoId : undefined}
      onClick={aoClicar}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id={tituloId}>
          {title}
        </h2>
        <IconButton label="Fechar" size="sm" onClick={() => onOpenChange(false)}>
          <X />
        </IconButton>
      </div>

      <div className={styles.dialogBody}>
        {description ? <p id={descricaoId}>{description}</p> : null}
        {children}
      </div>

      {footer ? <div className={styles.dialogFoot}>{footer}</div> : null}
    </dialog>
  );
}
