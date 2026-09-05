// Fonte da verdade dos tipos dos dois lados. Ver docs/05-contrato-api.md.
// Datas são sempre ISO 8601 em UTC; a formatação para o fuso local acontece só
// na renderização.

export type UserStatus = 'online' | 'idle' | 'busy' | 'invisible' | 'offline';

export interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  /** bigint serializado — não sobrevive ao JSON como número */
  permissions: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** A mancha de cor no lugar do avatar enquanto ele carrega. */
  avatarBlurhash: string | null;
  bio: string | null;
  accentColor: string | null;
  status: UserStatus;
  customStatus: string | null;
  roles: Role[];
  disabled: boolean;
  /**
   * Quando a pessoa entrou. O cartão de perfil escreve "Está aqui desde
   * março" — ver design/05-perfil-e-cargos.md. Não estava no contrato
   * original, e sem ele a linha não teria de onde sair.
   */
  createdAt: string;
}

export type MessageAuthor = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  url: string;
}

/**
 * O cartão de um link, montado pelo servidor.
 *
 * `thumbUrl` aponta para **nós**, nunca para o site de origem: quem lê não
 * pode acabar baixando uma imagem de terceiro só por abrir a conversa. Ver
 * design/04-mensagens.md, "Link".
 */
export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string;
  thumbUrl: string | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  /**
   * Quando o link é um vídeo que dá para assistir aqui dentro.
   *
   * O servidor devolve **só o identificador**, nunca uma URL de embed pronta:
   * quem monta o endereço do iframe é o cliente, com o domínio e os parâmetros
   * que ele escolhe. Uma URL vinda de fora entrando direto num `src` de iframe
   * é o tipo de confiança que não se dá a metadado de terceiro.
   *
   * Ver design/04-mensagens.md, "Vídeo".
   */
  video: { provider: 'youtube'; id: string; startAt: number | null } | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface Message {
  id: string;
  /**
   * O alvo: exatamente um dos dois vem preenchido.
   *
   * Conversa privada usa a mesma tabela e o mesmo tipo de mensagem — é isso
   * que reaproveita busca, reações, anexos, threads e o gateway sem duplicar
   * nada. Ver design/10-conversas-privadas.md.
   */
  channelId: string | null;
  conversationId: string | null;
  author: MessageAuthor;
  content: string | null;
  /**
   * `system` é o que o produto escreveu por alguém — "Bruno concluiu tal
   * tarefa". Fica **no fluxo**, e não numa tabela paralela: é assim que o grupo
   * fica sabendo sem abrir o quadro, e é assim que a linha aparece na busca e
   * no histórico como qualquer outra coisa que aconteceu ali.
   */
  kind: 'text' | 'system' | 'poll';
  parentId: string | null;
  replyToId: string | null;
  /**
   * Quantas respostas esta mensagem tem numa thread, e quando veio a última.
   * Zero na esmagadora maioria — é o que o rodapé "3 respostas · há 2 h"
   * desenha, e por isso vem junto do histórico em vez de exigir uma consulta
   * por mensagem.
   */
  threadCount: number;
  threadLastReplyAt: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  pinnedAt: string | null;
  /**
   * Se **você** guardou esta mensagem. Como o `me` das reações, sai sempre do
   * ponto de vista de quem pediu — e, ao contrário do `count` das reações,
   * nunca existe um número: quem mais guardou não é da conta de ninguém.
   */
  saved: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  clientNonce?: string;
}

export type ChannelKind = 'text' | 'voice';

export interface Channel {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: ChannelKind;
  position: number;
  category: string | null;
  archivedAt: string | null;
  createdAt: string;
}

/** Forma única de erro da API. Ver docs/05-contrato-api.md. */
export interface ApiError {
  error: string;
  code: string;
  field?: string;
}

export interface HealthResponse {
  ok: boolean;
  db: boolean;
}

/**
 * Uma tarefa do quadro do canal.
 *
 * Título, dono e prazo. Sem etiqueta, sem prioridade, sem estimativa: cada
 * campo a mais é uma decisão que alguém precisa tomar ao criar, e a fricção
 * mata o uso. Ver design/08-projeto.md.
 */
