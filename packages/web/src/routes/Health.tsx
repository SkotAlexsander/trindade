import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@trindade/shared';
import { api } from '../lib/http';

export function Health() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health'),
    retry: false,
  });

  return (
    <main style={{ padding: '2rem' }}>
      <h1>Trindade</h1>
      <p>Fundação. Nada de produto ainda — só o health check.</p>
      {isPending && <p>consultando…</p>}
      {error && <p role="alert">API fora do ar: {error.message}</p>}
      {data && (
        <dl>
          <dt>API</dt>
          <dd>{data.ok ? 'ok' : 'falha'}</dd>
          <dt>Banco</dt>
          <dd>{data.db ? 'ok' : 'falha'}</dd>
        </dl>
      )}
    </main>
  );
}
