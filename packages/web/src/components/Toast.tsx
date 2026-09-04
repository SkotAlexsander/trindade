import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './Button';
import { X } from './icones';
import styles from './Overlay.module.css';

export type ToastKind = 'info' | 'danger';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContexto {
  show: (message: string, kind?: ToastKind) => void;
}

const Contexto = createContext<ToastContexto | null>(null);

const MAX_EMPILHADOS = 3;
const DURACAO_MS = 5000;

/**
 * Canto inferior direito, empilha até três, some em 5s.
 *
 * O limite de três é a razão de o mais velho sair quando chega um quarto: uma
 * pilha que cresce sem fim cobre a interface e nenhum aviso é lido.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(0);

  const dispensar = useCallback((id: number) => {
    setToasts((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    proximoId.current += 1;
    const toast = { id: proximoId.current, message, kind };
    setToasts((atuais) => [...atuais, toast].slice(-MAX_EMPILHADOS));
  }, []);

  return (
    <Contexto.Provider value={{ show }}>
      {children}
      {/* `aria-live: polite` e não `assertive`: aviso de interface não deve
          interromper o que o leitor de tela está dizendo. */}
      <div className={styles.toastRegion} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dispensar} />
        ))}
      </div>
    </Contexto.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(toast.id), DURACAO_MS);
    return () => clearTimeout(id);
  }, [toast.id, onDismiss]);

  return (
    <div className={`${styles.surface} ${styles.toast} chamfer-sm`} data-kind={toast.kind}>
      <span className={styles.toastText}>{toast.message}</span>
      <IconButton label="Dispensar" size="sm" onClick={() => onDismiss(toast.id)}>
        <X size={16} />
      </IconButton>
    </div>
  );
}

export function useToast(): ToastContexto {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return contexto;
}
