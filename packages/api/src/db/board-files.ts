import { sql } from './index.js';

/**
 * As imagens de dentro de um quadro.
 *
 * O Excalidraw guarda na cena um `fileId` e os bytes num dicionário à parte.
 * Os bytes não passam pelo CRDT — seriam megabytes de base64 dentro de cada
 * delta —, então eles vão pelo caminho de todo upload e esta tabela diz qual
 * `fileId` é qual arquivo nosso. Ver design/11-quadro.md.
 */

export interface BoardFileRow {
  board_id: string;
  file_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  created_by: string | null;
  created_at: Date;
}

const CAMPOS = sql`
  board_id, file_id, storage_key, content_type, byte_size, created_by, created_at
`;

/**
 * Guarda, ou devolve o que já estava lá.
 *
 * O `fileId` do Excalidraw é o hash do conteúdo: duas pessoas colando a mesma
 * imagem chegam ao mesmo id. `do nothing` faz a segunda reaproveitar o arquivo
 * da primeira em vez de gravar um gêmeo no storage.
 */
export async function guardar(entrada: {
  boardId: string;
  fileId: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  createdBy: string;
}): Promise<{ linha: BoardFileRow; novo: boolean }> {
  const inseridas = await sql<BoardFileRow[]>`
    insert into board_files (board_id, file_id, storage_key, content_type, byte_size, created_by)
    values (${entrada.boardId}, ${entrada.fileId}, ${entrada.storageKey},
            ${entrada.contentType}, ${entrada.byteSize}, ${entrada.createdBy})
    on conflict (board_id, file_id) do nothing
    returning ${CAMPOS}
  `;

  const nova = inseridas[0];
  if (nova) return { linha: nova, novo: true };

  const existentes = await sql<BoardFileRow[]>`
    select ${CAMPOS} from board_files
     where board_id = ${entrada.boardId} and file_id = ${entrada.fileId}
  `;
  const linha = existentes[0];
  if (!linha) throw new Error('a imagem do quadro não nasceu nem existia');
  return { linha, novo: false };
}

/** Quem serve o arquivo pergunta por aqui. */
export async function porChave(chave: string): Promise<BoardFileRow | null> {
  const linhas = await sql<BoardFileRow[]>`
    select ${CAMPOS} from board_files where storage_key = ${chave}
  `;
  return linhas[0] ?? null;
}
