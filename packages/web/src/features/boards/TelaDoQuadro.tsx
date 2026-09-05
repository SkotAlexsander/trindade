import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { User } from '@trindade/shared';
import { useTheme } from '../../lib/tema';
import type { ArquivoDoQuadro, ProvedorDoQuadro } from './provedor';
import { baixarImagemDoQuadro, mandarImagemDoQuadro } from './queries';
import { cenaDoMapa, mudancasParaOMapa, type ElementoDoQuadro } from './sincronia';
import '@excalidraw/excalidraw/index.css';

/**
 * O canvas, e a ponte entre ele e o CRDT.
 *
 * Este arquivo é carregado sob demanda: o Excalidraw pesa mais que o resto do
 * produto somado, e quem nunca abre um quadro não pode pagar por ele na tela de
 * entrar — a mesma decisão do zxcvbn e do Shiki.
 *
 * A ponte tem dois sentidos e um cuidado em cada um:
 *
 * - **daqui para o mapa**: só o que mudou de versão, senão cada movimento do
 *   mouse geraria um delta do tamanho do quadro;
 * - **do mapa para cá**: só quando a alteração veio da rede. Aplicar o que a
 *   própria pessoa acabou de desenhar refaria a cena embaixo da mão dela.
 *
 * O laço não se fecha sozinho: aplicar elementos remotos dispara o `onChange`,
 * mas ali as versões já batem com o mapa e nada é escrito de volta.
 */

const ORIGEM_LOCAL = 'local';

/** O que cada pessoa publica na awareness do quadro. */
interface EstadoDeAlguem {
  user?: { id?: string; name?: string; color?: string };
  pointer?: { x: number; y: number } | null;
  viewport?: { scrollX: number; scrollY: number; zoom: number } | null;
  desenhistas?: string[];
}

export interface TelaDoQuadroProps {
  provedor: ProvedorDoQuadro;
  /** Para onde as imagens coladas sobem. */
  boardId: string;
  podeEditar: boolean;
  /** No teto de elementos: o que já está desenhado continua editável. */
  cheio: boolean;
  /** Para desenhar nome e cor de quem está junto. */
  pessoas: readonly User[];
  /**
   * A cena, a cada alteração.
   *
   * Existe para a miniatura: ela é gerada quando o quadro fecha, e nesse
   * instante o Excalidraw já esvaziou a própria cena — `getSceneElements()`
   * devolve zero para quem perguntar tarde demais. Guardar o último estado
   * conhecido é o que sobrou de verdade para exportar.
   */
  aoMudarCena: (cena: {
    elementos: readonly unknown[];
    arquivos: unknown;
    /** Ids do que está selecionado — é o que "enviar no canal" recorta. */
    selecionados: readonly string[];
  }) => void;
  /** Colada assim que a tela abre, quando o quadro nasceu de uma imagem. */
  imagemInicial?: { url: string; nome: string };
  /** Quem está conduzindo, se alguém estiver. */
  apresentador: string | null;
  euApresento: boolean;
  /** Este espectador está seguindo o enquadramento de quem apresenta? */
  seguindo: boolean;
  /** Quem recebeu a caneta, dito pela awareness de quem apresenta. */
  aoMudarDesenhistas: (lista: string[]) => void;
}

