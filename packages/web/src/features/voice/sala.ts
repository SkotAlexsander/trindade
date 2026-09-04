import {
  ConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  VideoPreset,
  VideoPresets,
  VideoQuality,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteParticipant,
  type RemoteVideoTrack,
} from 'livekit-client';
import type { CadeiaDeEntrada } from '../../lib/midia';
import { abrirCamera, aplicarSaida, encerrar, podeEscolherSaida } from '../../lib/midia';
import { lerPreferencias } from '../../lib/preferencias';
import { camadasDe, type MotivoDeLimitacao, type Preset } from './presets';
import type { FaseDaChamada, Qualidade } from './store';

/**
 * A sala do LiveKit. O único módulo que importa `livekit-client`.
 *
 * **`iceTransportPolicy: 'relay'` é a linha inteira do requisito de
 * privacidade desta fase.** Sem ela o navegador tenta a conexão direta
 * primeiro, e o endereço de cada participante já foi para o outro lado na
 * negociação — bloquear depois não desfaz nada. Ver docs/06-realtime-e-webrtc.md.
 */

export interface Retornos {
  aoMudarFase: (fase: FaseDaChamada, erro?: string) => void;
  aoFalar: (identidades: ReadonlySet<string>) => void;
  aoMudarQualidade: (qualidade: Qualidade) => void;
  /** O navegador barrou o áudio até haver um clique na página. */
  aoBloquearAudio: (bloqueado: boolean) => void;
  /** Alguém entrou, saiu, ligou ou desligou a câmera. */
  aoMudarParticipantes: (lista: Participante[]) => void;
  /** A trilha de vídeo morreu sozinha — aparelho removido, outro programa. */
  aoCairACamera: () => void;
}

/**
 * O que a grade precisa saber de cada pessoa.
 *
 * A trilha vai junto, e não um identificador dela: quem desenha o cartão chama
 * `attach` no elemento de vídeo, e é o SDK que cuida do resto.
 */
export interface Participante {
  identity: string;
  eu: boolean;
  video: RemoteVideoTrack | LocalVideoTrack | null;
  /** Tem uma tela publicada — o cartão vira "está transmitindo". */
  transmitindo: boolean;
  /** Você assinou essa tela. Até clicar, o servidor não envia nada dela. */
  assistindo: boolean;
  tela: RemoteVideoTrack | LocalVideoTrack | null;
  /** Só na sua própria: quantos estão assistindo agora. */
  espectadores: number;
}

export interface Credenciais {
  wsUrl: string;
  token: string;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
}

let sala: Room | null = null;
let publicacao: LocalTrackPublication | null = null;
let surdo = false;

export function salaAtual(): Room | null {
  return sala;
}

function traduzirQualidade(q: ConnectionQuality): Qualidade {
  if (q === ConnectionQuality.Excellent || q === ConnectionQuality.Good) return 'boa';
  if (q === ConnectionQuality.Poor) return 'ruim';
  return 'desconhecida';
}

/**
 * Entra, publicando a trilha que **já saiu do nosso grafo de áudio**.
 *
 * O LiveKit não captura nada aqui: quem captura é a `CadeiaDeEntrada`, porque é
 * lá que estão o ganho, o medidor e o portão de sensibilidade. Publicar a
 * trilha do destino do grafo é o que faz o volume de entrada e o limiar
 * chegarem aos outros — capturar de novo pelo SDK produziria duas trilhas do
 * mesmo microfone, uma delas sem tratamento nenhum.
 */
