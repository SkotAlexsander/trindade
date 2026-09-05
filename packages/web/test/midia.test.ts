import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAVE,
  DBFS_MINIMO,
  PADRAO,
  definirArmazem,
  esquecerCache,
  lerPreferencias,
  salvarPreferencias,
  sanear,
  type Armazem,
} from '../src/lib/preferencias';
import {
  ESPERA_MS,
  MARGEM_DB,
  PisoDeRuido,
  atualizarPico,
  constraintsDeCamera,
  constraintsDeEntrada,
  dbfsDeRms,
  estadoDaPermissao,
  decidirTroca,
  observarDispositivos,
  devePortaoAbrir,
  ehDoSistema,
  explicarErroDeMidia,
  organizarDispositivos,
  resolverDispositivo,
  type Dispositivo,
} from '../src/lib/midia';

/**
 * A camada de dispositivo, nas partes que não precisam de navegador.
 *
 * O grafo de áudio e a captura ficam para o Playwright e para a chamada de
 * verdade; o que está aqui é a lógica que erra em silêncio — a cascata que
 * escolhe o microfone errado, o gate que come a última sílaba, o piso de ruído
 * que não esquece o ventilador que desligou.
 */

function mic(deviceId: string, label: string, groupId = 'g'): Dispositivo {
  return { deviceId, label, groupId };
}

describe('a cascata que escolhe o dispositivo', () => {
  const lista = [
    mic('default', 'Padrão - Fone USB', 'g1'),
    mic('aaa', 'Fone USB', 'g1'),
    mic('bbb', 'Microfone do notebook', 'g2'),
  ];

  it('usa o deviceId quando ele ainda existe', () => {
    const r = resolverDispositivo({ deviceId: 'bbb', label: 'qualquer', groupId: '' }, lista);
    expect(r.dispositivo?.deviceId).toBe('bbb');
    expect(r.motivo).toBe('id');
  });

  it('cai para o rótulo quando o id mudou', () => {
    // `deviceId` é derivado do aparelho **e** da origem, e some quando alguém
    // limpa os dados do site. Sem esta etapa, a escolha desaparece um dia sem
    // explicação nenhuma.
    const r = resolverDispositivo({ deviceId: 'antigo', label: 'Fone USB', groupId: 'g1' }, lista);
    expect(r.dispositivo?.deviceId).toBe('aaa');
    expect(r.motivo).toBe('rotulo');
  });

  it('o groupId desempata dois aparelhos de mesmo nome', () => {
    const dois = [mic('x', 'Realtek', 'ga'), mic('y', 'Realtek', 'gb')];
    const r = resolverDispositivo({ deviceId: 'sumiu', label: 'Realtek', groupId: 'gb' }, dois);
    expect(r.dispositivo?.deviceId).toBe('y');
  });

  it('sem nada que bata, assume um e diz que assumiu', () => {
    const r = resolverDispositivo({ deviceId: 'sumiu', label: 'Interface XLR', groupId: '' }, lista);
    expect(r.dispositivo?.deviceId).toBe('default');
    // O motivo é o que faz a interface mostrar "Microfone não encontrado.
    // Usando Fone USB." Trocar em silêncio é pior que trocar avisando.
    expect(r.motivo).toBe('assumido');
  });

  it('sem escolha guardada não há aviso nenhum', () => {
    const r = resolverDispositivo(null, lista);
    expect(r.motivo).toBe('padrao');
  });

  it('e sem dispositivo nenhum devolve nulo', () => {
    expect(resolverDispositivo(null, []).motivo).toBe('nenhum');
  });
});

describe('tirar e pôr no meio da chamada', () => {
  const antes = [mic('aaa', 'Fone USB'), mic('bbb', 'Notebook')];

  it('aparelho novo não troca nada sozinho', () => {
    // Trocar para o fone recém-conectado é o comportamento do sistema
    // operacional, não o nosso. Aqui, quem escolheu escolheu.
    const depois = [...antes, mic('ccc', 'Fone novo')];
    const t = decidirTroca('bbb', { deviceId: 'bbb', label: 'Notebook', groupId: 'g' }, depois);
    expect(t.dispositivo?.deviceId).toBe('bbb');
    expect(t.avisar).toBe(false);
  });

  it('sumiu um que não estava em uso: só a lista muda', () => {
    const t = decidirTroca('aaa', { deviceId: 'aaa', label: 'Fone USB', groupId: 'g' }, [
      mic('aaa', 'Fone USB'),
    ]);
    expect(t.avisar).toBe(false);
  });

  it('sumiu o que estava em uso: cai para o próximo e avisa qual', () => {
    const t = decidirTroca('aaa', { deviceId: 'aaa', label: 'Fone USB', groupId: 'g' }, [
      mic('bbb', 'Notebook'),
    ]);
    expect(t.dispositivo?.deviceId).toBe('bbb');
    expect(t.avisar).toBe(true);
  });
});

