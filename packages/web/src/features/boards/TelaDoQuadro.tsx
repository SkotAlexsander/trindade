import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { User } from '@trindade/shared';
import { useTheme } from '../../lib/tema';
import type { ProvedorDoQuadro } from './provedor';
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
  aoMudarCena: (cena: { elementos: readonly unknown[]; arquivos: unknown }) => void;
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
  podeEditar,
  cheio,
  pessoas,
  aoMudarCena,
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

  // --- da tela para o mapa --------------------------------------------------
  //
  // Num ref, e não na dependência do callback: o teto muda a cada elemento, e
  // refazer o `onChange` do Excalidraw a cada traço custa mais que a leitura.
  const cheioRef = useRef(cheio);
  cheioRef.current = cheio;

  const aoMudar = useCallback(
    (elementos: readonly unknown[], _estado: unknown, arquivos: unknown) => {
      aoMudarCena({ elementos, arquivos });

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
    [provedor, aoMudarCena],
  );

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
        /* A ferramenta de imagem sai nesta fatia: uma imagem colada vira um
           arquivo local do Excalidraw, e ele não viaja pelo CRDT — apareceria
           quebrada para todo mundo menos para quem colou. Ela volta com o
           upload pelo `sharp`, junto de "enviar no canal". */
        tools: { image: false },
      }}
    />
  );
}