export async function entrar(
  credenciais: Credenciais,
  cadeia: CadeiaDeEntrada,
  retornos: Retornos,
): Promise<void> {
  await sair();

  const room = new Room({
    // Reduz o que se recebe de quem está fora da tela, e para de publicar
    // camadas que ninguém assiste. Juntos, metade do consumo numa chamada real.
    adaptiveStream: true,
    dynacast: true,
    // A trilha é do nosso grafo e continua viva depois de despublicada: quem a
    // encerra é `CadeiaDeEntrada.fechar`. Sem isto, sair de uma chamada mataria
    // a captura e a próxima entraria muda.
    stopLocalTrackOnUnpublish: false,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: { simulcast: true },
  });
  sala = room;

  room
    .on(RoomEvent.ActiveSpeakersChanged, (falantes) => {
      // O SDK já entrega isto com histerese. Animar a cada quadro de áudio é o
      // que produz o efeito estroboscópico com quatro pessoas conversando.
      retornos.aoFalar(new Set(falantes.map((p) => p.identity)));
    })
    .on(RoomEvent.ConnectionQualityChanged, (qualidade, participante) => {
      if (participante?.identity !== room.localParticipant.identity) return;
      retornos.aoMudarQualidade(traduzirQualidade(qualidade));
    })
    .on(RoomEvent.Reconnecting, () => retornos.aoMudarFase('reconectando'))
    .on(RoomEvent.Reconnected, () => retornos.aoMudarFase('conectado'))
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      retornos.aoBloquearAudio(!room.canPlaybackAudio);
    })
    .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      // Quem chega depois entra no mesmo volume: sem isto, ensurdecer valeria
      // só para quem já estava na sala.
      if (surdo) p.setVolume(0);
      avisarParticipantes(retornos);
    })
    .on(RoomEvent.ParticipantDisconnected, (p) => {
      espectadoresDaMinhaTela.delete(p.identity);
      avisarParticipantes(retornos);
    })
    .on(RoomEvent.TrackPublished, (publicacao) => {
      // A contrapartida do `autoSubscribe: false`: tudo que não é tela é
      // assinado assim que aparece. Sem isto, ninguém ouviria ninguém.
      if (publicacao.source !== Track.Source.ScreenShare) publicacao.setSubscribed(true);
      avisarParticipantes(retornos);
    })
    .on(RoomEvent.TrackUnpublished, () => avisarParticipantes(retornos))
    .on(RoomEvent.DataReceived, (carga, participante) => {
      const aviso = lerAviso(carga);
      if (!aviso || !participante) return;
      // "Estou assistindo a sua tela." O SDK não conta espectadores por trilha,
      // e transmitir para ninguém é comum o bastante para valer um aviso.
      if (aviso.alvo !== room.localParticipant.identity) return;
      if (aviso.assistindo) espectadoresDaMinhaTela.add(participante.identity);
      else espectadoresDaMinhaTela.delete(participante.identity);
      avisarParticipantes(retornos);
    })
    .on(RoomEvent.TrackSubscribed, () => avisarParticipantes(retornos))
    .on(RoomEvent.TrackUnsubscribed, () => avisarParticipantes(retornos))
    .on(RoomEvent.TrackMuted, () => avisarParticipantes(retornos))
    .on(RoomEvent.TrackUnmuted, () => avisarParticipantes(retornos))
    .on(RoomEvent.LocalTrackPublished, () => avisarParticipantes(retornos))
    .on(RoomEvent.LocalTrackUnpublished, () => avisarParticipantes(retornos))
    .on(RoomEvent.Disconnected, (motivo) => {
      const esperado =
        motivo === DisconnectReason.CLIENT_INITIATED || motivo === undefined;
      retornos.aoMudarFase(
        esperado ? 'fora' : 'falhou',
        esperado ? undefined : 'A chamada caiu.',
      );
    });

  await room.connect(credenciais.wsUrl, credenciais.token, {
    rtcConfig: {
      iceServers: credenciais.iceServers,
      // Inegociável. Ver o cabeçalho deste arquivo.
      iceTransportPolicy: 'relay',
    },
    // **Assistir é opcional**, e é aqui que isso deixa de ser conversa: sem
    // assinatura automática, a tela de quem transmite não sai do servidor até
    // alguém clicar em "Assistir". Voz e câmera são assinadas na hora, logo
    // abaixo — o que se paga por escolha é a tela, que é o que custa caro.
    autoSubscribe: false,
  });

  publicacao =
    (await room.localParticipant.publishTrack(cadeia.trilha, {
      source: Track.Source.Microphone,
      // DTX cala o codec no silêncio e RED repete o quadro anterior contra
      // perda de pacote: as duas coisas que uma chamada de voz sempre quer.
      dtx: true,
      red: true,
    })) ?? null;

  await aplicarSaidaSalva(room);
  retornos.aoBloquearAudio(!room.canPlaybackAudio);
  avisarParticipantes(retornos);
}

