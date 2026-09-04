import { useEffect, useState } from 'react';
import { Button, Toggle } from '../../components';
import { api } from '../../lib/http';
import { useChannels } from '../channels/queries';
import { useLeitura } from '../messages/leitura';
import { estadoDaPermissao, pedirPermissao, type EstadoDaPermissao } from './desktop';
import { lerAvisos, salvarAvisos, type PreferenciasDeAviso } from './preferencias';
import { tocarAviso } from './sons';
import styles from './notificacoes.module.css';

/**
 * A tela de notificações. Uma só, e curta.
 *
 * Não existe "notificar em todas as mensagens": isso existe no Discord porque
 * servidores grandes têm canais que valem seguir de perto. Aqui todo canal é
 * importante o bastante para o ponto, e nenhum é importante o bastante para
 * interromper. Ver design/09-notificacoes.md.
 */
export function AbaNotificacoes() {
  const [prefs, setPrefs] = useState<PreferenciasDeAviso>(() => lerAvisos());
  const [permissao, setPermissao] = useState<EstadoDaPermissao>(() => estadoDaPermissao());
  const { data: canais } = useChannels();
  const leitura = useLeitura((s) => s.porCanal);

  useEffect(() => {
    setPermissao(estadoDaPermissao());
  }, []);

  function mudar(mudanca: Partial<PreferenciasDeAviso>): void {
    setPrefs(salvarAvisos(mudanca));
  }

  const silenciados = (canais ?? []).filter((c) => {
    const ate = leitura[c.id]?.mutedUntil;
    return Boolean(ate) && Date.parse(ate as string) > Date.now();
  });

  return (
    <div className={styles.aba}>
      <section className={styles.grupo}>
        <span className="section-label">Som</span>
        <Toggle
          checked={prefs.somDeChamado}
          onChange={(v) => mudar({ somDeChamado: v })}
          label="Tocar som em menções e respostas"
        />
        <Toggle
          checked={prefs.somDeThread}
          onChange={(v) => mudar({ somDeThread: v })}
          label="Tocar som em threads que participo"
        />
        {/* Uma lista de sons sem prévia é uma lista de nomes. */}
        <div className={styles.previa}>
          <Button variant="ghost" size="sm" onClick={() => tocarAviso('chamado')}>
            Ouvir o de chamado
          </Button>
          <Button variant="ghost" size="sm" onClick={() => tocarAviso('thread')}>
            Ouvir o de thread
          </Button>
        </div>
      </section>

      <section className={styles.grupo}>
        <span className="section-label">Área de trabalho</span>
        <Toggle
          checked={prefs.desktop}
          onChange={(v) => mudar({ desktop: v })}
          label="Mostrar notificação na área de trabalho"
          hint={dicaDaPermissao(permissao)}
        />
        {/* O produto pede a permissão sozinho na primeira menção; este botão é
            para quem quer resolver antes, e some quando não há o que pedir. */}
        {permissao === 'nao-pedida' && prefs.desktop ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void pedirPermissao().then(setPermissao)}
          >
            Permitir agora
          </Button>
        ) : null}
      </section>

      <section className={styles.grupo}>
        <span className="section-label">Não perturbe</span>
        <Toggle
          checked={prefs.naoPerturbe}
          onChange={(v) => mudar({ naoPerturbe: v })}
          label="Todos os dias, no mesmo horário"
          hint="Um horário, todos os dias. Para cinco pessoas, um calendário semanal é excesso."
        />
        <div className={styles.horario} data-ligado={prefs.naoPerturbe}>
          <label>
            das
            <input
              type="time"
              value={prefs.naoPerturbeDe}
              disabled={!prefs.naoPerturbe}
              onChange={(e) => mudar({ naoPerturbeDe: e.target.value })}
            />
          </label>
          <label>
            às
            <input
              type="time"
              value={prefs.naoPerturbeAte}
              disabled={!prefs.naoPerturbe}
              onChange={(e) => mudar({ naoPerturbeAte: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className={styles.grupo}>
        <span className="section-label">Canais silenciados</span>
        {silenciados.length === 0 ? (
          <p className={styles.vazio}>Nenhum canal silenciado.</p>
        ) : (
          silenciados.map((canal) => (
            <div key={canal.id} className={styles.silenciado}>
              <span>#{canal.name}</span>
              <span className={styles.ate}>{ateQuando(leitura[canal.id]?.mutedUntil ?? null)}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void api(`/channels/${canal.id}/mute`, { method: 'DELETE' });
                }}
              >
                Reativar
              </Button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function dicaDaPermissao(estado: EstadoDaPermissao): string {
  switch (estado) {
    case 'concedida':
      return 'Permitido pelo navegador ✓';
    case 'negada':
      // Só o navegador desfaz isso, e dizer onde é mais útil que insistir.
      return 'O navegador bloqueou. Libere nas permissões do site.';
    case 'indisponivel':
      return 'Este navegador não tem notificações de área de trabalho.';
    default:
      return 'A permissão é pedida na primeira menção que você receber.';
  }
}

/** "até 15:30", "até 4 de setembro", ou "até você ligar". */
export function ateQuando(iso: string | null, agora = new Date()): string {
  if (!iso) return '';
  const alvo = new Date(iso);

  // Dez anos é o "até eu ligar" do menu: dizer a data seria absurdo.
  const dias = (alvo.getTime() - agora.getTime()) / 86_400_000;
  if (dias > 365) return 'até você ligar';

  const mesmoDia = alvo.toDateString() === agora.toDateString();
  return mesmoDia
    ? `até ${alvo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : `até ${alvo.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}`;
}
