import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, IconButton, Input, Spinner, useToast } from '../../components';
import { Check, X } from '../../components/icones';
import { api } from '../../lib/http';
import styles from './pessoas.module.css';

/**
 * Convidar alguém.
 *
 * O link é gerado **ao abrir**, não ao clicar num botão: quem abriu já quer o
 * link, e um botão "gerar" a mais é um passo que só existe para o programa.
 * Se a pessoa fechar sem usar, ele expira sozinho.
 *
 * Ver design/05-perfil-e-cargos.md, "Convites".
 */

interface Convite {
  code: string;
  url: string;
  note: string | null;
  createdBy: string;
  usedBy: string | null;
  usedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

const PRAZOS = [
  { horas: 24, rotulo: '1 dia' },
  { horas: 168, rotulo: '7 dias' },
  { horas: 720, rotulo: '30 dias' },
] as const;

function expiraEm(iso: string): string {
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias <= 0) return 'expirado';
  return dias === 1 ? 'expira amanhã' : `expira em ${dias} d`;
}

export function DialogoDeConvite({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [novo, setNovo] = useState<{ code: string; url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [nota, setNota] = useState('');
  const [horas, setHoras] = useState<number>(168);
  const jaPediu = useRef(false);

  const { data: convites } = useQuery({
    queryKey: ['invites'],
    queryFn: async () => (await api<{ invites: Convite[] }>('/invites')).invites,
    enabled: aberto,
  });

  const criar = useMutation({
    mutationFn: async (corpo: { note: string | null; expiresInHours: number }) =>
      await api<{ code: string; url: string }>('/invites', { method: 'POST', body: corpo }),
    onSuccess: (r) => {
      setNovo(r);
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: () => show('Não consegui criar o convite.', 'danger'),
  });

  const revogar = useMutation({
    mutationFn: (code: string) => api(`/invites/${code}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
    onError: () => show('Não consegui revogar o convite.', 'danger'),
  });

  /**
   * Um link por abertura, e não um por render.
   *
   * O ref é o que impede a segunda passagem do StrictMode de criar um segundo
   * convite — dois links de uso único para a mesma pessoa, e um deles perdido
   * até expirar.
   */
  useEffect(() => {
    if (!aberto) {
      jaPediu.current = false;
      setNovo(null);
      setNota('');
      setCopiado(false);
      return;
    }
    if (jaPediu.current) return;
    jaPediu.current = true;
    // A dependência é só `aberto`, de propósito: o objeto da mutação muda de
    // identidade a cada render dela, e incluí-lo faria o efeito rodar de novo
    // e pedir mais um convite. O `jaPediu` acima é o que garante um por
    // abertura mesmo com o efeito rodando duas vezes no StrictMode.
    criar.mutate({ note: null, expiresInHours: 168 });
  }, [aberto]);

  async function copiar(): Promise<void> {
    if (!novo) return;
    try {
      await navigator.clipboard.writeText(novo.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      show('Não consegui copiar — selecione o link à mão.', 'danger');
    }
  }

  const abertos = (convites ?? []).filter((c) => !c.usedBy);

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        if (!proximo) onFechar();
      }}
      title="Convidar alguém"
      footer={
        <Button variant="secondary" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <div className={styles.blocoDoConvite}>
        {novo ? (
          <>
            <div className={styles.linkDoConvite}>
              <code>{novo.url}</code>
            </div>
            <div className={styles.acoesDoConvite}>
              <Button variant="secondary" size="sm" onClick={() => void copiar()}>
                {copiado ? (
                  <>
                    <Check size={16} /> Copiado
                  </>
                ) : (
                  'Copiar link'
                )}
              </Button>
            </div>
            {/* Em texto claro, não como rótulo técnico: "vale para uma pessoa"
                comunica melhor que "uso único". */}
            <p className={styles.dicaDoConvite}>
              Vale para uma pessoa e expira em {PRAZOS.find((p) => p.horas === horas)?.rotulo ?? '7 dias'}.
            </p>
          </>
        ) : (
          <div className={styles.gerando}>
            <Spinner /> <span>Gerando o link…</span>
          </div>
        )}
      </div>

      <Input
        label="Para quem é? (opcional)"
        value={nota}
        maxLength={120}
        placeholder="Bruno, do time de design"
        hint="Só você vê. Serve para lembrar quem recebeu qual link."
        onChange={(e) => setNota(e.target.value)}
      />

      <div className={styles.prazo}>
        <label className={styles.rotuloDoPrazo} htmlFor="prazo-do-convite">
          Expira em
        </label>
        <select
          id="prazo-do-convite"
          className={styles.selectDoPrazo}
          value={horas}
          onChange={(e) => setHoras(Number(e.target.value))}
        >
          {PRAZOS.map((p) => (
            <option key={p.horas} value={p.horas}>
              {p.rotulo}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={criar.isPending}
          onClick={() => criar.mutate({ note: nota.trim() || null, expiresInHours: horas })}
        >
          Gerar outro
        </Button>
      </div>

      {abertos.length > 0 ? (
        <>
          <div className={styles.separador} />
          <p className="section-label">Convites abertos</p>
          <ul className={styles.convites}>
            {abertos.map((c) => (
              <li key={c.code} className={styles.convite}>
                <code className={styles.codigo}>{c.code.slice(0, 8)}…</code>
                {c.note ? <span className={styles.notaDoConvite}>{c.note}</span> : null}
                <span className={styles.espacador} />
                <span className={styles.prazoDoConvite}>{expiraEm(c.expiresAt)}</span>
                <IconButton
                  label={`Revogar convite ${c.code.slice(0, 8)}`}
                  size="sm"
                  onClick={() => revogar.mutate(c.code)}
                >
                  <X size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