/**
 * A grade inteira, refeita a cada evento.
 *
 * Recalcular tudo é mais barato do que manter um espelho do estado do SDK em
 * sincronia — e é a diferença entre um cartão fantasma de quem já saiu e nada.
 */
function avisarParticipantes(retornos: Retornos): void {
  if (!sala) return;
  const room = sala;

  const doParticipante = (p: {
    identity: string;
    getTrackPublication: (
      source: Track.Source,
    ) => { videoTrack?: unknown; isMuted: boolean; isSubscribed?: boolean } | undefined;
  }): Participante => {
    const eu = p.identity === room.localParticipant.identity;
    const pub = p.getTrackPublication(Track.Source.Camera);
    // Trilha muda não é trilha: quem desliga a câmera no meio some do vídeo
    // sem sair da grade, e o cartão volta a ser o avatar.
    const video = pub && !pub.isMuted ? ((pub.videoTrack as RemoteVideoTrack) ?? null) : null;

    const tela = p.getTrackPublication(Track.Source.ScreenShare);
    // **Assistir é opcional.** Enquanto ninguém clica, a publicação existe e a
    // assinatura não — e o servidor não manda um byte daquela tela.
    const assistindo = eu ? Boolean(tela) : Boolean(tela?.isSubscribed);
    return {
      identity: p.identity,
      eu,
      video,
      transmitindo: Boolean(tela),
      assistindo,
      tela: assistindo ? ((tela?.videoTrack as RemoteVideoTrack) ?? null) : null,
      espectadores: eu ? espectadoresDaMinhaTela.size : 0,
    };
  };

  retornos.aoMudarParticipantes([
    doParticipante(room.localParticipant),
    ...[...room.remoteParticipants.values()].map(doParticipante),
  ]);
}

let cameraLocal: MediaStream | null = null;
let publicacaoDeVideo: LocalTrackPublication | null = null;

/**
 * Liga e desliga a câmera.
 *
 * A permissão é pedida **aqui**, no clique, e não ao entrar na chamada: entrar
 * numa chamada de voz nunca acende a luz da câmera.
 * Ver docs/07-permissoes-do-navegador.md.
 */
export async function definirCamera(ligada: boolean, retornos: Retornos): Promise<void> {
  if (!sala) return;

  if (!ligada) {
    const trilhaPublicada = publicacaoDeVideo?.track;
    publicacaoDeVideo = null;
    if (trilhaPublicada) {
      await sala.localParticipant.unpublishTrack(trilhaPublicada);
      // `stopLocalTrackOnUnpublish` está desligado por causa do áudio, então
      // apagar a luz é responsabilidade nossa — e é uma responsabilidade séria:
      // luz acesa é o contrato de que alguém está sendo filmado. São duas
      // chamadas porque o SDK publica um **clone**: encerrar só o nosso stream
      // deixaria o clone vivo, com a luz acesa e ninguém vendo.
      trilhaPublicada.stop();
    }
    encerrar(cameraLocal);
    cameraLocal = null;
    avisarParticipantes(retornos);
    return;
  }

  const prefs = lerPreferencias();
  const stream = await abrirCamera({
    qualidade: prefs.qualidadeDaCamera,
    ...(prefs.camera ? { deviceId: prefs.camera.deviceId } : {}),
  });
  const trilha = stream.getVideoTracks()[0];
  if (!trilha) throw new Error('câmera sem trilha');

  cameraLocal = stream;
  publicacaoDeVideo =
    (await sala.localParticipant.publishTrack(trilha, { source: Track.Source.Camera })) ?? null;

  /* O aviso de fim vai na trilha **do SDK**, não na que abrimos.
     `publishTrack` clona a trilha recebida e encerra a original, então um
     `ended` na nossa dispara no instante seguinte à publicação — a câmera
     acendia e se apagava sozinha, com o toast de "a câmera parou" por cima. A
     do SDK só termina quando o aparelho some de verdade ou outro programa o
     toma, que é o caso que interessa: botão aceso com imagem congelada é pior
     que desligado. */
  publicacaoDeVideo?.track?.on(TrackEvent.Ended, () => {
    void definirCamera(false, retornos);
    retornos.aoCairACamera();
  });

  avisarParticipantes(retornos);
}

