import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as ws from '../../lib/ws';
import { deBase64, paraBase64 } from '../../lib/base64';

/**
 * O provedor de sincronização das notas.
 *
 * Não é o `y-websocket`: o transporte é o **mesmo** WebSocket de tudo o mais.
 * Uma segunda conexão só para notas seria outro caminho para autenticar,
 * reconectar, medir e depurar — e reconexão é a parte cara, já resolvida uma
 * vez em `lib/ws.ts`. Ver design/08-projeto.md.
 *
 * O que trafega são deltas binários do Yjs em base64. O servidor não arbitra
 * nada: aplica, guarda e repassa.
 */

export interface Provedor {
  /** Identidade da instância: o editor é refeito quando ela troca. */
  id: number;
  doc: Y.Doc;
  awareness: Awareness;
  destruir: () => void;
}

let contador = 0;

/** O nome do fragmento tem de casar com o do servidor. */
export const FRAGMENTO = 'nota';

export interface AberturaDaNota {
  channelId: string;
  eu: { id: string; nome: string; cor: string };
  aoReceberEstado: (podeEditar: boolean) => void;
  aoMudarPresenca: (userIds: string[]) => void;
}

export function abrirNota(entrada: AberturaDaNota): Provedor {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);

  awareness.setLocalStateField('user', {
    name: entrada.eu.nome,
    color: entrada.eu.cor,
    id: entrada.eu.id,
  });

  /* `origem` marca o que veio da rede. Sem essa marca, aplicar um delta remoto
     dispara o observador local, que reenviaria o mesmo delta de volta — dois
     navegadores conversando em eco até um deles travar. */
  const origem = 'remoto';

  const aoAtualizar = (update: Uint8Array, quemOriginou: unknown) => {
    if (quemOriginou === origem) return;
    ws.enviar({
      op: 'NOTE_UPDATE',
      d: { channelId: entrada.channelId, update: paraBase64(update) },
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
      op: 'NOTE_AWARENESS',
      d: {
        channelId: entrada.channelId,
        estado: paraBase64(encodeAwarenessUpdate(awareness, [awareness.clientID])),
      },
    });
  };
  awareness.on('update', aoMudarAwareness);

  const inscricoes = [
    ws.on('NOTE_STATE', (d) => {
      if (d.channelId !== entrada.channelId) return;
      Y.applyUpdate(doc, deBase64(d.update), origem);
      entrada.aoReceberEstado(d.podeEditar);
    }),
    ws.on('NOTE_UPDATE', (d) => {
      if (d.channelId !== entrada.channelId) return;
      Y.applyUpdate(doc, deBase64(d.update), origem);
    }),
    ws.on('NOTE_AWARENESS', (d) => {
      if (d.channelId !== entrada.channelId) return;
      applyAwarenessUpdate(awareness, deBase64(d.estado), origem);
    }),
    ws.on('NOTE_PRESENCE', (d) => {
      if (d.channelId !== entrada.channelId) return;
      entrada.aoMudarPresenca(d.userIds);
    }),
    // Depois de uma reconexão, o painel continua aberto mas o servidor não sabe
    // mais disso: pedir o estado de novo é o que traz de volta o que os outros
    // escreveram enquanto a conexão estava fora.
    ws.onAbertura(() => {
      ws.enviar({ op: 'NOTE_OPEN', d: { channelId: entrada.channelId } });
    }),
  ];

  ws.enviar({ op: 'NOTE_OPEN', d: { channelId: entrada.channelId } });

  return {
    id: ++contador,
    doc,
    awareness,
    destruir: () => {
      ws.enviar({ op: 'NOTE_CLOSE', d: { channelId: entrada.channelId } });
      for (const cancelar of inscricoes) cancelar();
      doc.off('update', aoAtualizar);
      awareness.off('update', aoMudarAwareness);
      awareness.destroy();
      doc.destroy();
    },
  };
}
