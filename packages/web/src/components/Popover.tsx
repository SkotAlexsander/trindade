import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react';
import styles from './Overlay.module.css';

export interface PopoverProps {
  /** O elemento que abre. Recebe ref e handlers por clonagem. */
  trigger: ReactElement;
  children: ReactNode;
  placement?: Placement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * `flip` e `shift` cuidam da colisão com a borda da janela: sem eles, um
 * popover perto do rodapé nasce metade fora da tela. `autoUpdate` mantém a
 * posição durante rolagem e redimensionamento.
 */
export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
  open: openControlado,
  onOpenChange,
}: PopoverProps) {
  const [interno, setInterno] = useState(false);
  const open = openControlado ?? interno;
  const setOpen = onOpenChange ?? setInterno;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context),
  ]);

  const triggerRef = (trigger as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
  const ref = useMergeRefs([refs.setReference, triggerRef ?? null]);

  return (
    <>
      {cloneElement(trigger, { ref, ...getReferenceProps() })}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={`${styles.surface} ${styles.popover} chamfer-sm`}
              {...getFloatingProps()}
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