export function cameraLigada(): boolean {
  return publicacaoDeVideo !== null;
}

/* ------------------------------------------------------------------------- *
 * Tela
 * ------------------------------------------------------------------------- */

const espectadoresDaMinhaTela = new Set<string>();

interface AvisoDeEspectador {
  tipo: 'assistindo';
  alvo: string;
  assistindo: boolean;
}

function lerAviso(carga: Uint8Array): AvisoDeEspectador | null {
  try {
    const bruto: unknown = JSON.parse(new TextDecoder().decode(carga));
    if (typeof bruto !== 'object' || bruto === null) return null;
    const aviso = bruto as Record<string, unknown>;
    if (aviso.tipo !== 'assistindo' || typeof aviso.alvo !== 'string') return null;
    return { tipo: 'assistindo', alvo: aviso.alvo, assistindo: Boolean(aviso.assistindo) };
  } catch {
    // Mensagem de dados de outra versão nossa, ou lixo. Ignorar é o certo:
    // isto alimenta um contador, não uma decisão de acesso.
    return null;
  }
}

/** Quantas telas estão no ar. Três é o teto, e é decisão de produto. */
export const MAXIMO_DE_TELAS = 3;

export function telasNoAr(): number {
  if (!sala) return 0;
  const remotas = [...sala.remoteParticipants.values()].filter((p) =>
    p.getTrackPublication(Track.Source.ScreenShare),
  ).length;
  return remotas + (sala.localParticipant.getTrackPublication(Track.Source.ScreenShare) ? 1 : 0);
}

/**
 * Começa a transmitir.
 *
 * **Nada de `await` antes do `setScreenShareEnabled`.** O Safari só abre o
 * seletor de tela dentro da mesma pilha do clique; qualquer espera no caminho
 * quebra o gesto e o pedido é recusado sem explicação. Por isso o preset e o
 * áudio já chegam decididos aqui.
 */
export async function iniciarTela(preset: Preset, comAudioDoSistema: boolean): Promise<void> {
  if (!sala) return;

  const camadas = camadasDe(preset).map(
    (c) => new VideoPreset(c.largura, c.altura, c.bitrate, c.fps),
  );

  await sala.localParticipant.setScreenShareEnabled(
    true,
    {
      resolution: { width: preset.largura, height: preset.altura, frameRate: preset.fps },
      contentHint: preset.dica,
      // Sem processamento de voz: cancelamento de eco e supressão de ruído
      // existem para voz e destroem música. 48 kHz, dois canais.
      audio: comAudioDoSistema
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48_000,
            channelCount: 2,
          }
        : false,
      systemAudio: 'include',
      // Trocar de janela sem interromper a transmissão. Detalhe pequeno, muito
      // usado.
      surfaceSwitching: 'include',
      // A aba do próprio produto fora da lista: compartilhar a aba onde você se
      // assiste cria um túnel infinito.
      selfBrowserSurface: 'exclude',
    },
    {
      // VP9 tem modo específico para captura de tela e trata texto muito melhor
      // que o H.264, que foi feito para vídeo natural e lê borda de letra como
      // ruído.
      videoCodec: 'vp9',
      screenShareEncoding: { maxBitrate: preset.bitrate, maxFramerate: preset.fps },
      screenShareSimulcastLayers: camadas,
    },
  );
}

export async function pararTela(): Promise<void> {
  await sala?.localParticipant.setScreenShareEnabled(false);
}

