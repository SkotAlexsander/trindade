import { useEffect, useRef } from 'react';
import type { Channel, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import {
  Headphones,
  HeadphonesOff,
  Mic,
  MicOff,
  Monitor,
  Video,
  VideoOff,
  X,
} from '../../components/icones';
import type { Participante } from './sala';
import { TelaEmFoco } from './TelaEmFoco';
import { useVoz, type ModoDaSala } from './store';
import { useChamada } from './useChamada';
import styles from './grade.module.css';

const MODOS: { id: ModoDaSala; nome: string }[] = [
  { id: 'chamada', nome: 'Só a chamada' },
  { id: 'ambos', nome: 'As duas' },
  { id: 'mensagens', nome: 'Só a conversa' },
];

/**
 * A grade da chamada.
 *
 * **Divide a coluna da conversa, e não uma janela nova.** O que está sendo dito
 * na chamada e o que está escrito no canal são a mesma sala; uma janela
 * separaria as duas coisas e obrigaria a escolher uma. Aqui a escolha existe,
 * mas é de quem está na sala e tem três respostas — inclusive "as duas".
 *
 * **Cada tela transmitida é uma caixa própria**, ao lado das pessoas, e não uma
 * troca de layout: quem transmite continua sendo alguém na chamada, e a tela é
 * mais uma coisa acontecendo. Clicar na caixa põe aquela tela em primeiro plano.
 * Ver design/07-chamada.md e design/12-compartilhamento-de-tela.md.
 */
export function GradeDaChamada({ canais, pessoas }: { canais: Channel[]; pessoas: User[] }) {
  const modo = useVoz((s) => s.modo);
  const fase = useVoz((s) => s.fase);
  const channelId = useVoz((s) => s.channelId);
  const participantes = useVoz((s) => s.participantes);
  const falando = useVoz((s) => s.falando);
  const muted = useVoz((s) => s.muted);
  const deafened = useVoz((s) => s.deafened);
  const camera = useVoz((s) => s.camera);
  const estados = useVoz((s) => s.estados);
  const telaEmFoco = useVoz((s) => s.telaEmFoco);
  const qualidadeDoEspectador = useVoz((s) => s.qualidadeDoEspectador);
  const podeCompartilhar = useVoz((s) => s.podeCompartilhar);
  const transmitindo = useVoz((s) => s.transmitindo);
  const apontamentos = useVoz((s) => s.apontamentos);

  const {
    sair,
    alternarMudo,
    alternarSurdo,
    alternarCamera,
    alternarGrade,
    definirModo,
    assistir,
    focar,
    pararDeTransmitir,
    escolherTela,
    definirQualidadeDoEspectador,
    apontar,
  } = useChamada();

  if (modo === 'mensagens' || fase === 'fora') return null;

  const canal = canais.find((c) => c.id === channelId);
  const quantos = participantes.length;
  const emFoco = participantes.find((p) => p.identity === telaEmFoco && p.tela) ?? null;
  const nomeDe = (p: Participante) =>
    pessoas.find((u) => u.id === p.identity)?.displayName ?? 'Alguém';

  // Uma caixa por pessoa, mais uma por tela transmitida.
  const azulejos = [
    ...participantes.map((p) => ({ chave: `p:${p.identity}`, tela: false, p })),
    ...participantes
      .filter((x) => x.transmitindo)
      .map((p) => ({ chave: `t:${p.identity}`, tela: true, p })),
  ];

  return (
    <section className={styles.grade} aria-label="Participantes da chamada">
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>
          {canal?.name ?? 'Chamada'}{' '}
          <span className={styles.contagem}>
            · {quantos} {quantos === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </h2>

        {/* Três estados, e não um botão de fechar: numa chamada há gente
            falando e gente escrevendo ao mesmo tempo, e qual das duas ocupa a
            tela é escolha de quem está na sala — não nossa. */}
        <div className={styles.modos} role="group" aria-label="O que mostrar">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={styles.modo}
              data-ativo={modo === m.id}
              aria-pressed={modo === m.id}
              onClick={() => definirModo(m.id)}
            >
              {m.nome}
            </button>
          ))}
        </div>

        <Tooltip label="Voltar à conversa">
          <button
            type="button"
            className={styles.fechar}
            aria-label="Voltar à conversa"
            onClick={alternarGrade}
          >
            <X size={18} />
          </button>
        </Tooltip>
      </header>

      {emFoco ? (
        <div className={styles.comFoco}>
          <TelaEmFoco
            participante={emFoco}
            nome={nomeDe(emFoco)}
            qualidade={qualidadeDoEspectador}
            onQualidade={definirQualidadeDoEspectador}
            onFechar={() => focar(null)}
            apontamentos={emFoco.eu ? apontamentos : []}
            onApontar={apontar}
          />
          <div className={styles.fileira}>
            {azulejos.map((a) => (
              <Azulejo
                key={a.chave}
                {...a}
                nome={nomeDe(a.p)}
                pessoa={pessoas.find((u) => u.id === a.p.identity)}
                falando={falando.has(a.p.identity)}
                mudo={a.p.eu ? muted : (estados[a.p.identity]?.muted ?? false)}
                onAssistir={assistir}
                onFocar={focar}
                compacto
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.cartoes} data-quantidade={Math.min(azulejos.length, 5)}>
          {azulejos.map((a) => (
            <Azulejo
              key={a.chave}
              {...a}
              nome={nomeDe(a.p)}
              pessoa={pessoas.find((u) => u.id === a.p.identity)}
              falando={falando.has(a.p.identity)}
              mudo={a.p.eu ? muted : (estados[a.p.identity]?.muted ?? false)}
              onAssistir={assistir}
              onFocar={focar}
            />
          ))}

          {/* Dentro da grade, e não flutuando no topo: o aviso pertence à
              caixa solitária que está logo acima dele. */}
          {quantos <= 1 ? <p className={styles.sozinho}>Você está sozinho na sala.</p> : null}
        </div>
      )}

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

        {/* Sem `SHARE_SCREEN` o botão não existe — e o token também não
            deixaria publicar a trilha. As duas coisas, sempre. */}
        {podeCompartilhar ? (
          <Botao
            rotulo={transmitindo ? 'Parar de transmitir' : 'Compartilhar tela'}
            estado={transmitindo ? 'Transmitindo' : 'Compartilhar tela'}
            desligado={false}
            pressionado={transmitindo}
            aceso={transmitindo}
            onClick={() => (transmitindo ? pararDeTransmitir() : escolherTela(true))}
          >
            <Monitor size={20} />
          </Botao>
        ) : null}

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

interface PropsDeAzulejo {
  p: Participante;
  tela: boolean;
  nome: string;
  pessoa: User | undefined;
  falando: boolean;
  mudo: boolean;
  onAssistir: (identity: string, ligar: boolean) => void;
  onFocar: (identity: string | null) => void;
  /** Na fileira lateral de 160px não cabe convite: fica o essencial. */
  compacto?: boolean;
}

function Azulejo(props: PropsDeAzulejo) {
  return props.tela ? <CaixaDeTela {...props} /> : <CaixaDePessoa {...props} />;
}

/** Liga a trilha ao elemento e desliga ao sair. O SDK cuida do resto. */
function useTrilhaDeVideo(trilha: Participante['video']) {
  const elemento = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const alvo = elemento.current;
    if (!trilha || !alvo) return;
    trilha.attach(alvo);
    return () => {
      trilha.detach(alvo);
    };
  }, [trilha]);

  return elemento;
}

/**
 * Sem câmera o cartão **não** é um retângulo preto: é o avatar sobre
 * `--bg-raised`. Vídeo desligado e vídeo travado precisam ser distinguíveis de
 * relance.
 */
function CaixaDePessoa({ p, nome, pessoa, falando, mudo }: PropsDeAzulejo) {
  const video = useTrilhaDeVideo(p.video);

  return (
    <div
      className={styles.cartao}
      data-falando={falando}
      // Quem está falando não é indicado só por cor: o rótulo diz.
      aria-label={falando ? `${nome}, falando` : nome}
    >
      {p.video ? (
        <video
          ref={video}
          className={styles.video}
          // A prévia é espelhada **só para você**. A trilha publicada não é —
          // texto ao contrário na camiseta de alguém é o sintoma de quem
          // espelhou a trilha em vez da apresentação.
          data-espelhado={p.eu}
          autoPlay
          playsInline
          muted={p.eu}
        />
      ) : (
        <span className={styles.semVideo}>
          <Avatar id={p.identity} name={nome} src={pessoa?.avatarUrl} size="xl" />
        </span>
      )}

      <footer className={styles.rodape}>
        <span className={styles.nome}>{p.eu ? 'Você' : nome}</span>
        {mudo ? (
          <span className={styles.mudo} aria-label="microfone fechado">
            <MicOff size={14} />
          </span>
        ) : null}
      </footer>
    </div>
  );
}

/**
 * A tela transmitida, na própria caixa.
 *
 * Enquanto ninguém clica em "Assistir", a caixa é um convite e o servidor não
 * envia um byte daquela tela — o custo de uma tela em 4K é pago só por quem
 * está olhando. Depois de aceito, clicar na caixa põe a tela em primeiro plano.
 */
function CaixaDeTela({ p, nome, onAssistir, onFocar, compacto = false }: PropsDeAzulejo) {
  const video = useTrilhaDeVideo(p.tela);
  const rotulo = p.eu ? 'Sua tela' : `Tela de ${nome}`;

  if (!p.assistindo) {
    return (
      <div className={styles.cartao} data-tela="true">
        <span className={styles.transmitindo} data-compacto={compacto}>
          <Monitor size={compacto ? 20 : 28} />
          {compacto ? null : (
            <>
              <strong>{nome}</strong>
              <span>está transmitindo</span>
            </>
          )}
          <button
            type="button"
            className={styles.assistir}
            onClick={() => onAssistir(p.identity, true)}
          >
            Assistir
          </button>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.cartao}
      data-tela="true"
      aria-label={`${rotulo}. Clique para ver em primeiro plano.`}
      onClick={() => onFocar(p.identity)}
    >
      {/* `contain`, nunca `cover`: cortar a tela de alguém para preencher o
          quadro esconde justamente o canto onde estava o que ela queria
          mostrar. */}
      <video ref={video} className={styles.videoDeTela} autoPlay playsInline muted />
      <footer className={styles.rodape}>
        <span className={styles.nome}>
          <Monitor size={12} /> {rotulo}
        </span>
      </footer>
    </button>
  );
}
