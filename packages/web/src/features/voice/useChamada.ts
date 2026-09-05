import { useCallback } from 'react';
import { useToast, type ToastKind } from '../../components';
import { api, HttpError } from '../../lib/http';
import * as ws from '../../lib/ws';
import {
  CadeiaDeEntrada,
  estadoDaPermissao,
  explicarErroDeMidia,
  decidirTroca,
  listarDispositivos,
  observarDispositivos,
  type ListaDeDispositivos,
  paraSalvar,
  resolverDispositivo,
  type ModoDePortao,
} from '../../lib/midia';
import { lerPreferencias, salvarPreferencias } from '../../lib/preferencias';
import { presetPorId, type IdDePreset } from './presets';
import { tocar } from './sons';
import * as sala from './sala';
import type { QualidadeDoEspectador } from './sala';
import { useVoz, type ModoDaSala } from './store';

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

/** Como desligar o ouvinte de `devicechange`. Só existe durante a chamada. */
let pararDeObservar: (() => void) | null = null;

/** O microfone que está tocando agora, para a cascata saber o que é "em uso". */
let microfoneEmUso: string | null = null;

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
  alternarCamera: () => void;
  definirModo: (modo: ModoDaSala) => void;
  alternarGrade: () => void;
  /** Não recebe `await` antes do seletor nativo: o Safari exige o mesmo gesto. */
  transmitir: (preset: IdDePreset, comAudio: boolean) => void;
  pararDeTransmitir: () => void;
  escolherTela: (aberto: boolean) => void;
  assistir: (identity: string, ligar: boolean) => void;
  focar: (identity: string | null) => void;
  trocarPreset: (preset: IdDePreset) => void;
  definirQualidadeDoEspectador: (qualidade: QualidadeDoEspectador) => void;
  /** `null` limpa a escolha e volta a mostrar quem tem imagem. */
  fixarNaMiniatura: (identity: string | null) => void;
  esconderMiniatura: (esconder: boolean) => void;
  apontar: (alvo: string, x: number, y: number) => void;
  destravarAudio: () => void;
}

/**
 * Os avisos que a sala manda de volta.
 *
 * Fora do hook porque a câmera também precisa deles: passar um objeto
 * diferente ali faria os eventos de participante pararem de chegar depois do
 * primeiro `definirCamera`, e o defeito só apareceria com duas pessoas.
 */
function retornosDaSala(show: (mensagem: string, tipo?: ToastKind) => void): sala.Retornos {
  return {
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
    aoMudarParticipantes: (participantes) => {
      const voz = useVoz.getState();
      // Quem estava sendo assistido parou: o foco volta para a grade sozinho,
      // em vez de ficar num vídeo que não existe mais.
      const foco = participantes.find((p) => p.identity === voz.telaEmFoco);
      voz.definir({
        participantes,
        camera: sala.cameraLigada(),
        transmitindo: sala.transmitindo(),
        telaEmFoco: foco?.assistindo ? voz.telaEmFoco : null,
      });
    },
    aoCairACamera: () =>
      show('A câmera parou. O aparelho foi removido ou está em uso por outro programa.'),
    aoApontar: (aviso) => {
      const voz = useVoz.getState();
      // Um por pessoa: apontar de novo move o ponto, não acrescenta outro.
      voz.definir({
        apontamentos: [...voz.apontamentos.filter((a) => a.de !== aviso.de), aviso],
      });
      // Dois segundos, e some sozinho. É um gesto, não um marcador.
      setTimeout(() => {
        const atual = useVoz.getState();
        atual.definir({ apontamentos: atual.apontamentos.filter((a) => a !== aviso) });
      }, 2000);
    },
  };
}

/**
 * Tirar e pôr um aparelho no meio da chamada.
 *
 * A tabela é a de `design/13-dispositivos-e-audio.md`: aparelho novo só
 * atualiza a lista, aparelho em uso que some cai para o próximo da cascata
 * **com aviso**, e aparelho que sai sem estar em uso não muda nada. Trocar
 * sozinho para o fone que acabou de ser conectado é o comportamento do sistema
 * operacional, não o nosso — aqui, quem escolheu escolheu.
 *
 * `decidirTroca` e `observarDispositivos` existiam desde a fase 7, com teste, e
 * nada os chamava: tirar o fone no meio da conversa deixava a chamada num
 * aparelho que não existe mais.
 */
async function aoMudarDispositivos(
  lista: ListaDeDispositivos,
  show: (texto: string, tipo?: 'info' | 'danger') => void,
): Promise<void> {
  if (!cadeia) return;

  const prefs = lerPreferencias();
  const decisao = decidirTroca(microfoneEmUso, prefs.microfone, lista.microfones);
  if (decisao.dispositivo?.deviceId === microfoneEmUso) return;

  try {
    await cadeia.trocarDispositivo(decisao.dispositivo?.deviceId);
    microfoneEmUso = decisao.dispositivo?.deviceId ?? null;
    if (decisao.avisar) {
      show(`O microfone saiu. Usando ${decisao.dispositivo?.label || 'o padrão'}.`);
    }
  } catch {
    show('O microfone saiu e não consegui trocar. Escolha outro nas configurações.', 'danger');
  }
}

