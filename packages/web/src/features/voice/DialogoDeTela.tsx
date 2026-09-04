import { useEffect, useState } from 'react';
import { Button, Dialog, Toggle } from '../../components';
import { lerPreferencias } from '../../lib/preferencias';
import {
  PRESETS,
  acimaDoSuportado,
  emMbps,
  presetPorId,
  suportadoPor,
  type IdDePreset,
} from './presets';
import { useVoz } from './store';
import { useChamada } from './useChamada';
import styles from './tela.module.css';

/**
 * A escolha antes do seletor nativo.
 *
 * Uma tela só, e rápida: dois cliques do ícone à transmissão no caminho comum.
 * Os presets são nomeados por finalidade, com os números ao lado — quem escolhe
 * sabe o que vai mostrar, não quantos megabits precisa.
 * Ver design/12-compartilhamento-de-tela.md.
 */
export function DialogoDeTela({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const banda = useVoz((s) => s.bandaDeSubida);
  const { transmitir } = useChamada();

  const [preset, setPreset] = useState<IdDePreset>(
    () => presetPorId(lerPreferencias().presetDeTela).id,
  );
  const [comAudio, setComAudio] = useState(() => lerPreferencias().audioDaTela);

  // Reabrir o diálogo reapresenta a última escolha, não a de duas semanas
  // atrás: quem transmite duas vezes seguidas quase sempre quer o mesmo.
  useEffect(() => {
    if (!aberto) return;
    const prefs = lerPreferencias();
    setPreset(presetPorId(prefs.presetDeTela).id);
    setComAudio(prefs.audioDaTela && audioDoSistema().pode);
  }, [aberto]);

  const suportado = suportadoPor(banda);
  const audio = audioDoSistema();

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => !v && onFechar()}
      title="Compartilhar tela"
      footer={
        <div className={styles.acoes}>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          {/* Nada de `await` no caminho: o Safari só abre o seletor de tela
              dentro da mesma pilha do clique. */}
          <Button
            onClick={() => {
              transmitir(preset, comAudio);
              onFechar();
            }}
          >
            Escolher
          </Button>
        </div>
      }
    >
      <fieldset className={styles.presets}>
        <legend className={styles.legenda}>Qualidade</legend>
        {PRESETS.map((p) => (
          <label key={p.id} className={styles.preset}>
            <input
              type="radio"
              name="preset"
              value={p.id}
              checked={preset === p.id}
              onChange={() => setPreset(p.id)}
            />
            <span className={styles.nome}>{p.nome}</span>
            <span className={styles.detalhe}>{p.detalhe}</span>
            {acimaDoSuportado(p, suportado) ? (
              // Disponível, com aviso: a pessoa pode tentar; o produto só não
              // finge que vai funcionar.
              <span className={styles.aviso}>acima da sua conexão</span>
            ) : null}
          </label>
        ))}
      </fieldset>

      {/* Desabilitada **com o motivo**, nunca escondida: sumir com o controle
          faz a pessoa procurar por ele. */}
      <div className={styles.linhaAudio}>
        <Toggle
          checked={comAudio && audio.pode}
          onChange={setComAudio}
          disabled={!audio.pode}
          label="Incluir áudio do sistema"
          {...(audio.motivo ? { hint: audio.motivo } : {})}
        />
      </div>

      {suportado ? (
        <p className={styles.banda}>
          Sua conexão suporta até: <strong>{suportado.nome}</strong>
          {banda ? <span className={styles.medida}> ({emMbps(banda)})</span> : null}
        </p>
      ) : null}

    </Dialog>
  );
}

/**
 * Áudio do sistema: onde há e onde não há.
 *
 * É o único lugar do produto que olha o `userAgent`, e por falta de alternativa
 * — não existe API que responda "esta plataforma captura o som das caixas".
 * A tabela está em design/12-compartilhamento-de-tela.md; o que muda aqui é só
 * o texto que a pessoa lê.
 */
export function audioDoSistema(): { pode: boolean; motivo: string } {
  if (typeof navigator === 'undefined') return { pode: false, motivo: '' };
  const ua = navigator.userAgent;
  const chromium = /Chrome|Chromium|Edg/.test(ua) && !/Firefox/.test(ua);

  if (!chromium) {
    return {
      pode: false,
      motivo: 'Este navegador não captura o áudio do sistema. A imagem vai; o som, não.',
    };
  }
  if (/Macintosh/.test(ua)) {
    return {
      pode: false,
      motivo: 'No macOS o navegador só captura o áudio de uma aba, não o do sistema.',
    };
  }
  return { pode: true, motivo: '' };
}
