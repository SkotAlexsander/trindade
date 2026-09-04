import {
  DBFS_MINIMO,
  type ConstraintsPersonalizadas,
  type DispositivoSalvo,
  type PerfilDeEntrada,
  type QualidadeDeCamera,
} from './preferencias';

/**
 * A camada única de dispositivo.
 *
 * **Ninguém chama `navigator.mediaDevices` fora daqui.** Não é purismo: a
 * enumeração, a sondagem de permissão, a cascata de resolução e o encerramento
 * das trilhas são a mesma decisão vista de ângulos diferentes, e espalhá-la por
 * componentes é como se acaba com uma luz de câmera acesa por um painel que
 * alguém esqueceu aberto.
 *
 * Ver design/13-dispositivos-e-audio.md e docs/07-permissoes-do-navegador.md.
 */

export type TipoDeDispositivo = 'microfone' | 'altofalante' | 'camera';

export interface Dispositivo {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface ListaDeDispositivos {
  microfones: Dispositivo[];
  altofalantes: Dispositivo[];
  cameras: Dispositivo[];
  /**
   * Falso enquanto não houver permissão. **Não é erro nem lista vazia** — é um
   * estado da interface: "permita o acesso para ver seus dispositivos". A lista
   * de aparelhos identifica uma máquina, e o navegador a esconde por isso.
   */
  comRotulos: boolean;
}

const VAZIA: ListaDeDispositivos = {
  microfones: [],
  altofalantes: [],
  cameras: [],
  comRotulos: false,
};

function simplificar(d: MediaDeviceInfo): Dispositivo {
  return { deviceId: d.deviceId, label: d.label, groupId: d.groupId };
}

export function temMidia(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
}

export async function listarDispositivos(): Promise<ListaDeDispositivos> {
  if (!temMidia()) return VAZIA;
  const todos = await navigator.mediaDevices.enumerateDevices();
  const microfones = todos.filter((d) => d.kind === 'audioinput').map(simplificar);
  const altofalantes = todos.filter((d) => d.kind === 'audiooutput').map(simplificar);
  const cameras = todos.filter((d) => d.kind === 'videoinput').map(simplificar);
  return {
    microfones,
    altofalantes,
    cameras,
    // Um rótulo preenchido em qualquer um deles basta: a permissão de áudio
    // revela os rótulos de áudio, a de vídeo os de vídeo.
    comRotulos: [...microfones, ...altofalantes, ...cameras].some((d) => d.label !== ''),
  };
}

/**
 * `default` e `communications` do Chrome no Windows.
 *
 * São pseudodispositivos que seguem a escolha do sistema, e para muita gente
 * são a única opção que funciona sem pensar. Vão no topo, separados — nunca
 * escondidos.
 */
export function ehDoSistema(d: Dispositivo): boolean {
  return d.deviceId === 'default' || d.deviceId === 'communications';
}

export function organizarDispositivos(lista: Dispositivo[]): {
  sistema: Dispositivo[];
  reais: Dispositivo[];
} {
  return {
    sistema: lista.filter(ehDoSistema),
    reais: lista.filter((d) => !ehDoSistema(d)),
  };
}

export type MotivoDaEscolha =
  /** O `deviceId` guardado ainda existe. */
  | 'id'
  /** O id mudou mas o rótulo bate: é o mesmo aparelho, com outro id. */
  | 'rotulo'
  /** Nada bateu. Assumimos um e **avisamos qual**. */
  | 'assumido'
  /** Nunca houve escolha guardada. Silêncio, que é o certo aqui. */
  | 'padrao'
  /** Não há dispositivo nenhum. */
  | 'nenhum';

export interface Escolha {
  dispositivo: Dispositivo | null;
  motivo: MotivoDaEscolha;
}

/**
 * A cascata: id, depois rótulo, depois um assumido com aviso.
 *
 * `deviceId` é derivado do dispositivo **e** da origem, e some quando a pessoa
 * limpa os dados do site. Guardar só ele produz a falha clássica: um dia a
 * escolha desaparece sem explicação. Por isso o rótulo é a segunda chance, e o
 * `groupId` desempata quando dois aparelhos têm o mesmo nome — o que acontece o
 * tempo todo com placas que expõem entrada e saída com o mesmo rótulo.
 */
export function resolverDispositivo(
  salvo: DispositivoSalvo | null,
  lista: Dispositivo[],
): Escolha {
  if (lista.length === 0) return { dispositivo: null, motivo: 'nenhum' };

  const preferido =
    lista.find((d) => d.deviceId === 'default') ?? (lista[0] as Dispositivo);

  if (!salvo) return { dispositivo: preferido, motivo: 'padrao' };

  const porId = lista.find((d) => d.deviceId === salvo.deviceId);
  if (porId) return { dispositivo: porId, motivo: 'id' };

  if (salvo.label) {
    const mesmoRotulo = lista.filter((d) => d.label === salvo.label);
    const porRotulo =
      mesmoRotulo.find((d) => d.groupId === salvo.groupId && salvo.groupId !== '') ??
      mesmoRotulo[0];
    if (porRotulo) return { dispositivo: porRotulo, motivo: 'rotulo' };
  }

  return { dispositivo: preferido, motivo: 'assumido' };
}

export function paraSalvar(d: Dispositivo): DispositivoSalvo {
  return { deviceId: d.deviceId, label: d.label, groupId: d.groupId };
}

/**
 * Escolher a saída de áudio não existe em todo navegador.
 *
 * Detecte a capacidade, nunca a versão. Sem ela a lista aparece **desabilitada
 * com o motivo**, jamais escondida: sumir com o controle faz a pessoa procurar
 * por ele.
 */
export function podeEscolherSaida(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export const MOTIVO_SEM_SAIDA =
  'Este navegador não permite escolher a saída de áudio. O som segue o dispositivo padrão do sistema.';

interface ComSinkId {
  setSinkId(id: string): Promise<void>;
}

export async function aplicarSaida(elemento: HTMLMediaElement, deviceId: string): Promise<void> {
  if (!podeEscolherSaida()) return;
  await (elemento as unknown as ComSinkId).setSinkId(deviceId);
}

/**
 * Abre uma trilha só para o navegador revelar os rótulos, e **fecha em
 * seguida**.
 *
 * Deixar a trilha de sondagem aberta para popular um `<select>` acende a luz do
 * aparelho sem chamada nenhuma. É exatamente o tipo de coisa que faz alguém
 * revogar a permissão e não devolver.
 */
export async function sondarPermissao(tipo: 'microfone' | 'camera'): Promise<ListaDeDispositivos> {
  if (!temMidia()) return VAZIA;
  const trilha = await navigator.mediaDevices.getUserMedia(
    tipo === 'microfone' ? { audio: true } : { video: true },
  );
  trilha.getTracks().forEach((t) => t.stop());
  return listarDispositivos();
}

/**
 * `devicechange`.
 *
 * Quem trata a mudança é quem chamou: aqui só avisamos com a lista nova. A
 * regra de quando trocar sozinho está em `decidirTroca` — e é "só se o que
 * estava em uso sumiu", porque trocar para o fone recém-conectado é o
 * comportamento do sistema operacional, não o nosso.
 */
export function observarDispositivos(aoMudar: (lista: ListaDeDispositivos) => void): () => void {
  if (!temMidia() || !navigator.mediaDevices.addEventListener) return () => {};
  const ouvir = () => {
    void listarDispositivos().then(aoMudar);
  };
  navigator.mediaDevices.addEventListener('devicechange', ouvir);
  return () => navigator.mediaDevices.removeEventListener('devicechange', ouvir);
}

export interface Troca {
  /** O que passa a valer, ou `null` se não sobrou nenhum. */
  dispositivo: Dispositivo | null;
  /** Verdadeiro só quando o aparelho em uso sumiu — e aí a pessoa é avisada. */
  avisar: boolean;
}

export function decidirTroca(
  emUso: string | null,
  salvo: DispositivoSalvo | null,
  lista: Dispositivo[],
): Troca {
  // Entrou um aparelho novo, ou saiu um que não estava em uso: a lista muda,
  // nada troca sozinho. Quem escolheu escolheu.
  if (emUso && lista.some((d) => d.deviceId === emUso)) {
    return { dispositivo: lista.find((d) => d.deviceId === emUso) ?? null, avisar: false };
  }
  const escolha = resolverDispositivo(salvo, lista);
  return { dispositivo: escolha.dispositivo, avisar: emUso !== null };
}

/** `voiceIsolation` existe em alguns navegadores e não em outros. */
export function suportaIsolamentoDeVoz(): boolean {
  if (!temMidia() || !navigator.mediaDevices.getSupportedConstraints) return false;
  const suportadas = navigator.mediaDevices.getSupportedConstraints() as Record<string, unknown>;
  return Boolean(suportadas.voiceIsolation);
}

export type ConstraintsDeEntrada = MediaTrackConstraints & { voiceIsolation?: boolean };

/**
 * Os três perfis da tabela.
 *
 * **Estúdio** desliga os quatro processamentos e pede dois canais: microfone
 * bom em sala tratada perde mais com a supressão do que ganha. A ausência de
 * `voiceIsolation` não é erro — o perfil funciona igual, só sem essa camada.
 */
export function constraintsDeEntrada(entrada: {
  deviceId?: string;
  perfil: PerfilDeEntrada;
  personalizado: ConstraintsPersonalizadas;
  temIsolamento?: boolean;
}): ConstraintsDeEntrada {
  const temIsolamento = entrada.temIsolamento ?? suportaIsolamentoDeVoz();
  const base: ConstraintsDeEntrada = entrada.deviceId
    ? { deviceId: { exact: entrada.deviceId } }
    : {};

  if (entrada.perfil === 'estudio') {
    return {
      ...base,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    };
  }

  const alvo =
    entrada.perfil === 'isolamento'
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
        }
      : entrada.personalizado;

  const constraints: ConstraintsDeEntrada = {
    ...base,
    echoCancellation: alvo.echoCancellation,
    noiseSuppression: alvo.noiseSuppression,
    autoGainControl: alvo.autoGainControl,
  };
  if (temIsolamento && alvo.voiceIsolation) constraints.voiceIsolation = true;
  return constraints;
}

const RESOLUCOES: Record<QualidadeDeCamera, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

/**
 * 720p30 é o padrão, e 1080p não é.
 *
 * Com cinco câmeras numa grade de 2x2 e cartões de 400px, a diferença entre as
 * duas é nenhuma; a de banda é o dobro.
 */
export function constraintsDeCamera(
  qualidade: QualidadeDeCamera,
  deviceId?: string,
): MediaTrackConstraints {
  const { width, height } = RESOLUCOES[qualidade];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
  };
}

