import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './Field.module.css';

interface CamposComuns {
  label: string;
  hint?: ReactNode;
  /** Já validado por quem chama; aparece no blur, não a cada tecla. */
  error?: string;
  adornment?: ReactNode;
}

function Envolucro({
  id,
  label,
  hint,
  error,
  adornment,
  children,
}: CamposComuns & { id: string; children: ReactNode }) {
  const hintId = `${id}-ajuda`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.wrap} data-invalid={Boolean(error)}>
        {children}
        {adornment ? <span className={styles.adornment}>{adornment}</span> : null}
      </div>
      {/* Um erro por vez: uma lista de cinco falhas desanima. */}
      {error ? (
        <p className={styles.error} id={hintId}>
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>,
    CamposComuns {
  id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, adornment, className, onBlur, ...rest },
  ref,
) {
  const gerado = useId();
  const id = rest.id ?? gerado;
  // Só marca como tocado no blur. Validar enquanto a pessoa digita a mostra
  // errada antes de ela terminar, e isso é hostil.
  const [tocado, setTocado] = useState(false);
  const erroVisivel = tocado || rest.value === undefined ? error : undefined;

  return (
    <Envolucro
      id={id}
      label={label}
      {...(hint !== undefined ? { hint } : {})}
      {...(erroVisivel !== undefined ? { error: erroVisivel } : {})}
      {...(adornment !== undefined ? { adornment } : {})}
    >
      <input
        {...rest}
        id={id}
        ref={ref}
        className={[styles.control, className].filter(Boolean).join(' ')}
        aria-invalid={erroVisivel ? true : undefined}
        aria-describedby={hint || erroVisivel ? `${id}-ajuda` : undefined}
        onBlur={(e) => {
          setTocado(true);
          onBlur?.(e);
        }}
      />
    </Envolucro>
  );
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>,
    CamposComuns {
  id?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, adornment, className, onBlur, ...rest },
  ref,
) {
  const gerado = useId();
  const id = rest.id ?? gerado;
  const [tocado, setTocado] = useState(false);
  const erroVisivel = tocado || rest.value === undefined ? error : undefined;

  return (
    <Envolucro
      id={id}
      label={label}
      {...(hint !== undefined ? { hint } : {})}
      {...(erroVisivel !== undefined ? { error: erroVisivel } : {})}
      {...(adornment !== undefined ? { adornment } : {})}
    >
      <textarea
        {...rest}
        id={id}
        ref={ref}
        className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
        aria-invalid={erroVisivel ? true : undefined}
        aria-describedby={hint || erroVisivel ? `${id}-ajuda` : undefined}
        onBlur={(e) => {
          setTocado(true);
          onBlur?.(e);
        }}
      />
    </Envolucro>
  );
});
