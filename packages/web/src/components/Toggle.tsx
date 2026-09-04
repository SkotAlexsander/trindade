import { useId } from 'react';
import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Chama atenção — usado só pelo `ADMINISTRATOR`. */
  grave?: boolean;
}

/**
 * Interruptor.
 *
 * `role="switch"` num `<button>`, e não um `<input type="checkbox">`
 * disfarçado: leitor de tela anuncia "ligado/desligado" em vez de "marcado", e
 * é isso que uma permissão é. O rótulo é o próprio botão, então clicar em
 * qualquer parte da linha alterna.
 */
export function Toggle({ checked, onChange, label, hint, disabled, grave }: ToggleProps) {
  const dicaId = useId();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={hint ? dicaId : undefined}
      disabled={disabled}
      data-grave={grave || undefined}
      className={styles.linha}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.texto}>
        <span className={styles.rotulo}>{label}</span>
        {hint ? (
          <span className={styles.dica} id={dicaId}>
            {hint}
          </span>
        ) : null}
      </span>
      <span className={styles.trilho} aria-hidden="true">
        <span className={styles.botao} />
      </span>
    </button>
  );
}