/**
 * A câmera, pedida **no clique** e nunca ao entrar na chamada.
 *
 * `contentHint: 'motion'` é o oposto do compartilhamento de tela: aqui o codec
 * deve sacrificar detalhe para manter o movimento fluido.
 */
export async function abrirCamera(entrada: {
  qualidade: QualidadeDeCamera;
  deviceId?: string;
}): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: constraintsDeCamera(entrada.qualidade, entrada.deviceId),
  });
  const trilha = stream.getVideoTracks()[0];
  if (trilha) trilha.contentHint = 'motion';
  return stream;
}

/** Fecha tudo o que estiver aberto. Chamado mais vezes do que parece. */
export function encerrar(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * O texto de cada recusa.
 *
 * Nunca "permissão negada": diz **onde clicar**. Uma permissão negada é a pior
 * de reverter, porque exige que a pessoa encontre o cadeado sozinha.
 * Ver docs/07-permissoes-do-navegador.md.
 */
export function explicarErroDeMidia(
  erro: unknown,
  tipo: TipoDeDispositivo | 'tela',
): string | null {
  const nome = (erro as { name?: string } | null)?.name ?? '';
  const mensagem = (erro as { message?: string } | null)?.message ?? '';
  const aparelho = tipo === 'camera' ? 'a câmera' : 'o microfone';

  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    if (tipo === 'tela') {
      // Cancelar o seletor é uma ação legítima, não um erro — e chega aqui com
      // o mesmo nome de quem foi bloqueado pelo sistema. A única diferença é a
      // mensagem citar o sistema; na dúvida ficamos calados, porque um aviso
      // depois de cada cancelamento é pior que nenhum aviso.
      return /system|sistema/i.test(mensagem)
        ? 'O sistema bloqueou a captura de tela. No macOS: Ajustes › Privacidade › Gravação de Tela.'
        : null;
    }
    return `O navegador bloqueou ${aparelho}. Clique no cadeado ao lado do endereço e permita o acesso.`;
  }

  if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError') {
    return tipo === 'camera'
      ? 'Nenhuma câmera encontrada. Conecte uma e ela aparece aqui sozinha.'
      : 'Nenhum microfone encontrado. Conecte um e ele aparece aqui sozinho.';
  }

  if (nome === 'NotReadableError' || nome === 'TrackStartError') {
    return `Outro programa está usando ${aparelho}. Feche-o e tente de novo.`;
  }

  if (nome === 'OverconstrainedError') {
    return 'Esse dispositivo não aceita a qualidade pedida. Tentando com a padrão.';
  }

  return 'Não consegui abrir o dispositivo. Tente de novo.';
}

