import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import type { User } from '@trindade/shared';
import { api, HttpError } from '../../lib/http';
import { useAuth } from './store';
import {
  AuthScreen,
  Banner,
  Brand,
  Field,
  PasswordInput,
  buttonClass,
  footerClass,
  formClass,
  linkClass,
  inputClass,
  titleClass,
} from './components';

type LoginResponse = { access: string; user: User } | { mfaRequired: true; mfaToken: string };

/** Contagem regressiva ao vivo: um tempo vago frustra mais que o bloqueio. */
function useCountdown(seconds: number | null): number | null {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    if (seconds === null) return;
    const id = setInterval(() => {
      setRemaining((value) => (value === null || value <= 1 ? null : value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);

  return remaining;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

export function Entrar() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((state) => state.setSession);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const remaining = useCountdown(lockedFor);
  const notice = (location.state as { notice?: string } | null)?.notice;

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitting || remaining !== null) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username: username.trim().toLowerCase(), password },
        auth: false,
      });

      if ('mfaRequired' in res) {
        navigate('/entrar/verificacao', { state: { mfaToken: res.mfaToken } });
        return;
      }

      setSession(res.user, res.access);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        setLockedFor(err.retryAfter ?? 900);
        setError(null);
      } else if (err instanceof HttpError && err.code === 'ACCOUNT_DISABLED') {
        setError('Esta conta foi desativada. Fale com quem administra o servidor.');
      } else if (err instanceof HttpError && err.code === 'NETWORK') {
        setError('Sem conexão com o servidor. Verifique sua internet.');
      } else {
        // Nunca diga qual dos dois errou: isso confirma quais usuários existem.
        setError('Usuário ou senha incorretos.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <Brand />
      <h1 className={titleClass}>Entrar</h1>

      {notice ? <Banner kind="info">{notice}</Banner> : null}

      {/* onSubmit controlado: sem isso o Enter não envia e metade das pessoas trava. */}
      <form className={formClass} onSubmit={handleSubmit} noValidate>
        <Field label="Usuário">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>

        <Field label="Senha">
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
        </Field>

        {remaining !== null ? (
          <Banner>Muitas tentativas. Tente de novo em {formatWait(remaining)}.</Banner>
        ) : null}
        {error ? <Banner>{error}</Banner> : null}

        {/* Carregamento no próprio texto: trocar o rótulo por um spinner perde
            a informação de qual ação está em curso. */}
        <button className={buttonClass} type="submit" disabled={submitting || remaining !== null}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      {/* Sem link: não existe criar conta sem um código, e apontar para esta
          mesma página seria um botão falso. Ver design/06-autenticacao.md. */}
      <p className={footerClass}>
        Ainda não tem conta? <Link className={linkClass} to="/criar-conta">Criar uma</Link>.
        <br />
        Tem um convite? Abra o link que te mandaram.
      </p>
    </AuthScreen>
  );
}
