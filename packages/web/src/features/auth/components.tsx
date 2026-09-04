import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { MarcaCheia, Palavra } from '../../components/Logo';
import styles from './auth.module.css';

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>{children}</div>
    </main>
  );
}

/**
 * O bloco da marca. Único lugar do produto onde a arte aparece inteira, com
 * os pontos — é a tela em que a pessoa está sozinha e há espaço para isso.
 */
export function Brand() {
  return (
    <div className={styles.brand}>
      <MarcaCheia size={72} className={styles.mark} />
      <Palavra width={190} className={styles.wordmark} />
      <span className="visually-hidden">Trindade</span>
    </div>
  );
}

/** Erro acima do botão, em faixa. Nunca em toast. */
export function Banner({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'info' }) {
  return (
    <p
      className={kind === 'info' ? `${styles.banner} ${styles.bannerInfo}` : styles.banner}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  prefix?: string;
  adornment?: ReactNode;
  invalid?: boolean;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, prefix, adornment, invalid, children }: FieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap} data-invalid={invalid || Boolean(error)}>
        {prefix ? (
          <span className={styles.prefix} aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        {children(id)}
        {adornment ? <span className={styles.adornment}>{adornment}</span> : null}
      </div>
      {/* Um erro por vez: uma lista de cinco falhas desanima. */}
      {error ? <p className={styles.fieldError}>{error}</p> : hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

export const inputClass = styles.input;
export const buttonClass = styles.button;
export const linkClass = styles.link;
export const revealClass = styles.reveal;

export function PasswordInput(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <input
        id={props.id}
        className={styles.input}
        type={visible ? 'text' : 'password'}
        value={props.value}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
      />
      <span className={styles.adornment}>
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </span>
    </>
  );
}

/** Lucide, traço de 1.5, currentColor sempre. Ver design/01-tokens.md. */
function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10.7 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 13s3.5 7 10 7a9.8 9.8 0 0 0 4.5-1.1" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

const CODE_LENGTH = 6;

/**
 * Seis caixas de código. O comportamento importa mais que a aparência:
 * colar preenche tudo e envia, backspace numa caixa vazia volta, setas navegam,
 * e completar o sexto dígito envia sozinho — sem esperar clique.
 */
export function CodeInput(props: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  shake: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = props.value.padEnd(CODE_LENGTH, ' ').slice(0, CODE_LENGTH).split('');

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Erro limpa e devolve o foco à primeira caixa.
  useEffect(() => {
    if (props.shake) refs.current[0]?.focus();
  }, [props.shake]);

  function commit(next: string, focusIndex: number): void {
    props.onChange(next);
    refs.current[Math.min(focusIndex, CODE_LENGTH - 1)]?.focus();
    if (next.length === CODE_LENGTH) props.onComplete(next);
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>): void {
    const typed = event.target.value.replace(/\D/g, '');
    if (!typed) return;

    const chars = props.value.split('');
    // Digitar vários de uma vez (autofill de SMS) preenche a partir daqui.
    for (let i = 0; i < typed.length && index + i < CODE_LENGTH; i += 1) {
      chars[index + i] = typed[i] as string;
    }
    commit(chars.join('').slice(0, CODE_LENGTH), index + typed.length);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const chars = props.value.split('');
      if (chars[index]) {
        chars[index] = '';
        props.onChange(chars.join('').trimEnd());
        return;
      }
      // Caixa vazia: volta para a anterior e apaga lá.
      if (index > 0) {
        chars[index - 1] = '';
        props.onChange(chars.slice(0, index - 1).join(''));
        refs.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>): void {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    commit(pasted, pasted.length);
  }

  return (
    <div className={styles.codeRow} data-shake={props.shake}>
      {digits.map((digit, index) => (
        <input
          // A posição é a identidade da caixa: são sempre seis e não há
          // reordenação possível.
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          className={styles.codeBox}
          value={digit.trim()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={CODE_LENGTH}
          disabled={props.disabled}
          aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
          onChange={(e) => handleChange(index, e)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export const codeLength = CODE_LENGTH;
export const centerClass = styles.center;
export const hintClass = styles.hint;
export const footerClass = styles.footer;
export const titleClass = styles.title;
export const ledeClass = styles.lede;
export const formClass = styles.form;
export const meterClass = styles.meter;
export const meterBarsClass = styles.meterBars;
export const meterSegmentClass = styles.meterSegment;
export const meterLabelClass = styles.meterLabel;
export const availableOkClass = styles.availableOk;
export const availableNoClass = styles.availableNo;
