import { useEffect, useMemo } from 'react';
import type { Channel, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import {
  Board,
  Expandir,
  Monitor,
  Headphones,
  HeadphonesOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from '../../components/icones';
import { DialogoDeTela } from './DialogoDeTela';
import { emMbps, presetPorId, redeLimitando } from './presets';
import { lerPreferencias } from '../../lib/preferencias';
import * as sala from './sala';
import type { EstatisticasDaTela } from './sala';
import { naChamada, useVoz } from './store';
import { useQuadroAberto } from '../boards/store';
import { useApresentacoes, apresentacaoNoCanal } from '../boards/apresentacoes';
import { useQuadros } from '../boards/queries';
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
  const modo = useVoz((s) => s.modo);
  const podeCompartilhar = useVoz((s) => s.podeCompartilhar);
  const transmitindo = useVoz((s) => s.transmitindo);
  const escolhendoTela = useVoz((s) => s.escolhendoTela);
  const estatisticas = useVoz((s) => s.estatisticas);
  const participantes = useVoz((s) => s.participantes);
  const {
    entrar,
    sair,
    alternarMudo,
    alternarSurdo,
    alternarCamera,
    alternarGrade,
    escolherTela,
    pararDeTransmitir,
    destravarAudio,
  } = useChamada();

  /* O bitrate exibido é o **real**, do `getStats`, a cada 2s — e não o alvo do
     preset. A linha existe para explicar por que a imagem piorou, e para isso
     tem de contar o que está acontecendo, não o que foi pedido. */
  useEffect(() => {
    if (!transmitindo) return;
    let vivo = true;
    const ler = () => {
      void sala.estatisticasDaTela().then((e) => {
        if (vivo) useVoz.getState().definir({ estatisticas: e });
      });
    };
    ler();
    const relogio = setInterval(ler, 2000);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [transmitindo]);

  /* A medição de upload dos primeiros segundos vira a linha "Sua conexão
     suporta até" no seletor de preset. Feita uma vez, e depois de a chamada
     assentar: medir no instante da conexão mede o aperto do começo. */
  useEffect(() => {
    if (fase !== 'conectado') return;
    const espera = setTimeout(() => {
      void sala.bandaDeSubida().then((b) => useVoz.getState().definir({ bandaDeSubida: b }));
    }, 5000);
    return () => clearTimeout(espera);
  }, [fase]);

  const canal = canais.find((c) => c.id === channelId);

  /* O quadro a que este botão leva: o que está sendo apresentado no canal da
     chamada, ou o mais recente dele. */
  const canalDaChamada = canal;
  const quadroAberto = useQuadroAberto((s) => s.aberto);
  const abrirQuadro = useQuadroAberto((s) => s.abrir);
  const apresentacao = useApresentacoes((s) =>
    canal ? apresentacaoNoCanal(s.porQuadro, canal.id) : undefined,
  );
  const { data: quadrosDoCanal } = useQuadros(canal?.id);
  const quadroParaAbrir = apresentacao?.boardId ?? quadrosDoCanal?.[0]?.id ?? null;

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

      {transmitindo ? <LinhaDaTransmissao estatisticas={estatisticas} participantes={participantes} /> : null}

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

        {podeCompartilhar ? (
          <Tooltip label={transmitindo ? 'Parar de transmitir' : 'Compartilhar tela'}>
            <button
              type="button"
              className={styles.controle}
              data-aceso={transmitindo}
              aria-pressed={transmitindo}
              aria-label={transmitindo ? 'Transmitindo' : 'Compartilhar tela'}
              disabled={!conectado}
              onClick={() => (transmitindo ? pararDeTransmitir() : escolherTela(true))}
            >
              <Monitor size={18} />
            </button>
          </Tooltip>
        ) : null}

        {/* O quadro fica a um clique de dentro da chamada: desenhar junto e
            falar junto são a mesma reunião, e trocar entre as duas telas não
            pode custar navegação. Ver design/11-quadro.md. */}
        {/* Só o caminho de ida: com o quadro aberto esta barra está atrás
            dele, e quem volta usa o botão da janela flutuante ou o do próprio
            quadro. Três controles com o mesmo nome na tela seria pior que
            dois caminhos. */}
        {canalDaChamada && quadroParaAbrir && !quadroAberto ? (
          <Tooltip label="Ir para o quadro">
            <button
              type="button"
              className={styles.controle}
              aria-label="Ir para o quadro"
              onClick={() => abrirQuadro(quadroParaAbrir, canalDaChamada.id)}
            >
              <Board size={18} />
            </button>
          </Tooltip>
        ) : null}

        <Tooltip label={modo === 'mensagens' ? 'Ver quem está na chamada' : 'Voltar à conversa'}>
          <button
            type="button"
            className={styles.controle}
            aria-pressed={modo !== 'mensagens'}
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

      <DialogoDeTela aberto={escolhendoTela} onFechar={() => escolherTela(false)} />
    </section>
  );
}

/**
 * O que a barra mostra enquanto você transmite.
 *
 * O contador de espectadores é o mais útil daqui: transmitir para ninguém é
 * comum, e a pessoa deve saber.
 */
function LinhaDaTransmissao({
  estatisticas,
  participantes,
}: {
  estatisticas: EstatisticasDaTela | null;
  participantes: { eu: boolean; espectadores: number }[];
}) {
  const preset = presetPorId(lerPreferencias().presetDeTela);
  const eu = participantes.find((p) => p.eu);
  const quantos = eu?.espectadores ?? 0;
  const limitando = estatisticas ? redeLimitando(estatisticas.motivo) : false;

  return (
    <div className={styles.transmissao}>
      <span className={styles.linhaStatus}>
        <Monitor size={14} /> Você está transmitindo
      </span>
      <span className={styles.detalheDaTela}>
        {preset.nome}
        {estatisticas && estatisticas.largura > 0
          ? ` · ${estatisticas.largura}×${estatisticas.altura}${estatisticas.fps ? `@${estatisticas.fps}` : ''}`
          : ''}
        {estatisticas && estatisticas.bitrate > 0 ? ` · ${emMbps(estatisticas.bitrate)}` : ''}
      </span>
      {/* Explicar por que a imagem piorou evita que a pessoa culpe o produto. */}
      {limitando && estatisticas ? (
        <span className={styles.limitando}>Rede limitando a {emMbps(estatisticas.bitrate)}</span>
      ) : null}
      {estatisticas?.motivo === 'cpu' ? (
        <span className={styles.limitando}>
          A máquina não está dando conta. Um preset menor ajuda.
        </span>
      ) : null}
      <span className={styles.detalheDaTela}>
        {quantos === 0 ? 'ninguém assistindo' : `${quantos} assistindo`}
      </span>
    </div>
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