describe('o ouvinte de `devicechange`', () => {
  /*
   * A decisão já era testada; o **ouvinte** não era, e ninguém o chamava.
   * Tirar o fone no meio da conversa deixava a chamada num aparelho que não
   * existe mais — a tabela de design/13-dispositivos-e-audio.md descrevia um
   * comportamento que o produto não tinha.
   */
  const original = globalThis.navigator;

  function comMediaDevices(mock: unknown): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: mock },
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });

  it('assina e devolve como desassinar', () => {
    const assinados: string[] = [];
    const removidos: string[] = [];
    comMediaDevices({
      addEventListener: (nome: string) => assinados.push(nome),
      removeEventListener: (nome: string) => removidos.push(nome),
      enumerateDevices: () => Promise.resolve([]),
    });

    const parar = observarDispositivos(() => {});
    expect(assinados).toEqual(['devicechange']);
    parar();
    expect(removidos).toEqual(['devicechange']);
  });

  it('sem suporte, devolve uma função que não faz nada', () => {
    // Não é hipótese: `mediaDevices` não existe em contexto inseguro, e um
    // `undefined` chamado no fim da chamada derrubaria a saída dela.
    comMediaDevices(undefined);
    expect(() => observarDispositivos(() => {})()).not.toThrow();
  });
});

describe('os pseudodispositivos do Windows', () => {
  it('vão para o topo, separados, e não escondidos', () => {
    const { sistema, reais } = organizarDispositivos([
      mic('default', 'Padrão - Realtek'),
      mic('communications', 'Comunicação - Realtek'),
      mic('abc', 'Realtek'),
    ]);
    expect(sistema.map((d) => d.deviceId)).toEqual(['default', 'communications']);
    expect(reais).toHaveLength(1);
    expect(ehDoSistema(mic('abc', 'Realtek'))).toBe(false);
  });
});

describe('perfis de entrada', () => {
  const personalizado = {
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: false,
    voiceIsolation: true,
  };

  it('isolamento liga os quatro processamentos', () => {
    const c = constraintsDeEntrada({
      perfil: 'isolamento',
      personalizado,
      temIsolamento: true,
      deviceId: 'aaa',
    });
    expect(c).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
    });
    expect(c.deviceId).toEqual({ exact: 'aaa' });
  });

  it('sem voiceIsolation no navegador o perfil funciona igual', () => {
    // A ausência não é caso de erro: é uma camada a menos.
    const c = constraintsDeEntrada({ perfil: 'isolamento', personalizado, temIsolamento: false });
    expect(c.voiceIsolation).toBeUndefined();
    expect(c.noiseSuppression).toBe(true);
  });

  it('estúdio desliga tudo e pede dois canais', () => {
    const c = constraintsDeEntrada({ perfil: 'estudio', personalizado, temIsolamento: true });
    expect(c).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    });
    expect(c.voiceIsolation).toBeUndefined();
  });

  it('personalizado respeita caixa por caixa', () => {
    const c = constraintsDeEntrada({ perfil: 'personalizado', personalizado, temIsolamento: true });
    expect(c.echoCancellation).toBe(false);
    expect(c.autoGainControl).toBe(false);
    expect(c.noiseSuppression).toBe(true);
  });

  it('sem deviceId não manda restrição impossível', () => {
    // `{ exact: '' }` é o jeito de transformar "tanto faz" em
    // OverconstrainedError.
    expect(constraintsDeEntrada({ perfil: 'isolamento', personalizado }).deviceId).toBeUndefined();
  });
});

describe('a câmera', () => {
  it('720p é o padrão da tabela e 1080p é o dobro de banda por nada', () => {
    expect(constraintsDeCamera('720p')).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
    expect(constraintsDeCamera('1080p').width).toEqual({ ideal: 1920 });
  });
});

