import {
  ConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import type { CadeiaDeEntrada } from '../../lib/midia';
import { aplicarSaida, podeEscolherSaida } from '../../lib/midia';
import { lerPreferencias } from '../../lib/preferencias';
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
    })
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
  surdo = false;
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
