import {
  cloneElement,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTypeahead,
  type Placement,
} from '@floating-ui/react';
import styles from './Overlay.module.css';

export interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  placement?: Placement;
  label?: string;
}

/**
 * Menu com `role="menu"`, navegação por setas, `Enter` para escolher,
 * `Escape` para fechar e busca por digitação.
 *
 * O `useTypeahead` é o que faz digitar "ar" pular para "Arquivar" — barato de
 * ligar e é o que separa um menu utilizável de uma lista de botões.
 */
export function Menu({ trigger, children, placement = 'bottom-start', label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const listaRef = useRef<Array<HTMLElement | null>>([]);
  const rotulosRef = useRef<Array<string | null>>([]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' }),
    useListNavigation(context, {
      listRef: listaRef,
      activeIndex,
      onNavigate: setActiveIndex,
      loop: true,
    }),
    useTypeahead(context, {
      listRef: rotulosRef,
      activeIndex,
      onMatch: setActiveIndex,
      enabled: open,
    }),
  ]);

  const triggerRef = (trigger as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
  const ref = useMergeRefs([refs.setReference, triggerRef ?? null]);

  return (
    <MenuContexto.Provider value={{ getItemProps, activeIndex, fechar: () => setOpen(false) }}>
      {cloneElement(trigger, { ref, ...getReferenceProps() })}
      {open ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={`${styles.surface} ${styles.menu} chamfer-sm`}
              aria-label={label}
              {...getFloatingProps()}
            >
              <FloatingList elementsRef={listaRef} labelsRef={rotulosRef}>
                {children}
              </FloatingList>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </MenuContexto.Provider>
  );
}

import { createContext, useContext } from 'react';

interface MenuContextoValor {
  getItemProps: (props?: Record<string, unknown>) => Record<string, unknown>;
  activeIndex: number | null;
  fechar: () => void;
}

const MenuContexto = createContext<MenuContextoValor | null>(null);

export interface MenuItemProps {
  children: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
}

export function MenuItem({ children, onSelect, disabled, danger, icon }: MenuItemProps) {
  const menu = useContext(MenuContexto);
  const item = useListItem({ label: disabled ? null : children });
  const ativo = menu?.activeIndex === item.index;

  return (
    <button
      type="button"
      ref={item.ref}
      role="menuitem"
      className={styles.item}
      data-active={ativo}
      data-danger={danger}
      disabled={disabled}
      // `tabIndex` -1 em todos menos o ativo: o menu é um único ponto de
      // parada do Tab, e as setas navegam dentro dele.
      tabIndex={ativo ? 0 : -1}
      {...menu?.getItemProps({
        onClick: () => {
          onSelect?.();
          menu.fechar();
        },
      })}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}
