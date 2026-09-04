import { useMemo } from 'react';
import type { Channel, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import {
  Expandir,
  Headphones,
  HeadphonesOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from '../../components/icones';
import { naChamada, useVoz } from './store';
import { useChamada } from './useChamada';
import styles from './voz.module.css';

/**
 * A barra de chamada, acima do elenco.
 *
 * A borda superior de 2px em `--live` é o sinal principal, e é a **única borda
 * saturada da interface inteira** — é por isso que é impossível esquecer que o
 * microfone está aberto. Ver design/07-chamada.md.
 *
 * Nenhum estado desligado é indicado só por cor: o ícone cortado pela diagonal
 * diz a mesma coisa em preto e branco.
 */
export function BarraDeChamada({
  canais,
  pessoas,
}: {
  canais: Channel[];
  pessoas: User[];
}) {
  const fase = useVoz((s) => s.fase);
  const channelId = useVoz((s) => s.channelId);
  const muted = useVoz((s) => s.muted);
  const deafened = useVoz((s) => s.deafened);
  const qualidade = useVoz((s) => s.qualidade);
  const erro = useVoz((s) => s.erro);
  const falando = useVoz((s) => s.falando);
  const audioBloqueado = useVoz((s) => s.audioBloqueado);
  const estados = useVoz((s) => s.estados);

  const camera = useVoz((s) => s.camera);
  const grade = useVoz((s) => s.grade);
  const { entrar, sair, alternarMudo, alternarSurdo, alternarCamera, alternarGrade, destravarAudio } =
    useChamada();

  const canal = canais.find((c) => c.id === channelId);
  const dentro = useMemo(
    () => (channelId ? naChamada(estados, channelId) : []),
    [estados, channelId],
  );

  if (fase === 'fora' || !channelId) return null;

  const conectado = fase === 'conectado';
  const rotulo =
    fase === 'conectando'
      ? 'Conectando…'
      : fase === 'reconectando'
        ? 'Reconectando…'
        : fase === 'falhou'
          ? 'Não foi possível conectar'
          : 'Conectado';

  return (
    <section className={styles.barra} data-fase={fase} aria-label="Chamada em andamento">
      <div className={styles.linhaStatus}>
        <span className={styles.ponto} aria-hidden="true" />
        <span className={styles.rotulo}>{rotulo}</span>
        {canal ? <span className={styles.canal}>· {canal.name}</span> : null}
        {conectado ? <Qualidade nivel={qualidade} /> : null}
      </div>

      {fase === 'falhou' ? (
        <div className={styles.linhaErro}>
          <span>{erro}</span>
          <button type="button" className={styles.tentar} onClick={() => void entrar(channelId)}>
            Tentar de novo
          </button>
        </div>
      ) : null}

      {audioBloqueado ? (
        // O navegador barra som que começa sem interação. Um clique resolve, e
        // dizer isso é melhor que uma chamada silenciosa sem explicação.
        <div className={styles.linhaErro}>
          <span>O navegador pausou o áudio.</span>
          <button type="button" className={styles.tentar} onClick={destravarAudio}>
            Ouvir
          </button>
        </div>
      ) : null}

      {dentro.length > 0 ? (
        <div className={styles.avatares}>
          {dentro.map((estado) => {
            const pessoa = pessoas.find((p) => p.id === estado.userId);
            if (!pessoa) return null;
            return (
              <span
                key={estado.userId}
                className={styles.avatarNaChamada}
                data-falando={falando.has(estado.userId)}
                title={pessoa.displayName}
              >
                <Avatar id={pessoa.id} name={pessoa.displayName} src={pessoa.avatarUrl} size="xs" />
              </span>
            );
          })}
        </div>
      ) : null}

      <div className={styles.controles}>
        <Tooltip label={muted ? 'Abrir microfone' : 'Fechar microfone'}>
          <button
            type="button"
            className={styles.controle}
            data-desligado={muted}
            aria-pressed={!muted}
            aria-label={muted ? 'Microfone fechado' : 'Microfone aberto'}
            disabled={!conectado}
            onClick={alternarMudo}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        </Tooltip>

        <Tooltip label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}>
          <button
            type="button"
            className={styles.controle}
            data-desligado={deafened}
            aria-pressed={!deafened}
            aria-label={deafened ? 'Áudio desligado' : 'Áudio ligado'}
            disabled={!conectado}
            onClick={alternarSurdo}
          >
            {deafened ? <HeadphonesOff size={18} /> : <Headphones size={18} />}
          </button>
        </Tooltip>

        <Tooltip label={camera ? 'Desligar a câmera' : 'Ligar a câmera'}>
          <button
            type="button"
            className={styles.controle}
            // Só `data-aceso`: câmera desligada é o estado normal dela, não um
            // alerta, então não leva o vermelho que os outros dois levam.
            data-aceso={camera}
            aria-pressed={camera}
            aria-label={camera ? 'Câmera ligada' : 'Câmera desligada'}
            disabled={!conectado}
            onClick={alternarCamera}
          >
            {camera ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
        </Tooltip>

        <Tooltip label={grade ? 'Fechar a grade' : 'Ver quem está na chamada'}>
          <button
            type="button"
            className={styles.controle}
            aria-pressed={grade}
            aria-label="Grade de participantes"
            disabled={!conectado}
            onClick={alternarGrade}
          >
            <Expandir size={18} />
          </button>
        </Tooltip>

        {/* Ação destrutiva com rótulo explícito, e longe dos outros: "Sair" em
            texto, não um ícone a mais na fileira. Não pede confirmação. */}
        <button type="button" className={styles.sair} onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </section>
  );
}

const TEXTO: Record<string, string> = {
  boa: 'Conexão boa',
  media: 'Conexão instável',
  ruim: 'Conexão ruim. O vídeo foi reduzido.',
  desconhecida: 'Medindo a conexão…',
};

/**
 * Três barras.
 *
 * Explicar por que a imagem piorou evita que a pessoa culpe o produto — por
 * isso o texto do hover diz o efeito, e não só o nível.
 */
function Qualidade({ nivel }: { nivel: string }) {
  return (
    <Tooltip label={TEXTO[nivel] ?? ''}>
      <span className={styles.qualidade} data-nivel={nivel} role="img" aria-label={TEXTO[nivel]}>
        <i />
        <i />
        <i />
      </span>
    </Tooltip>
  );
}