export function transmitindo(): boolean {
  return Boolean(sala?.localParticipant.getTrackPublication(Track.Source.ScreenShare));
}

/**
 * Troca o preset **sem parar e recomeçar**.
 *
 * `applyConstraints` na trilha que já existe: a resolução muda em um ou dois
 * segundos, o seletor nativo não reaparece e ninguém que assiste é derrubado.
 */
export async function trocarPreset(preset: Preset): Promise<void> {
  const pub = sala?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  const trilha = pub?.track?.mediaStreamTrack;
  if (!trilha) return;

  await trilha.applyConstraints({
    width: { ideal: preset.largura },
    height: { ideal: preset.altura },
    frameRate: { ideal: preset.fps },
  });
  trilha.contentHint = preset.dica;
}

/**
 * Assinar ou largar a tela de alguém.
 *
 * O aviso de volta é por mensagem de dados porque o SDK não conta espectadores
 * por trilha, e quem transmite precisa saber que está transmitindo para
 * ninguém.
 */
export async function assistir(identity: string, ligar: boolean): Promise<void> {
  const participante = sala?.remoteParticipants.get(identity);
  const pub = participante?.getTrackPublication(Track.Source.ScreenShare);
  if (!pub) return;
  pub.setSubscribed(ligar);

  const audio = participante?.getTrackPublication(Track.Source.ScreenShareAudio);
  audio?.setSubscribed(ligar);

  const carga = new TextEncoder().encode(
    JSON.stringify({ tipo: 'assistindo', alvo: identity, assistindo: ligar }),
  );
  await sala?.localParticipant.publishData(carga, { reliable: true });
}

export type QualidadeDoEspectador = 'auto' | 'fonte' | '720p';

/**
 * A qualidade que **o espectador** escolhe, e que só vale para ele.
 *
 * "Automática" deixa o `adaptiveStream` escolher a camada pelo tamanho do
 * elemento na tela — assistir numa janelinha não puxa 1440p. "Fonte" força a
 * camada alta, que é o que se quer ao maximizar para ler código e o automático
 * demora a subir.
 */
export function definirQualidade(identity: string, qualidade: QualidadeDoEspectador): void {
  const pub = sala?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare);
  if (!pub) return;

  if (qualidade === 'fonte') {
    pub.setVideoQuality(VideoQuality.HIGH);
    return;
  }
  if (qualidade === '720p') {
    pub.setVideoDimensions({ width: 1280, height: 720 });
    return;
  }
  // Automática: devolver o controle ao `adaptiveStream` é pedir a camada pelo
  // tamanho do elemento, que é o que ele já faz sozinho.
  pub.setVideoQuality(VideoQuality.HIGH);
}

export interface EstatisticasDaTela {
  bitrate: number;
  largura: number;
  altura: number;
  fps: number;
  /** O que o codificador diz estar segurando: nada, a máquina ou a rede. */
  motivo: MotivoDeLimitacao;
}

let ultimoRelatorio: { bytes: number; quando: number } | null = null;

/**
 * O que a barra de quem transmite mostra: preset, resolução real e bitrate real.
 *
 * O bitrate é o de verdade, do `getStats`, e não o alvo — porque a linha só
 * serve para explicar por que a imagem piorou, e para isso ela tem de contar o
 * que está acontecendo, não o que foi pedido.
 */
