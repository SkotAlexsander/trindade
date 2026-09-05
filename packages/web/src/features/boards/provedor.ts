import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { deBase64, paraBase64 } from '../../lib/base64';
import * as ws from '../../lib/ws';

/**
 * A sincronização de um quadro.
 *
 * Irmão do provedor das notas, e pelo mesmo motivo: o transporte é o **mesmo**
 * WebSocket de tudo o mais. O que muda é o alvo — aqui é o quadro, não o canal,
 * porque um canal tem vários quadros e dois abertos ao mesmo tempo não podem
 * receber o traço um do outro.
 *
 * Os elementos vivem num `Y.Map` indexado pelo id do elemento. A conversão
 * entre esse mapa e a cena do Excalidraw está em `sincronia.ts`, separada
 * porque é a parte que se pode testar sem navegador nenhum.
 */

/** O nome do mapa tem de casar com o do servidor. */
export const MAPA = 'elementos';

export interface ProvedorDoQuadro {
  /** Identidade da instância: a tela é refeita quando ela troca. */
  id: number;
  doc: Y.Doc;
  elementos: Y.Map<unknown>;
  awareness: Awareness;
  /** O que sai daqui é marcado como local — o que chega da rede, não. */
  origemRemota: symbol;
  destruir: () => void;
}

let contador = 0;

export interface AberturaDoQuadro {
  boardId: string;
  eu: { id: string; nome: string; cor: string };
  aoReceberEstado: (info: { podeEditar: boolean; elementos: number }) => void;
  aoContar: (elementos: number) => void;
  aoMudarPresenca: (userIds: string[]) => void;
}

export function abrirQuadro(entrada: AberturaDoQuadro): ProvedorDoQuadro {
  const doc = new Y.Doc();
  const elementos = doc.getMap<unknown>(MAPA);
  const awareness = new Awareness(doc);
  const origemRemota = Symbol('remoto');

  awareness.setLocalStateField('user', {
    name: entrada.eu.nome,
    color: entrada.eu.cor,
    id: entrada.eu.id,
  });

  /* Sem marcar a origem, aplicar um delta remoto dispara o observador local,
     que reenviaria o mesmo delta de volta — dois navegadores em eco. */
  const aoAtualizar = (update: Uint8Array, quemOriginou: unknown) => {
    if (quemOriginou === origemRemota) return;
    ws.enviar({
      op: 'BOARD_UPDATE',
      d: { boardId: entrada.boardId, update: paraBase64(update) },
    });
  };
  doc.on('update', aoAtualizar);

  const aoMudarAwareness = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const mudou = [...added, ...updated, ...removed];
    if (!mudou.includes(awareness.clientID)) return;
    ws.enviar({
      op: 'BOARD_AWARENESS',
      d: {
        boardId: entrada.boardId,
        estado: paraBase64(encodeAwarenessUpdate(awareness, [awareness.clientID])),
      },
    });
  };
  awareness.on('update', aoMudarAwareness);

  const inscricoes = [
    ws.on('BOARD_STATE', (d) => {
      if (d.boardId !== entrada.boardId) return;
      Y.applyUpdate(doc, deBase64(d.update), origemRemota);
      entrada.aoReceberEstado({ podeEditar: d.podeEditar, elementos: d.elementos });
    }),
    ws.on('BOARD_UPDATE', (d) => {
      if (d.boardId !== entrada.boardId) return;
      Y.applyUpdate(doc, deBase64(d.update), origemRemota);
    }),
    ws.on('BOARD_COUNT', (d) => {
      if (d.boardId !== entrada.boardId) return;
      entrada.aoContar(d.elementos);
    }),
    ws.on('BOARD_AWARENESS', (d) => {
      if (d.boardId !== entrada.boardId) return;
      applyAwarenessUpdate(awareness, deBase64(d.estado), origemRemota);
    }),
    ws.on('BOARD_PRESENCE', (d) => {
      if (d.boardId !== entrada.boardId) return;
      entrada.aoMudarPresenca(d.userIds);
    }),
    // Depois de reconectar, o quadro continua aberto na tela mas o servidor não
    // sabe mais disso: pedir o estado de novo traz o que os outros desenharam
    // enquanto a conexão esteve fora.
    ws.onAbertura(() => {
      ws.enviar({ op: 'BOARD_OPEN', d: { boardId: entrada.boardId } });
    }),
  ];

  ws.enviar({ op: 'BOARD_OPEN', d: { boardId: entrada.boardId } });

  return {
    id: ++contador,
    doc,
    elementos,
    awareness,
    origemRemota,
    destruir: () => {
      ws.enviar({ op: 'BOARD_CLOSE', d: { boardId: entrada.boardId } });
      for (const cancelar of inscricoes) cancelar();
      doc.off('update', aoAtualizar);
      awareness.off('update', aoMudarAwareness);
      awareness.destroy();
      doc.destroy();
    },
  };
}
