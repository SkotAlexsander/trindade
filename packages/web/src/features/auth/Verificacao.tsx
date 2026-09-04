import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { User } from '@trindade/shared';
import { api, HttpError } from '../../lib/http';
import { useAuth } from './store';
import {
  AuthScreen,
  Banner,
  CodeInput,
  Field,
  buttonClass,
  centerClass,
  codeLength,
  footerClass,
  formClass,
  inputClass,
  ledeClass,
  linkClass,
  titleClass,
} from './components';

export function Verificacao() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuth((state) => state.setSession);

  const mfaToken = (location.state as { mfaToken?: string } | null)?.mfaToken;

  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Chegar aqui sem o token curto significa que a pessoa pulou o login.
  if (!mfaToken) return <Navigate to="/entrar" replace />;

  async function verify(payload: { code?: string; recoveryCode?: string }): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ access: string; user: User }>('/auth/totp', {
        method: 'POST',
        body: { mfaToken, ...payload },
        auth: false,
      });
      setSession(res.user, res.access);
      navigate('/', { replace: true });
    } catch (err) {
      // As caixas balançam, limpam e devolvem o foco à primeira.
      setShake(true);
      setTimeout(() => setShake(false), 200);
      setCode('');

      if (err instanceof HttpError && err.code === 'MFA_TOKEN_EXPIRED') {
        setError('Este código expirou. Entre de novo.');
      } else if (err instanceof HttpError && err.code === 'INVALID_RECOVERY_CODE') {
        setError('Código de recuperação inválido ou já usado.');
      } else if (err instanceof HttpError && err.status === 429) {
        setError('Muitas tentativas. Tente de novo em alguns minutos.');
      } else {
        setError('Código incorreto. Confira o aplicativo e tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (usingRecovery) void verify({ recoveryCode: recovery });
    else if (code.length === codeLength) void verify({ code });
  }

  return (
    <AuthScreen>
      <h1 className={titleClass}>Verificação em duas etapas</h1>
      <p className={ledeClass}>
        {usingRecovery
          ? 'Digite um dos códigos que você guardou ao ativar a verificação.'
          : 'Digite o código do seu aplicativo autenticador.'}
      </p>

      <form className={formClass} onSubmit={handleSubmit} noValidate>
        {usingRecovery ? (
          <Field label="Código de recuperação">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                value={recovery}
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoFocus
                onChange={(e) => setRecovery(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <CodeInput
            value={code}
            onChange={setCode}
            // Ao completar o sexto dígito, envia sozinho — não espera clique.
            onComplete={(value) => void verify({ code: value })}
            shake={shake}
            disabled={submitting}
          />
        )}

        {error ? <Banner>{error}</Banner> : null}

        <button
          className={buttonClass}
          type="submit"
          disabled={submitting || (usingRecovery ? recovery.length === 0 : code.length < codeLength)}
        >
          {submitting ? 'Verificando…' : 'Verificar'}
        </button>
      </form>

      <p className={`${footerClass} ${centerClass}`}>
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            setUsingRecovery((v) => !v);
            setError(null);
            setCode('');
            setRecovery('');
          }}
        >
          {usingRecovery ? 'Usar o aplicativo autenticador' : 'Usar um código de recuperação'}
        </button>
      </p>
    </AuthScreen>
  );
}
