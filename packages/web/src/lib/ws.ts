import {
  CLOSE,
  HEARTBEAT_INTERVAL_MS,
  type ClientEvent,
  type ServerEvent,
  type ServerEventName,
} from '@trindade/shared';
import { getAccessToken, tryRestoreSession } from './http';

/**
 * Cliente do gateway.
 *
 * Um socket por aba, vivendo neste módulo e não num componente: React
 * desmonta e remonta por vários motivos — StrictMode em desenvolvimento,
 * troca de rota, suspense — e nenhum deles é motivo para derrubar a conexão e
 * refazer o READY. Quem monta apenas assina.
 *
 * Ver docs/06-realtime-e-webrtc.md e prompts/fase-05-realtime-mensagens.md.
 */

export type EstadoWs = 'ocioso' | 'conectando' | 'aberto' | 'caido';

type Ouvinte<T extends ServerEventName> = (d: Extract<ServerEvent, { op: T }>['d']) => void;
type OuvinteEstado = (estado: EstadoWs) => void;
type OuvinteAbertura = (info: { reconexao: boolean }) => void;

const BASE_MS = 1_000;
const TETO_MS = 30_000;
/** Mensagens escritas offline. Acima disso, algo está muito errado. */
const FILA_MAXIMA = 50;

const ouvintes = new Map<ServerEventName, Set<(d: unknown) => void>>();
const ouvintesEstado = new Set<OuvinteEstado>();
const ouvintesAbertura = new Set<OuvinteAbertura>();

let socket: WebSocket | null = null;
let estado: EstadoWs = 'ocioso';
let tentativas = 0;
let reconexaoTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ligado = false;
let jaAbriuUmaVez = false;
let fila: ClientEvent[] = [];

// --- assinatura ------------------------------------------------------------

export function on<T extends ServerEventName>(op: T, fn: Ouvinte<T>): () => void {
  const set = ouvintes.get(op) ?? new Set();
  set.add(fn as (d: unknown) => void);
  ouvintes.set(op, set);
  return () => set.delete(fn as (d: unknown) => void);
}

export function onEstado(fn: OuvinteEstado): () => void {
  ouvintesEstado.add(fn);
  return () => ouvintesEstado.delete(fn);
}

/**
 * Chamado a cada READY. `reconexao` distingue o primeiro READY da aba dos
 * seguintes — é o que diz à camada de mensagens se ela precisa buscar o que
 * passou enquanto o socket esteve fora.
 */
export function onAbertura(fn: OuvinteAbertura): () => void {
  ouvintesAbertura.add(fn);
  return () => ouvintesAbertura.delete(fn);
}

function emitir(evento: ServerEvent): void {
  const set = ouvintes.get(evento.op);
  if (!set) return;
  for (const fn of [...set]) fn(evento.d);
}

function mudarEstado(novo: EstadoWs): void {
  if (estado === novo) return;
  estado = novo;
  for (const fn of [...ouvintesEstado]) fn(novo);
}

export function estadoAtual(): EstadoWs {
  return estado;
}

// --- ciclo de vida ---------------------------------------------------------

export function conectar(): void {
  ligado = true;
  abrir();
}

export function desconectar(): void {
  ligado = false;
  cancelarReconexao();
  pararHeartbeat();
  jaAbriuUmaVez = false;
  fila = [];
  if (socket) {
    // 1000: fechamento normal. O servidor não trata isso como queda.
    const antigo = socket;
    socket = null;
    antigo.close(1000, 'BYE');
  }
  mudarEstado('ocioso');
}

function url(token: string): string {
  const esquema = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // O token vai na query porque o navegador não deixa mandar cabeçalho no
  // handshake de WebSocket. É access token de 15 minutos, não o refresh — o
  // refresh continua só no cookie httpOnly. Ver docs/04-seguranca.md.
  return `${esquema}//${location.host}/ws?token=${encodeURIComponent(token)}`;
}