export interface Task {
  id: string;
  channelId: string;
  title: string;
  body: string | null;
  /** Três colunas fixas. Configuráveis é o que todos pedem e ninguém usa. */
  columnKey: ColunaDoQuadro;
  /**
   * Ponto flutuante, e não índice: soltar entre duas tarefas grava a média das
   * vizinhas — uma linha atualizada, sem reindexar a coluna inteira.
   */
  position: number;
  assigneeId: string | null;
  dueAt: string | null;
  /** A mensagem que virou esta tarefa, quando houve uma. */
  sourceMessageId: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Uma conversa privada: direta entre duas pessoas, ou grupo de três a quatro.
 *
 * `members` traz só quem não saiu. Quem saiu de um grupo continua no histórico
 * dos outros, e é por isso que a lista de membros não serve para ler mensagem
 * antiga — serve para desenhar quem está lá agora.
 */
export interface Conversation {
  id: string;
  kind: 'direct' | 'group';
  /** Só grupo tem nome, e mesmo grupo pode não ter. */
  name: string | null;
  members: string[];
  createdBy: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  /** Prévia da última mensagem, para a lista. */
  lastMessage: string | null;
  lastAuthorId: string | null;
  unreadCount: number;
  mentionCount: number;
  mutedUntil: string | null;
  /** Escondida da sua lista; volta na próxima mensagem. */
  hidden: boolean;
}

/**
 * Uma enquete, que **é** uma mensagem — `Message.kind === 'poll'`.
 *
 * `voters` só vem preenchido em enquete aberta. Na anônima o servidor não
 * manda os nomes para ninguém, nem para quem criou: o segredo prometido na
 * criação não é um detalhe da interface. Ver design/08-projeto.md.
 */
export interface Poll {
  id: string;
  messageId: string;
  channelId: string;
  question: string;
  /** Voto único ou múltiplo, escolhido ao criar e imutável depois. */
  multiple: boolean;
  anonymous: boolean;
  closesAt: string | null;
  closedAt: string | null;
  createdBy: string;
  options: PollOption[];
  /** As opções em que **você** votou. Do seu voto você sempre sabe. */
  myVotes: string[];
  /** Quantas pessoas votaram — não quantos votos, que no múltiplo diferem. */
  voterCount: number;
}

export interface PollOption {
  id: string;
  label: string;
  count: number;
  /** Vazio em enquete anônima. */
  voters: string[];
}

/** Duas a seis. Sete alternativas é problema de escopo, não de enquete. */
export const OPCOES_MIN = 2;
export const OPCOES_MAX = 6;

export const COLUNAS = ['todo', 'doing', 'done'] as const;
export type ColunaDoQuadro = (typeof COLUNAS)[number];

export const NOME_DA_COLUNA: Record<ColunaDoQuadro, string> = {
  todo: 'A fazer',
  doing: 'Fazendo',
  done: 'Feito',
};

/**
 * Um quadro branco do canal.
 *
 * Vários por canal, ao contrário da nota: "Fluxo de onboarding" e "Arquitetura
 * v2" são dois desenhos, e misturá-los num só não ajuda ninguém. O conteúdo
 * não vem por aqui — ele é o CRDT que chega pelo WebSocket. Isto é o cartão da
 * lista. Ver design/11-quadro.md.
 */
export interface Board {
  id: string;
  channelId: string;
  name: string;
  /** Gerada no cliente ao fechar e re-encodada pelo `sharp`, como toda imagem. */
  thumbnailUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Quem mexeu por último — é o que a linha "Ana · há 2 h" quer dizer. */
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * O teto de elementos por quadro, e o aviso antes dele.
 *
 * Acima de dois mil o Yjs e o navegador começam a sofrer, e um quadro desse
 * tamanho deveria ser dois. O aviso sai em 90% porque um limite que só aparece
 * quando já bateu é uma parede, não um aviso.
 */
export const ELEMENTOS_POR_QUADRO = 2000;
export const AVISO_DE_ELEMENTOS = Math.floor(ELEMENTOS_POR_QUADRO * 0.9);

/**
 * Alguém apresentando um quadro agora.
 *
 * Vive só em memória no servidor, como o estado de voz: é presença, não
 * registro. Reiniciar a API encerra as apresentações, e isso é o certo — quem
 * está conduzindo perdeu a conexão junto.
 */
export interface Presentation {
  boardId: string;
  channelId: string;
  /** O nome do quadro, para a linha na lista de canais não pedir a lista toda. */
  boardName: string;
  userId: string;
  startedAt: string;
}

/**
 * A menção que chama todo mundo.
 *
 * `@todos` não é um usuário: é a forma de dizer "isto é para o grupo, não é
 * ruído do canal". Com cinco pessoas não existe `@here` separado — quem está
 * fora recebe o mesmo chamado quando voltar, e duas variantes seriam uma
 * escolha a mais para fazer no meio de uma frase.
 *
 * O nome é reservado: nenhuma conta pode se chamar assim, senão a menção a ela
 * chamaria o grupo inteiro.
 */
export const MENCAO_DE_TODOS = 'todos';