export function useChamada(): Chamada {
  const { show } = useToast();

  const sairDaChamada = useCallback(async () => {
    const { fase } = useVoz.getState();
    if (fase === 'fora') return;
    await sala.sair();
    pararDeObservar?.();
    pararDeObservar = null;
    microfoneEmUso = null;
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

      /* Perguntar antes de pedir: com o microfone bloqueado, `getUserMedia`
         não abre caixa nenhuma — ele falha em silêncio, e quem clicou fica
         olhando um "conectando" que nunca sai. `permissions.query` responde
         sem pedir nada, e a mensagem já traz onde clicar.
         Ver docs/07-permissoes-do-navegador.md. */
      if ((await estadoDaPermissao('microfone')) === 'negada') {
        show(
          'O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o acesso.',
          'danger',
        );
        return;
      }

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

        await sala.entrar(credenciais, cadeia, retornosDaSala(show));

        microfoneEmUso = escolha.dispositivo?.deviceId ?? null;
        pararDeObservar = observarDispositivos((nova) => {
          void aoMudarDispositivos(nova, show);
        });

        useVoz.getState().definir({
          fase: 'conectado',
          muted: false,
          deafened: false,
          // Entrar numa chamada mostra a chamada: quem clicou num canal de voz
          // quer ver quem está lá. O modo é o guardado — a escolha de quem usa
          // vale desde o primeiro instante, não depois de um clique extra.
          modo: lerPreferencias().modoDaSala,
          // A interface esconde o botão sem a permissão; o token já não
          // deixaria publicar a trilha. As duas coisas, sempre.
          podeCompartilhar: credenciais.canShareScreen,
        });
        anunciar(channelId, false, false);
        tocar('entrar');
      } catch (erro) {
        await sala.sair();
        pararDeObservar?.();
        pararDeObservar = null;
        microfoneEmUso = null;
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

  /**
   * A câmera entra **desligada, sempre**.
   *
   * Ao contrário do microfone, que entra aberto porque a borda saturada torna o
   * estado impossível de ignorar, a câmera não tem sinal equivalente e o custo
   * do engano é de outra ordem. Ligar pede a permissão naquele momento.
   */
  /**
   * Ligar câmera ou tela **abre a chamada na tela**.
   *
   * Quem liga a câmera quer ser visto e ver; deixar isso escondido atrás de um
   * segundo clique é esconder justamente o que a pessoa acabou de pedir. Se o
   * modo guardado for "só a chamada", é ele que vale — a escolha de quem usa
   * ganha da nossa.
   */
  const mostrarAChamada = useCallback(() => {
    const voz = useVoz.getState();
    if (voz.modo !== 'mensagens') return;
    const guardado = lerPreferencias().modoDaSala;
    voz.definir({ modo: guardado === 'mensagens' ? 'ambos' : guardado });
  }, []);

  const alternarCamera = useCallback(() => {
    const voz = useVoz.getState();
    if (voz.fase !== 'conectado') return;
    const ligar = !voz.camera;

    const trocar = () => {
      if (ligar) mostrarAChamada();
      // O estado só muda quando a trilha existe de verdade: botão aceso sem
      // imagem é a mesma mentira que botão aceso com imagem congelada.
      void sala
        .definirCamera(ligar, retornosDaSala(show))
        .then(() => useVoz.getState().definir({ camera: sala.cameraLigada() }))
        .catch((erro: unknown) => {
          useVoz.getState().definir({ camera: sala.cameraLigada() });
          show(explicarErroDeMidia(erro, 'camera') ?? 'Não consegui abrir a câmera.', 'danger');
        });
    };

    // Desligar não pede permissão nenhuma.
    if (!ligar) {
      trocar();
      return;
    }

    /* Perguntar antes de pedir: com a câmera bloqueada o navegador não abre
       caixa nenhuma, e o botão acenderia e apagaria sem explicação. Ver
       docs/07-permissoes-do-navegador.md. */
    void estadoDaPermissao('camera').then((estado) => {
      if (estado === 'negada') {
        show(
          'O navegador bloqueou a câmera. Clique no cadeado ao lado do endereço e permita o acesso.',
          'danger',
        );
        return;
      }
      trocar();
    });
  }, [show, mostrarAChamada]);

  const definirModo = useCallback((modo: ModoDaSala) => {
    if (useVoz.getState().fase === 'fora') return;
    // Voltar a ver a sala desfaz o "esconder": a janela sumiu para dar lugar à
    // sala, e não porque a pessoa não a queira nunca mais.
    if (modo !== 'mensagens') useVoz.getState().definir({ miniaturaEscondida: false });
    /* Guardada como preferência de máquina: quem trabalha com a conversa ao
       lado quer isso em toda chamada, não só nesta. **`mensagens` não é
       guardado** — é "esconda a chamada agora", não uma escolha de layout, e
       gravá-lo fazia o botão de reabrir a chamada não reabrir nada. */
    if (modo !== 'mensagens') salvarPreferencias({ modoDaSala: modo });
    useVoz.getState().definir({ modo });
  }, []);

  const alternarGrade = useCallback(() => {
    const voz = useVoz.getState();
    if (voz.fase === 'fora') return;
    const guardado = lerPreferencias().modoDaSala;
    definirModo(
      voz.modo === 'mensagens' ? (guardado === 'mensagens' ? 'ambos' : guardado) : 'mensagens',
    );
  }, [definirModo]);


  /**
   * Começa a transmitir.
   *
   * **Sem `await` antes do seletor nativo.** O Safari só o abre dentro da mesma
   * pilha do clique, e qualquer espera no caminho faz o pedido ser recusado sem
   * explicação nenhuma — por isso esta função não é `async` e o preset já chega
   * decidido.
   */
  const transmitir = useCallback(
    (preset: IdDePreset, comAudio: boolean) => {
      if (sala.telasNoAr() >= sala.MAXIMO_DE_TELAS) {
        show(`Já há ${sala.MAXIMO_DE_TELAS} transmissões. Aguarde uma encerrar.`);
        return;
      }
      salvarPreferencias({ presetDeTela: preset, audioDaTela: comAudio });
      mostrarAChamada();
      sala
        .iniciarTela(presetPorId(preset), comAudio)
        .then(() => useVoz.getState().definir({ transmitindo: sala.transmitindo() }))
        .catch((erro: unknown) => {
          useVoz.getState().definir({ transmitindo: sala.transmitindo() });
          // Cancelar o seletor é uma ação legítima e não vira aviso nenhum.
          const texto = explicarErroDeMidia(erro, 'tela');
          if (texto) show(texto, 'danger');
        });
    },
    [show, mostrarAChamada],
  );

  const escolherTela = useCallback((aberto: boolean) => {
    const voz = useVoz.getState();
    if (aberto && (!voz.podeCompartilhar || voz.fase !== 'conectado')) return;
    voz.definir({ escolhendoTela: aberto });
  }, []);

  const pararDeTransmitir = useCallback(() => {
    void sala.pararTela().then(() =>
      useVoz.getState().definir({ transmitindo: sala.transmitindo(), estatisticas: null }),
    );
  }, []);

  /**
   * Assinar a tela de alguém — ou largá-la.
   *
   * Enquanto ninguém clica, o servidor não envia um byte daquela transmissão:
   * o custo de uma tela em 4K é pago só por quem está olhando.
   */
  const assistir = useCallback(
    (identity: string, ligar: boolean) => {
      if (ligar) mostrarAChamada();
      void sala.assistir(identity, ligar);
      // Assistir **não** joga direto no primeiro plano: a tela aparece como
      // mais uma caixa na grade, ao lado das pessoas, e quem quiser só aquela
      // tela clica nela. Pular esse passo esconderia todo mundo sem pedir.
      useVoz.getState().definir({
        telaEmFoco: ligar ? useVoz.getState().telaEmFoco : null,
        qualidadeDoEspectador: 'auto',
      });
    },
    [mostrarAChamada],
  );

  const focar = useCallback((identity: string | null) => {
    useVoz.getState().definir({ telaEmFoco: identity });
  }, []);

  const trocarPreset = useCallback((preset: IdDePreset) => {
    salvarPreferencias({ presetDeTela: preset });
    void sala.trocarPreset(presetPorId(preset));
  }, []);

  const definirQualidadeDoEspectador = useCallback((qualidade: QualidadeDoEspectador) => {
    const emFoco = useVoz.getState().telaEmFoco;
    if (!emFoco) return;
    sala.definirQualidade(emFoco, qualidade);
    useVoz.getState().definir({ qualidadeDoEspectador: qualidade });
  }, []);

  const fixarNaMiniatura = useCallback((identity: string | null) => {
    const voz = useVoz.getState();
    if (identity === null) {
      voz.definir({ fixadosNaMiniatura: new Set<string>() });
      return;
    }
    const proximo = new Set(voz.fixadosNaMiniatura);
    if (proximo.has(identity)) proximo.delete(identity);
    else proximo.add(identity);
    voz.definir({ fixadosNaMiniatura: proximo });
  }, []);

  const esconderMiniatura = useCallback((esconder: boolean) => {
    useVoz.getState().definir({ miniaturaEscondida: esconder });
  }, []);

  const apontar = useCallback((alvo: string, x: number, y: number) => {
    void sala.apontar(alvo, x, y);
  }, []);

  const destravarAudio = useCallback(() => {
    void sala.destravarAudio().then(() => useVoz.getState().definir({ audioBloqueado: false }));
  }, []);

  return {
    entrar,
    sair: sairDaChamada,
    alternarMudo,
    alternarSurdo,
    alternarCamera,
    definirModo,
    alternarGrade,
    transmitir,
    pararDeTransmitir,
    escolherTela,
    assistir,
    focar,
    trocarPreset,
    definirQualidadeDoEspectador,
    fixarNaMiniatura,
    esconderMiniatura,
    apontar,
    destravarAudio,
  };
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