/* ------------------------------------------------------------------------- *
 * Nível, piso de ruído e portão
 * ------------------------------------------------------------------------- */

/** Rampa do portão. Corte seco estala. */
export const RAMPA_MS = 40;
/** Espera antes de fechar. Sem ela, a última sílaba de cada frase é engolida. */
export const ESPERA_MS = 250;
/** Margem sobre o piso de ruído, no modo automático. */
export const MARGEM_DB = 6;
/** Janela do piso móvel: adapta a ventilador que liga, a janela que abre. */
export const JANELA_DO_PISO_MS = 3000;
const PICO_SEGURA_MS = 800;
const PICO_CAI_MS = 1200;

export function dbfsDeRms(rms: number): number {
  if (rms <= 0) return DBFS_MINIMO;
  return Math.max(DBFS_MINIMO, 20 * Math.log10(rms));
}

/** Mínimo móvel dos últimos 3s, mais a margem. */
export class PisoDeRuido {
  private amostras: { dbfs: number; quando: number }[] = [];

  adicionar(dbfs: number, agora: number): void {
    this.amostras.push({ dbfs, quando: agora });
    const corte = agora - JANELA_DO_PISO_MS;
    while (this.amostras.length > 0 && (this.amostras[0] as { quando: number }).quando < corte) {
      this.amostras.shift();
    }
  }

