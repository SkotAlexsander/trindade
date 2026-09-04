import { useEffect, useRef } from 'react';
import type { Channel, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import {
  Headphones,
  HeadphonesOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  X,
} from '../../components/icones';
import type { Participante } from './sala';
import { useVoz } from './store';
import { useChamada } from './useChamada';
import styles from './grade.module.css';

/**
 * A grade de participantes.
 *
 * **Sobreposição sobre a conversa, não janela nova.** O que está sendo dito na
 * chamada e o que está escrito no canal são a mesma sala; abrir uma janela
 * separaria as duas coisas e obrigaria a escolher uma.
 *
 * Layout automático: 1 ocupa tudo, 2 lado a lado, 3 e 4 em 2x2, 5 em 3+2.
 * Ver design/07-chamada.md.
 */
export function GradeDaChamada({ canais, pessoas }: { canais: Channel[]; pessoas: User[] }) {
  const grade = useVoz((s) => s.grade);
  const fase = useVoz((s) => s.fase);
  const channelId = useVoz((s) => s.channelId);
  const participantes = useVoz((s) => s.participantes);
  const falando = useVoz((s) => s.falando);
  const muted = useVoz((s) => s.muted);
  const deafened = useVoz((s) => s.deafened);
  const camera = useVoz((s) => s.camera);
  const estados = useVoz((s) => s.estados);

  const { sair, alternarMudo, alternarSurdo, alternarCamera, alternarGrade } = useChamada();

  if (!grade || fase === 'fora') return null;

  const canal = canais.find((c) => c.id === channelId);
  const quantos = participantes.length;

  return (
    <section className={styles.grade} aria-label="Participantes da chamada">
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>
          {canal?.name ?? 'Chamada'}{' '}
          <span className={styles.contagem}>
            · {quantos} {quantos === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </h2>
        <Tooltip label="Fechar a grade">
          <button
            type="button"
            className={styles.fechar}
            aria-label="Fechar a grade"
            onClick={alternarGrade}
          >
            <X size={18} />
          </button>
        </Tooltip>
      </header>

      {quantos <= 1 ? (
        <p className={styles.sozinho}>Você está sozinho na sala.</p>
      ) : null}

      <div className={styles.cartoes} data-quantidade={Math.min(quantos, 5)}>
        {participantes.map((p) => (
          <Cartao
            key={p.identity}
            participante={p}
            pessoa={pessoas.find((u) => u.id === p.identity)}
            falando={falando.has(p.identity)}
            mudo={p.eu ? muted : (estados[p.identity]?.muted ?? false)}
          />
        ))}
      </div>

      <div className={styles.controles}>
        <Botao
          rotulo={muted ? 'Abrir microfone' : 'Fechar microfone'}
          estado={muted ? 'Microfone fechado' : 'Microfone aberto'}
          desligado={muted}
          onClick={alternarMudo}
        >
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </Botao>

        <Botao
          rotulo={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
          estado={deafened ? 'Áudio desligado' : 'Áudio ligado'}
          desligado={deafened}
          onClick={alternarSurdo}
        >
          {deafened ? <HeadphonesOff size={20} /> : <Headphones size={20} />}
        </Botao>

        {/* `desligado` fica falso de propósito: câmera apagada é o estado
            normal dela, e o vermelho dos outros dois diria que algo falhou. */}
        <Botao
          rotulo={camera ? 'Desligar a câmera' : 'Ligar a câmera'}
          estado={camera ? 'Câmera ligada' : 'Câmera desligada'}
          desligado={false}
          pressionado={camera}
          aceso={camera}
          onClick={alternarCamera}
        >
          {camera ? <Video size={20} /> : <VideoOff size={20} />}
        </Botao>

        {/* Separado fisicamente dos outros: distância evita clique acidental. */}
        <button type="button" className={styles.sair} onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </section>
  );
}

function Botao({
  rotulo,
  estado,
  desligado,
  pressionado,
  aceso = false,
  onClick,
  children,
}: {
  rotulo: string;
  estado: string;
  desligado: boolean;
  /** Quando difere de `!desligado` — a câmera, que desligada não é alerta. */
  pressionado?: boolean;
  aceso?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={rotulo}>
      <button
        type="button"
        className={styles.controle}
        data-desligado={desligado}
        data-aceso={aceso}
        aria-pressed={pressionado ?? !desligado}
        aria-label={estado}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Sem câmera o cartão **não** é um retângulo preto: é o avatar de 80px sobre
 * `--bg-raised`. Vídeo desligado e vídeo travado precisam ser distinguíveis de
 * relance.
 */
function Cartao({
  participante,
  pessoa,
  falando,
  mudo,
}: {
  participante: Participante;
  pessoa: User | undefined;
  falando: boolean;
  mudo: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const trilha = participante.video;
    const elemento = video.current;
    if (!trilha || !elemento) return;
    trilha.attach(elemento);
    return () => {
      trilha.detach(elemento);
    };
  }, [participante.video]);

  const nome = pessoa?.displayName ?? 'Alguém';

  return (
    <div
      className={styles.cartao}
      data-falando={falando}
      // Quem está falando não é indicado só por cor: o rótulo diz.
      aria-label={falando ? `${nome}, falando` : nome}
    >
      {participante.video ? (
        <video
          ref={video}
          className={styles.video}
          // A prévia é espelhada **só para você**. A trilha publicada não é —
          // texto ao contrário na camiseta de alguém é o sintoma de quem
          // espelhou a trilha em vez da apresentação.
          data-espelhado={participante.eu}
          autoPlay
          playsInline
          muted={participante.eu}
        />
      ) : (
        <span className={styles.semVideo}>
          <Avatar id={participante.identity} name={nome} src={pessoa?.avatarUrl} size="xl" />
        </span>
      )}

      <footer className={styles.rodape}>
        <span className={styles.nome}>{participante.eu ? 'Você' : nome}</span>
        {mudo ? (
          <span className={styles.mudo} aria-label="microfone fechado">
            <MicOff size={14} />
          </span>
        ) : null}
      </footer>
    </div>
  );
}
