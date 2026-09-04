import { useParams } from 'react-router-dom';
import { Skeleton } from '../components';
import { useChannels } from '../features/channels/queries';

/**
 * A conversa. Sem mensagens ainda — o histórico fica com espaço reservado até
 * a fase 5. Ver prompts/fase-04-shell.md.
 */
export function Canal() {
  const { slug } = useParams<{ slug: string }>();
  const { data: canais, isPending } = useChannels();
  const canal = canais?.find((c) => c.slug === slug);

  if (isPending) {
    // Seis blocos com a proporção real de mensagem. Nada de spinner no shell.
    return (
      <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--s-3)' }}>
            <Skeleton width="32px" height="32px" radius="var(--r-full)" />
            <div style={{ flex: 1, display: 'grid', gap: 'var(--s-2)', maxWidth: 560 }}>
              <Skeleton width="120px" height="12px" />
              <Skeleton height="14px" />
              <Skeleton width={`${55 + ((i * 13) % 35)}%`} height="14px" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Tela vazia é convite para agir, não momento decorativo: sem ilustração.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s-2)',
        height: '100%',
        textAlign: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      <strong style={{ fontSize: 'var(--text-section)', color: 'var(--text-primary)' }}>
        #{canal?.name ?? slug}
      </strong>
      <p>Este canal ainda não tem mensagens. Escreva a primeira.</p>
    </div>
  );
}
