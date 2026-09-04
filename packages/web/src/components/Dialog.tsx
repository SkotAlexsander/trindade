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
  /**
   * O `open` de agora, legível de dentro de um listener.
   *
   * `dialog.close()` **não** dispara o `close` na hora: o evento é enfileirado
   * e chega depois, quando `open` já é `false` há um render. Devolver esse
   * `close` para quem abriu é ecoar de volta uma ordem que veio de lá — e
   * fazia o diálogo reabrir a pergunta de "descartar alterações?" logo depois
   * de salvar. Se `open` já é falso, o pai sabe; não há o que avisar.
   */
  const abertoAgora = useRef(open);
  abertoAgora.current = open;
  const tituloId = useId();
  const descricaoId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // `close` cobre o fechamento programático, e o estado de fora nunca fica
  // dessincronizado do elemento.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const aoFechar = () => {
      if (!abertoAgora.current) return;
      onOpenChange(false);
    };
    dialog.addEventListener('close', aoFechar);
    return () => dialog.removeEventListener('close', aoFechar);
  }, [onOpenChange]);

  /**
   * O Escape **pede** para fechar; quem decide é quem abriu.
   *
   * Sem o `preventDefault`, o elemento nativo fecha primeiro e avisa depois —
   * e um diálogo que precisa perguntar "descartar as alterações?" já
   * desapareceu da tela quando a pergunta aparece, junto com a pergunta. O
   * `cancel` é disparado antes do fechamento, e é o único lugar onde dá para
   * segurá-lo.
   */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const aoCancelar = (event: Event) => {
      event.preventDefault();
      onOpenChange(false);
    };
    dialog.addEventListener('cancel', aoCancelar);
    return () => dialog.removeEventListener('cancel', aoCancelar);
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