export function TelaDoQuadro({
  provedor,
  boardId,
  podeEditar,
  cheio,
  pessoas,
  aoMudarCena,
  imagemInicial,
  apresentador,
  euApresento,
  seguindo,
  aoMudarDesenhistas,
}: TelaDoQuadroProps) {
  const { resolved } = useTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const cenaInicial = useMemo(
    () => cenaDoMapa(provedor.elementos.values()),
    [provedor],
  );

  // --- do mapa para a tela --------------------------------------------------
  useEffect(() => {
    const aplicar = (_eventos: unknown, transacao: { origin: unknown }) => {
      if (transacao.origin === ORIGEM_LOCAL) return;
      apiRef.current?.updateScene({
        elements: cenaDoMapa(provedor.elementos.values()) as never,
      });
    };

    provedor.elementos.observe(aplicar);
    return () => provedor.elementos.unobserve(aplicar);
  }, [provedor]);

  /* --- imagens -------------------------------------------------------------
   *
   * O Excalidraw guarda na cena um `fileId` e os bytes num dicionário à parte.
   * Os bytes **não** entram no CRDT: uma foto vira megabytes de base64 dentro
   * de cada delta, e dois desenhos com imagem acabariam com o quadro. Eles
   * sobem pelo caminho de todo upload — multipart, `sharp`, storage — e o que
   * atravessa o documento é o par `fileId` → URL.
   */
  const subindo = useRef(new Set<string>());
  const baixando = useRef(new Set<string>());

  const cuidarDasImagens = useCallback(
    (arquivos: unknown) => {
      const dicionario = (arquivos ?? {}) as Record<
        string,
        { dataURL?: string; mimeType?: string }
      >;

      for (const [id, arquivo] of Object.entries(dicionario)) {
        if (!arquivo?.dataURL) continue;
        // Já está no documento, ou já está subindo: o `onChange` dispara a cada
        // movimento do mouse, e sem esta guarda a mesma foto subiria cem vezes.
        if (provedor.arquivos.has(id) || subindo.current.has(id)) continue;
        if (!arquivo.dataURL.startsWith('data:')) continue;

        subindo.current.add(id);
        void mandarImagemDoQuadro(boardId, id, arquivo.dataURL).then((guardado) => {
          if (!guardado) {
            // Deixa tentar de novo no próximo `onChange`: a imagem continua na
            // tela de quem colou, e o que falhou foi a viagem.
            subindo.current.delete(id);
            return;
          }
          provedor.doc.transact(() => {
            provedor.arquivos.set(id, guardado);
          }, ORIGEM_LOCAL);
        });
      }
    },
    [provedor, boardId],
  );

  /** Traz para esta tela as imagens que já estão no documento. */
  const buscarImagens = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    const jaTenho = new Set(Object.keys(api.getFiles() ?? {}));
    for (const [id, valor] of provedor.arquivos.entries()) {
      if (jaTenho.has(id) || baixando.current.has(id)) continue;
      const arquivo = valor as ArquivoDoQuadro;
      if (!arquivo?.url) continue;

      baixando.current.add(id);
      void baixarImagemDoQuadro(arquivo.url).then((dataURL) => {
        if (!dataURL) {
          baixando.current.delete(id);
          return;
        }
        apiRef.current?.addFiles([
          {
            id: id as never,
            dataURL: dataURL as never,
            mimeType: (arquivo.contentType ?? 'image/webp') as never,
            created: Date.now(),
          },
        ]);
      });
    }
  }, [provedor]);

  useEffect(() => {
    provedor.arquivos.observe(buscarImagens);
    buscarImagens();
    return () => provedor.arquivos.unobserve(buscarImagens);
  }, [provedor, buscarImagens]);

  // --- da tela para o mapa --------------------------------------------------
  //
  // Num ref, e não na dependência do callback: o teto muda a cada elemento, e
  // refazer o `onChange` do Excalidraw a cada traço custa mais que a leitura.
  const cheioRef = useRef(cheio);
  cheioRef.current = cheio;

  const aoMudar = useCallback(
    (elementos: readonly unknown[], estado: unknown, arquivos: unknown) => {
      const selecionados = Object.keys(
        (estado as { selectedElementIds?: Record<string, boolean> })?.selectedElementIds ?? {},
      );
      aoMudarCena({ elementos, arquivos, selecionados });
      cuidarDasImagens(arquivos);

      const cena = elementos as readonly ElementoDoQuadro[];
      let mudou = mudancasParaOMapa(cena, (id) =>
        provedor.elementos.get(id) as ElementoDoQuadro | undefined,
      );
      if (mudou.length === 0) return;

      /* No teto, elemento **novo** não entra; o que já existe continua se
         movendo e se apagando. Bloquear a tela inteira seria a armadilha
         perfeita: um quadro cheio em que nem dá para apagar nada para caber
         de novo. Quem tentar desenhar vê a forma sumir e a faixa dizendo por
         quê. */
      if (cheioRef.current) {
        const novos = mudou.filter(
          (e) => !provedor.elementos.has(e.id) && e.isDeleted !== true,
        );
        if (novos.length > 0) {
          mudou = mudou.filter((e) => !novos.includes(e));
          apiRef.current?.updateScene({
            elements: cenaDoMapa(provedor.elementos.values()) as never,
          });
        }
      }
      if (mudou.length === 0) return;

      /* Uma transação só para o lote inteiro: mover cinco formas juntas é um
         delta, não cinco. E marcada como local, senão o observador acima
         redesenharia a cena a cada traço da própria pessoa. */
      provedor.doc.transact(() => {
        for (const elemento of mudou) provedor.elementos.set(elemento.id, elemento);
      }, ORIGEM_LOCAL);
    },
    [provedor, aoMudarCena, cuidarDasImagens],
  );

  /**
   * A imagem que abriu o quadro.
   *
   * Vem de "abrir no quadro" numa imagem da conversa. Ela entra como elemento
   * montado pelo `convertToExcalidrawElements` — o construtor público do
   * próprio Excalidraw — e não por um evento de colar sintético: colar exige o
   * foco no canvas, e no instante em que o quadro abre o foco está em qualquer
   * outro lugar. O quadro abria vazio e ninguém sabia por quê.
   *
   * O arquivo é registrado com `addFiles`; a partir daí ele é uma imagem como
   * qualquer outra e sobe pelo caminho de sempre.
   */
  /* A guarda é a **identidade da API**, e não um booleano: no StrictMode o
     componente monta, desmonta e remonta com os mesmos refs, e um `true` da
     primeira passagem bloquearia a segunda — que é a que está viva. A primeira
     terminava chamando `updateScene` num Excalidraw já descartado, e o React
     avisava "can't call setState on a component that is not yet mounted"
     enquanto o quadro abria vazio. */
  const inseridaPara = useRef<unknown>(null);

  const inserirImagemInicial = useCallback(() => {
    const api = apiRef.current;
    if (!imagemInicial || !api || inseridaPara.current === api) return;
    inseridaPara.current = api;

    void (async () => {
      try {
        const bytes = await fetch(imagemInicial.url).then((r) => r.blob());
        const dataURL = await new Promise<string>((resolver, rejeitar) => {
          const leitor = new FileReader();
          leitor.onload = () => resolver(String(leitor.result));
          leitor.onerror = () => rejeitar(new Error('não consegui ler a imagem'));
          leitor.readAsDataURL(bytes);
        });

        // O tamanho real: sem ele a imagem entraria esticada, e "abrir no
        // quadro" já começaria com trabalho para a pessoa.
        const medida = await new Promise<{ largura: number; altura: number }>((resolver) => {
          const img = new Image();
          img.onload = () => resolver({ largura: img.naturalWidth, altura: img.naturalHeight });
          img.onerror = () => resolver({ largura: 400, altura: 300 });
          img.src = dataURL;
        });

        const escala = Math.min(1, 800 / Math.max(medida.largura, medida.altura));
        const fileId = crypto.randomUUID().replace(/-/g, '');

        api.addFiles([
          {
            id: fileId as never,
            dataURL: dataURL as never,
            mimeType: (bytes.type || 'image/webp') as never,
            created: Date.now(),
          },
        ]);

        const novo = convertToExcalidrawElements([
          {
            type: 'image',
            fileId: fileId as never,
            x: 0,
            y: 0,
            width: Math.round(medida.largura * escala),
            height: Math.round(medida.altura * escala),
          },
        ]);

        api.updateScene({
          elements: [...api.getSceneElementsIncludingDeleted(), ...novo] as never,
        });
        api.scrollToContent(novo[0], { fitToContent: true });
      } catch {
        /* a imagem não veio: o quadro abre vazio, que é melhor que não abrir. */
      }
    })();
  }, [imagemInicial]);

  // --- quem está junto ------------------------------------------------------
  //
  // O cursor dos outros vem da awareness, que é efêmera e não passa pelo banco:
  // onde alguém estava com o mouse há dois segundos não é informação para
  // guardar.
  /* Em refs, e não nas dependências do efeito: a awareness muda a cada
     movimento de mouse de qualquer pessoa, e reassinar o ouvinte a cada
     mudança de "seguindo" recomeçaria a conta do zero no meio da apresentação. */
  const apresentadorRef = useRef(apresentador);
  apresentadorRef.current = apresentador;
  const seguindoRef = useRef(seguindo);
  seguindoRef.current = seguindo;
  const canetasRef = useRef('');

  useEffect(() => {
    const aoMudarAlgoDeAlguem = () => {
      const api = apiRef.current;
      if (!api) return;

      const colegas = new Map<string, unknown>();
      let daApresentadora: EstadoDeAlguem | null = null;

      for (const [clientId, estado] of provedor.awareness.getStates()) {
        const dele = estado as EstadoDeAlguem;
        if (!dele.user?.id) continue;
        if (dele.user.id === apresentadorRef.current) daApresentadora = dele;
        if (clientId === provedor.awareness.clientID) continue;

        const quem = pessoas.find((p) => p.id === dele.user?.id);
        colegas.set(String(clientId), {
          id: dele.user.id,
          username: quem?.displayName.split(' ')[0] ?? dele.user.name ?? 'Alguém',
          avatarUrl: quem?.avatarUrl ?? undefined,
          color: { background: dele.user.color ?? '#22d3ee', stroke: '#00000033' },
          pointer: dele.pointer ? { ...dele.pointer, tool: 'pointer' } : undefined,
        });
      }

      api.updateScene({ collaborators: colegas as never });

      /* O enquadramento de quem apresenta, aplicado a cada mudança. O atraso
         que se vê é o da rede: não há animação nem interpolação aqui, porque
         o que se quer é "estamos olhando a mesma coisa", não um travelling. */
      const viewport = daApresentadora?.viewport;
      if (viewport && seguindoRef.current && apresentadorRef.current) {
        api.updateScene({
          appState: {
            scrollX: viewport.scrollX,
            scrollY: viewport.scrollY,
            zoom: { value: viewport.zoom as never },
          },
        });
      }

      // A caneta sobe para a barra só quando a lista muda de verdade: senão
      // seria um `setState` por movimento de mouse de qualquer pessoa.
      const canetas = daApresentadora?.desenhistas ?? [];
      const assinatura = canetas.join(',');
      if (assinatura !== canetasRef.current) {
        canetasRef.current = assinatura;
        aoMudarDesenhistas(canetas);
      }
    };

    provedor.awareness.on('change', aoMudarAlgoDeAlguem);
    aoMudarAlgoDeAlguem();
    return () => provedor.awareness.off('change', aoMudarAlgoDeAlguem);
  }, [provedor, pessoas, aoMudarDesenhistas]);

  /* O apontador vai com folga de 50ms. Sem ela, um movimento de mouse são
     dezenas de mensagens por segundo, cada uma acordando todo mundo que está
     com o quadro aberto — e ninguém percebe a diferença entre 20 e 60 quadros
     por segundo num ponto colorido.

     E ele **some 1,5s depois de parar**: um ponto parado no meio do desenho
     deixa de ser "olha isso aqui" e vira sujeira na tela de todo mundo. */
  const ultimoEnvio = useRef(0);
  const sumico = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aoMoverPonteiro = useCallback(
    ({ pointer }: { pointer: { x: number; y: number } }) => {
      const agora = performance.now();
      if (agora - ultimoEnvio.current >= 50) {
        ultimoEnvio.current = agora;
        provedor.awareness.setLocalStateField('pointer', { x: pointer.x, y: pointer.y });
      }

      if (sumico.current) clearTimeout(sumico.current);
      sumico.current = setTimeout(() => {
        sumico.current = null;
        provedor.awareness.setLocalStateField('pointer', null);
      }, 1500);
    },
    [provedor],
  );

  useEffect(() => {
    return () => {
      if (sumico.current) clearTimeout(sumico.current);
    };
  }, []);

  /* O enquadramento de quem apresenta, publicado a cada rolagem e a cada zoom,
     com a mesma folga de 50ms. Quem não está apresentando não publica nada —
     seria dizer aos outros para onde olhar sem ninguém ter pedido. */
  const ultimaViewport = useRef(0);
  const aoRolar = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      if (!euApresento) return;
      const agora = performance.now();
      if (agora - ultimaViewport.current < 50) return;
      ultimaViewport.current = agora;
      provedor.awareness.setLocalStateField('viewport', { scrollX, scrollY, zoom: zoom.value });
    },
    [provedor, euApresento],
  );

  // Deixar de apresentar tira o enquadramento do ar: sem isto, quem voltasse a
  // seguir depois seria levado ao último quadro de uma apresentação encerrada.
  useEffect(() => {
    if (!euApresento) provedor.awareness.setLocalStateField('viewport', null);
  }, [provedor, euApresento]);

  return (
    <Excalidraw
      excalidrawAPI={(api) => {
        apiRef.current = api;
        // O documento pode já ter imagens quando esta tela abre; o observador
        // só cobre o que muda daqui para a frente.
        buscarImagens();
        inserirImagemInicial();
      }}
      /* O fundo é branco **nos dois temas**, de propósito: no escuro o
         Excalidraw inverte o canvas inteiro por filtro, e um fundo já escuro
         aqui chega invertido do outro lado — foi um quadro cinza-claro sobre
         um aplicativo preto até esta linha mudar. */
      initialData={{
        elements: cenaInicial as never,
        appState: { viewBackgroundColor: '#ffffff' },
        scrollToContent: true,
      }}
      onChange={aoMudar}
      onPointerUpdate={aoMoverPonteiro}
      onScrollChange={aoRolar}
      isCollaborating
      viewModeEnabled={!podeEditar}
      theme={resolved}
      langCode="pt-BR"
      name="Quadro"
      UIOptions={{
        canvasActions: {
          // Não existe "arquivo" aqui: o quadro vive no servidor, e um botão
          // de salvar num CRDT ensina a coisa errada. Exportar imagem fica —
          // é o gesto de tirar o desenho daqui para levar a outro lugar.
          loadScene: false,
          saveToActiveFile: false,
          // O tema é o do produto. Duas trocas de tema na mesma tela deixariam
          // a barra clara sobre o aplicativo escuro.
          toggleTheme: false,
        },
        /* A imagem entra: os bytes sobem pelo upload de sempre e o documento
           carrega só o endereço. Ver `cuidarDasImagens`. */
        tools: { image: true },
      }}
    />
  );
}
