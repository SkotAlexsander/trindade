import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { User } from '@trindade/shared';
import { usernameSchema } from '@trindade/shared';
import { api, HttpError } from '../../lib/http';
import type { PasswordScore } from './senha';
import {
  AuthScreen,
  Banner,
  Field,
  PasswordInput,
  availableNoClass,
  availableOkClass,
  buttonClass,
  footerClass,
  formClass,
  hintClass,
  inputClass,
  linkClass,
  meterBarsClass,
  meterClass,
  meterLabelClass,
  meterSegmentClass,
  titleClass,
} from './components';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Disponibilidade do nome com 500ms de espera.
 *
 * A API não expõe rota de checagem — ela revelaria quem existe, e o elenco é
 * de cinco pessoas. Validamos o formato aqui e deixamos a colisão de verdade
 * para o `USERNAME_TAKEN` do registro.
 */
function useUsernameCheck(username: string): Availability {
  const [state, setState] = useState<Availability>('idle');

  useEffect(() => {
    if (!username) {
      setState('idle');
      return;
    }
    setState('checking');
    const id = setTimeout(() => {
      setState(usernameSchema.safeParse(username).success ? 'free' : 'invalid');
    }, 500);
    return () => clearTimeout(id);
  }, [username]);

  return state;
}

/**
 * O zxcvbn e seus dicionários pesam mais de 1 MB. Carregar isso na tela de
 * entrar, onde ele não serve para nada, seria pagar o custo em toda visita:
 * o `import()` dinâmico deixa o pacote num chunk que só desce aqui, e só
 * quando alguém começa a digitar a senha.
 */
function usePasswordStrength(
  password: string,
  username: string,
  displayName: string,
): PasswordScore | null {
  const [score, setScore] = useState<PasswordScore | null>(null);

  useEffect(() => {
    if (!password) {
      setScore(null);
      return;
    }
    let cancelled = false;
    // A senha é comparada com o que a pessoa já digitou: "ana" dentro da senha
    // da Ana não conta como força.
    void import('./senha').then(({ scorePassword }) => {
      if (!cancelled) setScore(scorePassword(password, [username, displayName]));
    });
    return () => {
      cancelled = true;
    };
  }, [password, username, displayName]);

  return score;
}

export function CriarConta() {
  // Sem `:codigo` na rota, o cadastro é aberto — nome e senha, e nada mais.
  const { codigo } = useParams<{ codigo?: string }>();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  /* O nome de exibição não é pedido aqui: são duas versões do mesmo nome numa
     tela que precisa de dois campos. O servidor usa o nome de usuário, e quem
     quiser outro troca no perfil. Ele continua alimentando o medidor de força
     da senha — uma senha que contém o próprio nome é fraca de qualquer jeito. */
  const displayName = username;
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availability = useUsernameCheck(username);
  const strength = usePasswordStrength(password, username, displayName);

  // Erros de campo aparecem no blur, não a cada tecla: validar enquanto a
  // pessoa digita a mostra errada antes de ela terminar, e isso é hostil.
  const usernameError =
    touched.username && username && availability === 'invalid'
      ? 'Use apenas letras minúsculas, números e sublinhado.'
      : undefined;
  const passwordError =
    touched.password && password.length > 0 && password.length < 12
      ? 'Use pelo menos 12 caracteres.'
      : undefined;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      await api<{ user: User }>('/auth/register', {
        method: 'POST',
        body: {
          /* Sem convite na URL, cadastro aberto. As duas portas coexistem:
             abrir o produto para o grupo entrar, e convidar alguém
             pontualmente depois que as vagas fecharam. */
          code: codigo,
          username: username.trim().toLowerCase(),
          password,
        },
        auth: false,
      });

      // Sem login automático: exercitar a senha uma vez logo depois de criá-la
      // aumenta muito a chance de ela ser lembrada.
      navigate('/entrar', {
        replace: true,
        state: { notice: 'Conta criada. Entre com sua senha.' },
      });
    } catch (err) {
      if (err instanceof HttpError && err.code === 'USERNAME_TAKEN') {
        setError('Este nome já está sendo usado.');
      } else if (err instanceof HttpError && err.code === 'PASSWORD_BREACHED') {
        setError('Esta senha apareceu em vazamentos públicos. Escolha outra.');
      } else if (err instanceof HttpError && err.code.startsWith('INVITE_')) {
        setError('Este convite não vale mais.');
      } else if (err instanceof HttpError && err.code === 'SEM_VAGAS') {
        setError('As vagas deste espaço acabaram. Peça um convite a quem já está dentro.');
      } else if (err instanceof HttpError && err.code === 'CADASTRO_FECHADO') {
        setError('O cadastro está fechado. Peça um convite a quem já está dentro.');
      } else if (err instanceof HttpError && err.code === 'NETWORK') {
        setError('Sem conexão com o servidor. Verifique sua internet.');
      } else {
        setError('Não foi possível criar a conta. Confira os campos e tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = availability === 'free' && password.length >= 12;

  return (
    <AuthScreen>
      <h1 className={titleClass}>Criar sua conta</h1>

      <form className={formClass} onSubmit={handleSubmit} noValidate>
        <Field
          label="Nome de usuário"
          prefix="@"
          error={usernameError}
          // A imutabilidade é avisada antes, não depois: é a diferença entre
          // decisão informada e surpresa desagradável.
          hint={
            <>
              Letras minúsculas, números e _<br />
              Não poderá ser alterado depois.
            </>
          }
          adornment={
            availability === 'free' ? (
              <span className={availableOkClass} aria-label="formato válido">
                ✓
              </span>
            ) : availability === 'invalid' ? (
              <span className={availableNoClass} aria-label="formato inválido">
                ✕
              </span>
            ) : null
          }
        >
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              onBlur={() => setTouched((t) => ({ ...t, username: true }))}
            />
          )}
        </Field>

        <Field label="Senha" error={passwordError}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              autoComplete="new-password"
            />
          )}
        </Field>

        {strength ? (
          <div className={meterClass}>
            <div className={meterBarsClass}>
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={meterSegmentClass}
                  data-level={index < strength.filled ? strength.score : undefined}
                />
              ))}
            </div>
            <span className={meterLabelClass}>{strength.label}</span>
          </div>
        ) : null}

        {passwordError ? null : <p className={hintClass}>Mínimo de 12 caracteres.</p>}

        {error ? <Banner>{error}</Banner> : null}

        <button className={buttonClass} type="submit" disabled={submitting || !canSubmit}>
          {submitting ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>

      <p className={footerClass}>
        Já tem conta?{' '}
        <Link className={linkClass} to="/entrar">
          Entrar
        </Link>
      </p>
    </AuthScreen>
  );
}