export async function estatisticasDaTela(): Promise<EstatisticasDaTela | null> {
  const pub = sala?.localParticipant.getTrackPublication(Track.Source.ScreenShare);
  const trilha = pub?.track;
  if (!trilha) {
    ultimoRelatorio = null;
    return null;
  }

  const relatorio = await trilha.getRTCStatsReport?.();
  if (!relatorio) return null;

  let bytes = 0;
  let largura = 0;
  let altura = 0;
  let fps = 0;
  let motivo: MotivoDeLimitacao = 'none';

  relatorio.forEach((linha: Record<string, unknown>) => {
    if (linha.type !== 'outbound-rtp' || linha.kind !== 'video') return;
    // Com simulcast há uma linha por camada; somar dá o que sai de verdade, e
    // a resolução que interessa é a da maior.
    bytes += Number(linha.bytesSent ?? 0);
    const l = Number(linha.frameWidth ?? 0);
    if (l > largura) {
      largura = l;
      altura = Number(linha.frameHeight ?? 0);
      fps = Math.round(Number(linha.framesPerSecond ?? 0));
    }
    const razao = linha.qualityLimitationReason;
    if (razao === 'cpu' || razao === 'bandwidth' || razao === 'other') motivo = razao;
  });

  const agora = Date.now();
  let bitrate = 0;
  if (ultimoRelatorio && agora > ultimoRelatorio.quando) {
    bitrate = ((bytes - ultimoRelatorio.bytes) * 8000) / (agora - ultimoRelatorio.quando);
  }
  ultimoRelatorio = { bytes, quando: agora };

  return { bitrate: Math.max(0, bitrate), largura, altura, fps, motivo };
}

/**
 * Quanto a conexão aguenta subir, medido nos primeiros segundos da chamada.
 *
 * Vira a linha "Sua conexão suporta até" no seletor de preset. É uma estimativa
 * do próprio WebRTC, e por isso a interface a usa para **avisar**, nunca para
 * proibir.
 */
export async function bandaDeSubida(): Promise<number | null> {
  // Sai do relatório da trilha de voz, que sempre existe numa chamada: o par
  // de candidatos é o mesmo para tudo o que sobe.
  const publicacaoDeAudio = sala?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const relatorio = await publicacaoDeAudio?.track?.getRTCStatsReport?.();
  if (!relatorio) return null;

  let disponivel: number | null = null;
  relatorio.forEach((linha: Record<string, unknown>) => {
    if (linha.type === 'candidate-pair' && linha.availableOutgoingBitrate) {
      disponivel = Number(linha.availableOutgoingBitrate);
    }
  });
  return disponivel;
}

/** A saída escolhida nas configurações, se este navegador deixar escolher. */
async function aplicarSaidaSalva(room: Room): Promise<void> {
  const saida = lerPreferencias().altofalante;
  if (!saida || !podeEscolherSaida()) return;
  try {
    await room.switchActiveDevice('audiooutput', saida.deviceId);
  } catch {
    // Dispositivo que sumiu entre a escolha e a chamada. O som sai pelo padrão
    // do sistema, que é melhor do que não entrar na chamada.
  }
}

export async function sair(): Promise<void> {
  if (!sala) return;
  const anterior = sala;
  sala = null;
  publicacao = null;
  publicacaoDeVideo = null;
  surdo = false;
  // A câmera é apagada antes de desconectar: esperar a desconexão terminar
  // deixaria a luz acesa por um instante depois de a chamada ter acabado.
  encerrar(cameraLocal);
  cameraLocal = null;
  await anterior.disconnect();
}

/** Silencia a trilha publicada — os outros veem o estado, não só ouvem o vazio. */
export async function definirMudo(mudo: boolean): Promise<void> {
  if (!publicacao) return;
  if (mudo) await publicacao.mute();
  else await publicacao.unmute();
}

export function definirSurdo(valor: boolean): void {
  surdo = valor;
  sala?.remoteParticipants.forEach((p) => p.setVolume(valor ? 0 : 1));
}

/**
 * Destrava o áudio depois de um gesto.
 *
 * O navegador barra som que começa sem interação. Entrar numa chamada é um
 * clique, então normalmente não acontece — mas reconectar sozinho numa aba que
 * ficou aberta a noite toda acontece.
 */
export async function destravarAudio(): Promise<void> {
  await sala?.startAudio();
}

/** Aplica a saída a um elemento avulso — a prévia de som das configurações. */
export async function aplicarSaidaEm(elemento: HTMLMediaElement): Promise<void> {
  const saida = lerPreferencias().altofalante;
  if (saida) await aplicarSaida(elemento, saida.deviceId);
}
