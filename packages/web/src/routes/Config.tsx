import { useParams } from 'react-router-dom';

/** Páginas de configuração. Vazias por ora — chegam nas fases 6 e 8. */
export function Config() {
  const { secao } = useParams<{ secao: string }>();
  return (
    <div style={{ color: 'var(--text-secondary)' }}>
      <p className="section-label">{secao ?? 'configurações'}</p>
      <p style={{ marginTop: 'var(--s-2)' }}>Esta página chega numa fase adiante.</p>
    </div>
  );
}
