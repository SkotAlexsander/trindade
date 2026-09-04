import { cloneElement, useState, type ReactElement } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react';
import styles from './Overlay.module.css';

export interface TooltipProps {
  label: string;
  children: ReactElement;
  placement?: Placement;
}

/**
 * Atraso de 300ms para abrir e nenhum para fechar.
 *
 * Sem o atraso, passar o mouse pela barra de ferramentas acende cinco tooltips
 * em sequência. `useFocus` faz o mesmo aparecer no Tab, e o `useDismiss` fecha
 * no `Escape` — um tooltip que só o mouse abre não serve para quem navega por
 * teclado.
 */
export function Tooltip({ label, children, placement = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 300, close: 0 }, move: false }),
    useFocus(context),
    useDismiss(context, { referencePress: true }),
    useRole(context, { role: 'tooltip' }),
  ]);

  const filhoRef = (children as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
  const ref = useMergeRefs([refs.setReference, filhoRef ?? null]);

  return (
    <>
      {cloneElement(children, { ref, ...getReferenceProps() })}
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={styles.tooltip}
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