function abrir(): void {
  if (!ligado || socket) return;

  const token = getAccessToken();
  if (!token) {
    // Sem token não adianta tentar: renova e volta por aqui.
    void tryRestoreSession().then((novo) => {
      if (novo && ligado) abrir();
      else agendarReconexao();
    });
    return;
  }

  mudarEstado(jaAbriuUmaVez ? 'caido' : 'conectando');

  const ws = new WebSocket(url(token));
  socket = ws;

  ws.onopen = () => {
    // Ainda não é 'aberto': o gateway só está pronto depois do READY, e
    // enviar antes dele seria enviar no escuro.
    iniciarHeartbeat();
  };

  ws.onmessage = (evento: MessageEvent<string>) => {
    let dados: ServerEvent;
    try {
      dados = JSON.parse(evento.data) as ServerEvent;
    } catch {
      return;
    }

    if (dados.op === 'READY') {
      tentativas = 0;
      mudarEstado('aberto');
      emitir(dados);
      const reconexao = jaAbriuUmaVez;
      jaAbriuUmaVez = true;
      for (const fn of [...ouvintesAbertura]) fn({ reconexao });
      esvaziarFila();
      return;
    }

    emitir(dados);
  };

  ws.onclose = (evento: CloseEvent) => {
    if (socket !== ws) return;
    socket = null;
    pararHeartbeat();

    if (!ligado) {
      mudarEstado('ocioso');
      return;
    }

    if (evento.code === CLOSE.ACCOUNT_DISABLED) {
      // Não reconecta: a conta não existe mais para efeitos práticos, e
      // insistir só produziria um laço de handshake recusado.
      ligado = false;
      mudarEstado('ocioso');
      return;
    }

    mudarEstado('caido');

    if (evento.code === CLOSE.UNAUTHENTICATED) {
      // Token vencido enquanto o socket estava fora. Renova e volta na hora:
      // esperar o backoff aqui seria esperar por nada.
      void tryRestoreSession().then((novo) => {
        if (!ligado) return;
        if (novo) abrir();
        else agendarReconexao();
      });
      return;
    }

    agendarReconexao();
  };

  ws.onerror = () => {
    // O `close` sempre vem depois; a reconexão é tratada lá, uma vez só.
  };
}

/**
 * Espera exponencial com jitter, teto de 30s.
 *
 * O jitter não é enfeite: sem ele, cinco abas que caíram juntas voltam juntas,
 * e o servidor que acabou de subir leva as cinco no mesmo milissegundo.
 * Metade fixa e metade sorteada mantém o crescimento previsível e ainda assim
 * espalha as tentativas.
 */
function agendarReconexao(): void {
  if (!ligado || reconexaoTimer) return;
  const alvo = Math.min(TETO_MS, BASE_MS * 2 ** tentativas);
  const espera = alvo / 2 + Math.random() * (alvo / 2);
  tentativas += 1;
  reconexaoTimer = setTimeout(() => {
    reconexaoTimer = null;
    abrir();
  }, espera);
}

function cancelarReconexao(): void {
  if (reconexaoTimer) clearTimeout(reconexaoTimer);
  reconexaoTimer = null;
  tentativas = 0;
}

/** Volta a tentar agora, sem esperar o backoff. */
export function tentarAgora(): void {
  if (!ligado || socket) return;
  cancelarReconexao();
  abrir();
}

// --- heartbeat -------------------------------------------------------------

function iniciarHeartbeat(): void {
  pararHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: 'HEARTBEAT', d: {} }));
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function pararHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// --- envio -----------------------------------------------------------------

/**
 * Devolve `true` se saiu pela rede e `false` se foi para a fila.
 *
 * `TYPING_START` nunca entra na fila: indicador de digitação guardado por
 * quarenta segundos e entregue depois é uma informação falsa.
 */
export function enviar(evento: ClientEvent): boolean {
  if (estado === 'aberto' && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(evento));
    return true;
  }

  if (evento.op === 'MESSAGE_CREATE' && fila.length < FILA_MAXIMA) fila.push(evento);
  return false;
}

function esvaziarFila(): void {
  if (fila.length === 0) return;
  const pendentes = fila;
  fila = [];
  for (const evento of pendentes) enviar(evento);
}

export function tamanhoDaFila(): number {
  return fila.length;
}

// --- gatilhos do navegador -------------------------------------------------

/**
 * Voltar da suspensão ou recuperar a rede reconecta na hora.
 *
 * Sem isto, quem fecha a tampa do notebook por meia hora volta e espera os 30
 * segundos do teto do backoff olhando para a faixa de desconexão.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('online', tentarAgora);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tentarAgora();
  });
}