  limiar(): number {
    if (this.amostras.length === 0) return DBFS_MINIMO + MARGEM_DB;
    let minimo = Infinity;
    for (const a of this.amostras) minimo = Math.min(minimo, a.dbfs);
    return minimo + MARGEM_DB;
  }

  esquecer(): void {
    this.amostras = [];
  }
}

export type ModoDePortao =
  /** Perfil estúdio, ou gate desligado: nunca fecha. */
  | { tipo: 'aberto' }
  | { tipo: 'automatico' }
  | { tipo: 'limiar'; dbfs: number }
  /** Apertar para falar: quem manda é a tecla, não o nível. */
  | { tipo: 'manual'; falando: boolean };

/**
 * Abrir é imediato; fechar espera.
 *
 * A assimetria é a mesma ideia da borda de quem está falando na grade: o que
 * entra rápido e sai devagar não pisca.
 */
export function devePortaoAbrir(entrada: {
  dbfs: number;
  limiar: number;
  aberto: boolean;
  msAbaixoDoLimiar: number;
}): boolean {
  if (entrada.dbfs >= entrada.limiar) return true;
  return entrada.aberto && entrada.msAbaixoDoLimiar < ESPERA_MS;
}

export interface EstadoDoPico {
  pico: number;
  desde: number;
}

/**
 * O pico segura 800ms e cai em 1200ms.
 *
 * Sem a retenção o pico é rápido demais para o olho, e o medidor vira ruído
 * visual em vez de informação.
 */
export function atualizarPico(
  estado: EstadoDoPico,
  dbfs: number,
  agora: number,
): EstadoDoPico {
  if (dbfs >= estado.pico) return { pico: dbfs, desde: agora };
  const parado = agora - estado.desde;
  if (parado <= PICO_SEGURA_MS) return estado;
  const queda = ((parado - PICO_SEGURA_MS) / PICO_CAI_MS) * -DBFS_MINIMO;
  return { pico: Math.max(dbfs, estado.pico - queda), desde: estado.desde };
}

export interface Medicao {
  /** O nível que os outros ouvem, depois do ganho. */
  dbfs: number;
  pico: number;
  /** O portão está deixando passar. É o mesmo sinal do ponto do elenco. */
  aberto: boolean;
  /** O limiar em vigor, para o desenho da linha sobre o medidor. */
  limiar: number;
}

/* ------------------------------------------------------------------------- *
 * A cadeia de entrada
 * ------------------------------------------------------------------------- */

interface OpcoesDaCadeia {
  deviceId?: string;
  perfil: PerfilDeEntrada;
  personalizado: ConstraintsPersonalizadas;
  /** 0 a 200. */
  volumeEntrada: number;
  modo: ModoDePortao;
}

const INTERVALO_MS = 33;
/** Acima disto o relógio parou (aba em segundo plano, máquina suspensa). */
const TIQUE_PERDIDO_MS = 500;