describe('o portão', () => {
  it('abre na hora em que a voz passa do limiar', () => {
    expect(
      devePortaoAbrir({ dbfs: -30, limiar: -45, aberto: false, msAbaixoDoLimiar: 0 }),
    ).toBe(true);
  });

  it('não fecha na primeira pausa: espera 250ms', () => {
    // Sem a espera, a última sílaba de cada frase é engolida.
    expect(
      devePortaoAbrir({ dbfs: -70, limiar: -45, aberto: true, msAbaixoDoLimiar: 200 }),
    ).toBe(true);
    expect(
      devePortaoAbrir({ dbfs: -70, limiar: -45, aberto: true, msAbaixoDoLimiar: ESPERA_MS }),
    ).toBe(false);
  });

  it('e fechado continua fechado enquanto o silêncio durar', () => {
    expect(
      devePortaoAbrir({ dbfs: -80, limiar: -45, aberto: false, msAbaixoDoLimiar: 10 }),
    ).toBe(false);
  });
});

describe('o piso de ruído móvel', () => {
  it('é o mínimo dos últimos 3s mais a margem', () => {
    const piso = new PisoDeRuido();
    piso.adicionar(-60, 1000);
    piso.adicionar(-20, 1500);
    piso.adicionar(-58, 2000);
    expect(piso.limiar()).toBeCloseTo(-60 + MARGEM_DB);
  });

  it('esquece o que saiu da janela — o ventilador que desligou', () => {
    const piso = new PisoDeRuido();
    piso.adicionar(-90, 0);
    piso.adicionar(-40, 3500);
    expect(piso.limiar()).toBeCloseTo(-40 + MARGEM_DB);
  });
});

