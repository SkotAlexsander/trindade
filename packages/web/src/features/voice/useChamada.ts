import { useCallback } from 'react';
import { useToast } from '../../components';
import { api, HttpError } from '../../lib/http';
import * as ws from '../../lib/ws';
import {
  CadeiaDeEntrada,
  explicarErroDeMidia,
  listarDispositivos,
  paraSalvar,
  resolverDispositivo,
  type ModoDePortao,
} from '../../lib/midia';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import { tocar } from './sons';
import * as sala from './sala';
import { useVoz } from './store';

/**
 * Entrar, sair, calar e ensurdecer.
 *
 * Clicar num canal de voz conecta direto, sem antessala: com cinco pessoas
 * conhecidas, uma tela de pré-visualização é cerimônia. E o microfone entra
 * **aberto** — entrar mudo produz o "você está no mudo" a cada conversa, e a
 * borda saturada da barra torna o estado impossível de ignorar, o que faz desse
 * o padrão seguro. Ver design/07-chamada.md.
 */

interface Credenciais {
  token: string;
  wsUrl: string;
  room: string;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  canShareScreen: boolean;
}

/** A cadeia vive fora do React: uma chamada de cada vez, e ela sobrevive a re-renders. */
let cadeia: CadeiaDeEntrada | null = null;

export function cadeiaAtual(): CadeiaDeEntrada | null {
  return cadeia;
}

/** O modo do portão que as preferências pedem agora. */
export function modoDoPortao(): ModoDePortao {
  const prefs = lerPreferencias();
  // Apertar para falar manda em tudo; o estúdio não tem gate; o resto segue o
  // piso móvel ou o limiar manual.
  if (prefs.apertarParaFalar) return { tipo: 'manual', falando: false };
  if (prefs.perfil === 'estudio') return { tipo: 'aberto' };
  if (prefs.gateAutomatico) return { tipo: 'automatico' };
  return { tipo: 'limiar', dbfs: prefs.limiarDbfs };
}

export interface Chamada {
  entrar: (channelId: string) => Promise<void>;
  sair: () => Promise<void>;
  alternarMudo: () => void;
  alternarSurdo: () => void;
  destravarAudio: () => void;
}

export function useChamada(): Chamada {
  const { show } = useToast();

  const sairDaChamada = useCallback(async () => {
    const { fase } = useVoz.getState();
    if (fase === 'fora') return;
    await sala.sair();
    await cadeia?.fechar();
    cadeia = null;
    useVoz.getState().esquecerChamada();
    tocar('sair');
  }, []);

  const entrar = useCallback(
    async (channelId: string) => {
      const voz = useVoz.getState();
      if (voz.channelId === channelId && voz.fase !== 'fora' && voz.fase !== 'falhou') return;
      if (voz.fase !== 'fora') await sairDaChamada();

      voz.definir({ fase: 'conectando', channelId, erro: null });

      try {
        const credenciais = await api<Credenciais>(`/channels/${channelId}/voice/token`, {
          method: 'POST',
        });

        const prefs = lerPreferencias();
        const lista = await listarDispositivos();
        const escolha = resolverDispositivo(prefs.microfone, lista.microfones);

        cadeia = await CadeiaDeEntrada.abrir({
          ...(escolha.dispositivo ? { deviceId: escolha.dispositivo.deviceId } : {}),
          perfil: prefs.perfil,
          personalizado: prefs.personalizado,
          volumeEntrada: prefs.volumeEntrada,
          modo: modoDoPortao(),
        });

        // A escolha é regravada quando o id mudou mas o aparelho é o mesmo: sem
        // isto, a cascata cairia no rótulo em toda chamada seguinte.
        if (escolha.dispositivo && escolha.motivo === 'rotulo') {
          salvarPreferencias({ microfone: paraSalvar(escolha.dispositivo) });
        }
        if (escolha.motivo === 'assumido' && escolha.dispositivo) {
          show(`Microfone não encontrado. Usando ${escolha.dispositivo.label || 'o padrão'}.`);
        }

        await sala.entrar(credenciais, cadeia, {
          aoMudarFase: (fase, erro) => {
            useVoz.getState().definir({ fase, erro: erro ?? null });
            if (fase === 'fora' || fase === 'falhou') {
              void cadeia?.fechar();
              cadeia = null;
            }
            if (erro) show(erro, 'danger');
          },
          aoFalar: (falando) => useVoz.getState().definir({ falando }),
          aoMudarQualidade: (qualidade) => useVoz.getState().definir({ qualidade }),
          aoBloquearAudio: (audioBloqueado) => useVoz.getState().definir({ audioBloqueado }),
        });

        useVoz.getState().definir({ fase: 'conectado', muted: false, deafened: false });
        anunciar(channelId, false, false);
        tocar('entrar');
      } catch (erro) {
        await sala.sair();
        await cadeia?.fechar();
        cadeia = null;

        const mensagem =
          erro instanceof HttpError
            ? erro.message
            : (explicarErroDeMidia(erro, 'microfone') ?? 'Não foi possível conectar.');
        useVoz.getState().definir({ fase: 'falhou', erro: mensagem });
        show(mensagem, 'danger');
      }
    },
    [show, sairDaChamada],
  );

  const alternarMudo = useCallback(() => {
    const voz = useVoz.getState();
    if (voz.fase !== 'conectado' || !voz.channelId) return;
    const muted = !voz.muted;
    // Falar de novo desfaz a surdez: ninguém quer voltar a ser ouvido e
    // continuar sem ouvir, e o contrário — ensurdecer — cala junto.
    const deafened = muted ? voz.deafened : false;
    voz.definir({ muted, deafened });
    void sala.definirMudo(muted);
    if (!deafened) sala.definirSurdo(false);
    anunciar(voz.channelId, muted, deafened);
    tocar(muted ? 'mudo' : 'aberto');
  }, []);

  const alternarSurdo = useCallback(() => {
    const voz = useVoz.getState();
    if (voz.fase !== 'conectado' || !voz.channelId) return;
    const deafened = !voz.deafened;
    // Ensurdecer sem calar é o pior dos dois mundos: você não ouve o que está
    // dizendo aos outros. Por isso ficar surdo cala junto.
    const muted = deafened ? true : voz.muted;
    voz.definir({ deafened, muted });
    sala.definirSurdo(deafened);
    void sala.definirMudo(muted);
    anunciar(voz.channelId, muted, deafened);
    tocar(muted ? 'mudo' : 'aberto');
  }, []);

  const destravarAudio = useCallback(() => {
    void sala.destravarAudio().then(() => useVoz.getState().definir({ audioBloqueado: false }));
  }, []);

  return { entrar, sair: sairDaChamada, alternarMudo, alternarSurdo, destravarAudio };
}

/**
 * Conta ao servidor.
 *
 * O LiveKit sabe se a trilha está publicada; não sabe se a pessoa escolheu se
 * calar, e não sabe nada sobre surdez, que nem chega a tocar na rede. Por isso
 * os dois vêm daqui.
 */
function anunciar(channelId: string, muted: boolean, deafened: boolean): void {
  ws.enviar({ op: 'VOICE_STATE', d: { channelId, muted, deafened } });
}