/**
 * captura -> ganho -> analisador -> portão -> destino -> LiveKit
 *
 * Duas coisas explicam esse desenho:
 *
 * O **analisador vem depois do ganho** porque o medidor tem que mostrar o que
 * os outros ouvem, não o que o microfone captou. Um medidor antes do ganho
 * mente exatamente quando importa: a pessoa põe o volume em 150% e o medidor
 * continua igual.
 *
 * E ele vem **antes do portão** porque o limiar é desenhado sobre o medidor.
 * Se o portão já tivesse zerado o sinal, o medidor mostraria silêncio e a linha
 * do limiar não teria sobre o que ser posicionada.
 *
 * O que sobe para o LiveKit é a trilha do `MediaStreamAudioDestinationNode`, e
 * ela **nunca é trocada**. Por isso trocar de microfone no meio da chamada só
 * religa um nó dentro do grafo: os outros passam a ouvir o aparelho novo sem
 * republicação, sem renegociação e sem chamada caindo.
 */
export class CadeiaDeEntrada {
  private constructor(
    private contexto: AudioContext,
    private origem: MediaStreamAudioSourceNode,
    private captura: MediaStream,
    private ganho: GainNode,
    private analisador: AnalyserNode,
    private portao: GainNode,
    private destino: MediaStreamAudioDestinationNode,
    private opcoes: OpcoesDaCadeia,
  ) {
    this.amostrasDeTempo = new Float32Array(new ArrayBuffer(analisador.fftSize * 4));
    this.relogio = setInterval(() => this.tique(), INTERVALO_MS);
  }

  private amostrasDeTempo: Float32Array<ArrayBuffer>;
  private relogio: ReturnType<typeof setInterval>;
  private piso = new PisoDeRuido();
  private estadoDoPico: EstadoDoPico = { pico: DBFS_MINIMO, desde: 0 };
  private aberto = true;
  private abaixoDesde: number | null = null;
  private ultimoTique = 0;
  private medicao: Medicao = {
    dbfs: DBFS_MINIMO,
    pico: DBFS_MINIMO,
    aberto: true,
    limiar: DBFS_MINIMO,
  };

  static async abrir(opcoes: OpcoesDaCadeia): Promise<CadeiaDeEntrada> {
    const captura = await navigator.mediaDevices.getUserMedia({
      audio: constraintsDeEntrada(opcoes),
    });
    const contexto = new AudioContext({ latencyHint: 'interactive' });
    // Contexto criado fora de um gesto nasce suspenso em alguns navegadores.
    if (contexto.state === 'suspended') await contexto.resume();

    const origem = contexto.createMediaStreamSource(captura);
    const ganho = contexto.createGain();
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 1024;
    // Suavização é do domínio da frequência; o RMS aqui é do tempo, e a média
    // que interessa é a nossa (piso móvel e retenção de pico).
    analisador.smoothingTimeConstant = 0;
    const portao = contexto.createGain();
    const destino = contexto.createMediaStreamDestination();

    ganho.gain.value = opcoes.volumeEntrada / 100;
    portao.gain.value = 1;

    origem.connect(ganho);
    ganho.connect(analisador);
    analisador.connect(portao);
    portao.connect(destino);

    return new CadeiaDeEntrada(
      contexto,
      origem,
      captura,
      ganho,
      analisador,
      portao,
      destino,
      opcoes,
    );
  }

  /** A trilha publicada. Estável para toda a vida da cadeia. */
  get trilha(): MediaStreamTrack {
    const t = this.destino.stream.getAudioTracks()[0];
    if (!t) throw new Error('cadeia de entrada sem trilha');
    return t;
  }

  get stream(): MediaStream {
    return this.destino.stream;
  }

  /** O aparelho que está capturando agora. */
  get deviceIdEmUso(): string | null {
    return this.captura.getAudioTracks()[0]?.getSettings().deviceId ?? null;
  }

  definirVolume(porcentagem: number): void {
    this.opcoes.volumeEntrada = porcentagem;
    // Rampa curta: mexer no slider não deve produzir degrau audível.
    this.ganho.gain.setTargetAtTime(porcentagem / 100, this.contexto.currentTime, 0.01);
  }

  definirModo(modo: ModoDePortao): void {
    this.opcoes.modo = modo;
    if (modo.tipo === 'automatico') this.piso.esquecer();
  }

  medir(): Medicao {
    return this.medicao;
  }