describe('o medidor', () => {
  it('dBFS de silêncio digital não é menos infinito', () => {
    expect(dbfsDeRms(0)).toBe(DBFS_MINIMO);
    expect(dbfsDeRms(1)).toBeCloseTo(0);
    expect(dbfsDeRms(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('o pico segura 800ms antes de começar a cair', () => {
    // Sem a retenção, o pico é rápido demais para o olho e o medidor vira
    // ruído visual.
    const subiu = atualizarPico({ pico: DBFS_MINIMO, desde: 0 }, -10, 1000);
    expect(subiu.pico).toBe(-10);

    const segurando = atualizarPico(subiu, -60, 1700);
    expect(segurando.pico).toBe(-10);

    // 300ms de queda dentro dos 1200 da escala inteira: um quarto do caminho.
    const caindo = atualizarPico(subiu, -60, 2100);
    expect(caindo.pico).toBeCloseTo(-35, 1);

    // E depois dos 1200 já alcançou o sinal.
    expect(atualizarPico(subiu, -60, 3100).pico).toBe(-60);
  });

  it('e nunca cai abaixo do sinal atual', () => {
    const depois = atualizarPico({ pico: -10, desde: 0 }, -12, 9000);
    expect(depois.pico).toBe(-12);
  });
});

describe('o texto de cada recusa', () => {
  it('diz onde clicar, não "permissão negada"', () => {
    const texto = explicarErroDeMidia({ name: 'NotAllowedError' }, 'microfone');
    expect(texto).toContain('cadeado');
    expect(texto).not.toMatch(/permissão negada/i);
  });

  it('cancelar o seletor de tela não é erro', () => {
    expect(explicarErroDeMidia({ name: 'NotAllowedError', message: 'Permission denied' }, 'tela'))
      .toBeNull();
  });

  it('mas bloqueio do sistema diz onde é o ajuste', () => {
    const texto = explicarErroDeMidia(
      { name: 'NotAllowedError', message: 'Permission denied by system' },
      'tela',
    );
    expect(texto).toContain('Gravação de Tela');
  });

  it('nenhum microfone no sistema é um estado, com o que fazer', () => {
    expect(explicarErroDeMidia({ name: 'NotFoundError' }, 'microfone')).toContain('Conecte');
  });

  it('aparelho ocupado por outro programa não vira "erro desconhecido"', () => {
    expect(explicarErroDeMidia({ name: 'NotReadableError' }, 'camera')).toContain('Outro programa');
  });
});

describe('perguntar antes de pedir', () => {
  const original = globalThis.navigator;

  function comPermissoes(query: unknown): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { permissions: query ? { query } : undefined },
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });

  it('traduz os três estados do navegador', async () => {
    comPermissoes(() => Promise.resolve({ state: 'granted' }));
    expect(await estadoDaPermissao('microfone')).toBe('concedida');

    comPermissoes(() => Promise.resolve({ state: 'denied' }));
    expect(await estadoDaPermissao('microfone')).toBe('negada');

    comPermissoes(() => Promise.resolve({ state: 'prompt' }));
    expect(await estadoDaPermissao('camera')).toBe('perguntar');
  });

  it('não saber é diferente de estar negado', async () => {
    // O Firefox lança para `camera` e `microphone`; navegador sem a API
    // simplesmente não responde. Tratar isso como "negada" mostraria
    // "bloqueado" para quem nunca foi perguntado.
    comPermissoes(() => Promise.reject(new Error('sem suporte')));
    expect(await estadoDaPermissao('camera')).toBe('desconhecido');

    comPermissoes(null);
    expect(await estadoDaPermissao('microfone')).toBe('desconhecido');
  });
});

describe('preferências de mídia', () => {
  let guardado: Record<string, string>;

  beforeEach(() => {
    guardado = {};
    const falso: Armazem = {
      ler: (c) => guardado[c] ?? null,
      gravar: (c, v) => {
        guardado[c] = v;
      },
    };
    definirArmazem(falso);
    esquecerCache();
  });

  it('sem nada gravado, os padrões', () => {
    expect(lerPreferencias()).toEqual(PADRAO);
  });

  it('entrar e sair de alguém vem desligado', () => {
    // Com cinco pessoas entrando o dia inteiro, ligados viram ruído que se
    // aprende a ignorar — e aí os outros três sons também são ignorados.
    expect(PADRAO.sons.alguemEntrou).toBe(false);
    expect(PADRAO.sons.alguemSaiu).toBe(false);
    expect(PADRAO.sons.entrada).toBe(true);
  });

  it('grava sob trindade:midia e relê igual', () => {
    salvarPreferencias({ volumeEntrada: 150, gateAutomatico: false, limiarDbfs: -38 });
    esquecerCache();
    const p = lerPreferencias();
    expect(p.volumeEntrada).toBe(150);
    expect(p.limiarDbfs).toBe(-38);
    expect(Object.keys(guardado)).toEqual([CHAVE]);
  });

  it('JSON corrompido vira o padrão, não uma tela quebrada', () => {
    guardado[CHAVE] = '{isto não é json';
    esquecerCache();
    expect(lerPreferencias()).toEqual(PADRAO);
  });

  it('valor de tipo errado não vira estado da aplicação', () => {
    const p = sanear({ volumeEntrada: 'muito', perfil: 'turbo', sons: 7 });
    expect(p.volumeEntrada).toBe(PADRAO.volumeEntrada);
    expect(p.perfil).toBe('isolamento');
    expect(p.sons).toEqual(PADRAO.sons);
  });

  it('e número fora da faixa é preso na faixa', () => {
    expect(sanear({ volumeEntrada: 900 }).volumeEntrada).toBe(200);
    expect(sanear({ limiarDbfs: 40 }).limiarDbfs).toBe(0);
    expect(sanear({ atrasoAoSoltarMs: -5 }).atrasoAoSoltarMs).toBe(0);
  });

  it('campo desconhecido não sobrevive à leitura', () => {
    // O efeito que interessa: se um dia alguém escrever um token aqui por
    // engano, ele não volta. Credencial nenhuma passa por este módulo.
    guardado[CHAVE] = JSON.stringify({ ...PADRAO, access: 'ey.um.token' });
    esquecerCache();
    expect(lerPreferencias()).not.toHaveProperty('access');

    salvarPreferencias({ volumeSaida: 80 });
    expect(guardado[CHAVE]).not.toContain('token');
  });

  it('o dispositivo guardado tem os três campos', () => {
    salvarPreferencias({ microfone: { deviceId: 'aaa', label: 'Fone USB', groupId: 'g1' } });
    esquecerCache();
    expect(lerPreferencias().microfone).toEqual({
      deviceId: 'aaa',
      label: 'Fone USB',
      groupId: 'g1',
    });
  });

  it('dispositivo sem deviceId não é dispositivo', () => {
    expect(sanear({ microfone: { label: 'só o rótulo' } }).microfone).toBeNull();
  });
});
