import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { setSessionLostHandler, tryRestoreSession } from '../../lib/http';
import { useAuth } from './store';

/**
 * Porta das rotas autenticadas.
 *
 * No primeiro carregamento o access token não existe — ele vive só em memória
 * e a página acabou de ser recarregada. Antes de decidir mandar para /entrar,
 * é preciso tentar o refresh pelo cookie; sem isso, recarregar a página
 * desloga. Ver prompts/fase-02-auth.md.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((state) => state.status);
  const loadMe = useAuth((state) => state.loadMe);
  const clear = useAuth((state) => state.clear);
  const location = useLocation();
  const started = useRef(false);

  useEffect(() => {
    setSessionLostHandler(() => clear());
  }, [clear]);

  useEffect(() => {
    if (started.current || status !== 'unknown') return;
    started.current = true;

    void (async () => {
      const access = await tryRestoreSession();
      if (!access) {
        clear();
        return;
      }
      try {
        await loadMe();
      } catch {
        clear();
      }
    })();
  }, [status, loadMe, clear]);

  // Enquanto não se sabe, não redireciona: mandar para /entrar aqui seria o
  // mesmo bug de deslogar ao recarregar.
  if (status === 'unknown') return null;

  if (status === 'anonymous') {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
