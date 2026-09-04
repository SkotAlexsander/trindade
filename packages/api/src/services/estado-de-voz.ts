import type { FastifyBaseLogger } from 'fastify';
import { TrackSource, type WebhookEvent } from 'livekit-server-sdk';
import type { VoiceState } from '@trindade/shared';
import { gateway } from '../ws/index.js';

/**
 * Quem está em qual chamada.
 *
 * Em memória, como o mapa de conexões: com cinco pessoas o estado inteiro cabe
 * num objeto, e persistir isso criaria a pergunta "e se o banco disser que
 * alguém está numa chamada que já acabou?". A verdade é o LiveKit; isto é a
 * cópia que o READY entrega e que o gateway mantém em dia.
 *
 * Reiniciar a API esvazia o mapa. O primeiro webhook seguinte o refaz, e quem
 * está na chamada continua na chamada — a mídia não passa por aqui.
 */

const porUsuario = new Map<string, VoiceState>();

/** O id do canal a partir do nome da sala: `channel:<uuid>`. */
function canalDaSala(sala: string | undefined): string | null {
  if (!sala?.startsWith('channel:')) return null;
  return sala.slice('channel:'.length) || null;
}

export function estadosDeVoz(): VoiceState[] {
  return [...porUsuario.values()];
}

export function limparEstadosDeVoz(): void {
  porUsuario.clear();
}

/**
 * Microfone e surdez, ditos pelo próprio cliente.
 *
 * O LiveKit sabe se a trilha está publicada; não sabe se a pessoa escolheu se
 * calar. Só vale para quem já está numa chamada — quem não está não tem estado
 * a mudar, e aceitar isso deixaria qualquer um aparecer na grade sem entrar.
 */
export function definirMicrofone(
  userId: string,
  channelId: string,
  muted: boolean,
  deafened: boolean,
): void {
  const atual = porUsuario.get(userId);
  if (!atual || atual.channelId !== channelId) return;
  publicar({ ...atual, muted, deafened });
}

/** Alguém caiu do gateway: se estava numa chamada, sai dela. */
export function esquecerUsuario(userId: string): void {
  const atual = porUsuario.get(userId);
  if (atual) sair(userId, atual.channelId);
}

function publicar(estado: VoiceState): void {
  porUsuario.set(estado.userId, estado);
  gateway.broadcast({ op: 'VOICE_STATE_UPDATE', d: estado });
}

function sair(userId: string, channelId: string): void {
  porUsuario.delete(userId);
  // Sair é um `VOICE_STATE_UPDATE` com o canal e nada ligado — não um evento
  // próprio. Quem recebe compara com o que tinha e some com o avatar.
  gateway.broadcast({
    op: 'VOICE_STATE_UPDATE',
    d: { userId, channelId, muted: false, deafened: false, screenSharing: false, connected: false },
  });
}

/**
 * Traduz um evento do LiveKit para o estado que a interface desenha.
 *
 * Só os quatro que mudam algo visível. `track_published` de câmera não entra:
 * a grade descobre isso pela própria conexão com o SFU, e duplicar o caminho
 * criaria dois lugares para o estado divergir.
 */
export function aplicarEventoDoLiveKit(evento: WebhookEvent, log: FastifyBaseLogger): void {
  const channelId = canalDaSala(evento.room?.name);
  const userId = evento.participant?.identity;

  if (!channelId || !userId) {
    log.debug({ evento: evento.event }, 'webhook sem sala ou participante');
    return;
  }

  switch (evento.event) {
    case 'participant_joined':
      publicar({
        userId,
        channelId,
        muted: false,
        deafened: false,
        screenSharing: false,
        connected: true,
      });
      return;

    case 'participant_left':
      sair(userId, channelId);
      return;

    case 'track_published':
    case 'track_unpublished': {
      if (evento.track?.source !== TrackSource.SCREEN_SHARE) return;

      const atual = porUsuario.get(userId);
      publicar({
        userId,
        channelId,
        muted: atual?.muted ?? false,
        deafened: atual?.deafened ?? false,
        screenSharing: evento.event === 'track_published',
        connected: true,
      });
      return;
    }

    default:
      return;
  }
}