  /**
   * Troca o microfone sem derrubar a chamada.
   *
   * A trilha publicada é a do destino e continua a mesma; só a ponta de captura
   * muda. A captura antiga é encerrada **depois** de a nova estar ligada, para
   * não haver um intervalo mudo no meio de uma frase.
   */
  async trocarDispositivo(deviceId: string | undefined): Promise<void> {
    const nova = await navigator.mediaDevices.getUserMedia({
      audio: constraintsDeEntrada({ ...this.opcoes, deviceId }),
    });
    const origemNova = this.contexto.createMediaStreamSource(nova);
    origemNova.connect(this.ganho);
    this.origem.disconnect();
    encerrar(this.captura);
    this.origem = origemNova;
    this.captura = nova;
    this.opcoes.deviceId = deviceId;
    this.piso.esquecer();
  }

  /**
   * Recaptura com outro perfil e republica.
   *
   * Corta o áudio por ~200ms, e por isso a interface avisa "Trocando de
   * perfil…" enquanto acontece.
   */
  async trocarPerfil(
    perfil: PerfilDeEntrada,
    personalizado: ConstraintsPersonalizadas,
  ): Promise<void> {
    this.opcoes.perfil = perfil;
    this.opcoes.personalizado = personalizado;
    // Sem `deviceId` guardado, recaptura do mesmo aparelho que já está em uso;
    // se nem isso, deixa o navegador escolher — nunca `{ exact: '' }`, que é
    // uma restrição impossível e falha com `OverconstrainedError`.
    await this.trocarDispositivo(this.opcoes.deviceId ?? this.deviceIdEmUso ?? undefined);
  }

  async fechar(): Promise<void> {
    clearInterval(this.relogio);
    encerrar(this.captura);
    encerrar(this.destino.stream);
    await this.contexto.close();
  }

  private nivelAgora(): number {
    // `getFloatTimeDomainData` aceita um `Float32Array` sobre `ArrayBuffer`; a
    // cópia local evita alocar 1024 floats trinta vezes por segundo.
    this.analisador.getFloatTimeDomainData(this.amostrasDeTempo);
    let soma = 0;
    for (const amostra of this.amostrasDeTempo) soma += amostra * amostra;
    return dbfsDeRms(Math.sqrt(soma / this.amostrasDeTempo.length));
  }

  private limiarAgora(dbfs: number, agora: number): number {
    const modo = this.opcoes.modo;
    if (modo.tipo === 'limiar') return modo.dbfs;
    if (modo.tipo !== 'automatico') return DBFS_MINIMO;
    this.piso.adicionar(dbfs, agora);
    return this.piso.limiar();
  }

  private tique(): void {
    const agora = Date.now();
    const dbfs = this.nivelAgora();

    // O relógio pode ter parado — aba em segundo plano com o navegador
    // estrangulando temporizadores, ou a máquina suspensa. Nesse caso o piso
    // de ruído e a contagem de espera estão velhos, e decidir com eles pode
    // deixar alguém mudo falando. **Na dúvida, o portão abre.**
    const perdido = this.ultimoTique !== 0 && agora - this.ultimoTique > TIQUE_PERDIDO_MS;
    this.ultimoTique = agora;
    if (perdido) {
      this.piso.esquecer();
      this.abaixoDesde = null;
      this.aplicarPortao(true);
      return;
    }

    const modo = this.opcoes.modo;
    const limiar = this.limiarAgora(dbfs, agora);

    let aberto: boolean;
    if (modo.tipo === 'aberto') {
      aberto = true;
    } else if (modo.tipo === 'manual') {
      aberto = modo.falando;
    } else {
      if (dbfs >= limiar) this.abaixoDesde = null;
      else if (this.abaixoDesde === null) this.abaixoDesde = agora;
      aberto = devePortaoAbrir({
        dbfs,
        limiar,
        aberto: this.aberto,
        msAbaixoDoLimiar: this.abaixoDesde === null ? 0 : agora - this.abaixoDesde,
      });
    }

    this.estadoDoPico = atualizarPico(this.estadoDoPico, dbfs, agora);
    this.aplicarPortao(aberto);
    this.medicao = { dbfs, pico: this.estadoDoPico.pico, aberto, limiar };
  }

  private aplicarPortao(aberto: boolean): void {
    if (aberto === this.aberto) return;
    this.aberto = aberto;
    const alvo = aberto ? 1 : 0;
    const t = this.contexto.currentTime;
    this.portao.gain.cancelScheduledValues(t);
    this.portao.gain.setValueAtTime(this.portao.gain.value, t);
    this.portao.gain.linearRampToValueAtTime(alvo, t + RAMPA_MS / 1000);
  }
}
