import { Perm, type PermName } from '@trindade/shared';

/**
 * As permissões em linguagem de quem usa.
 *
 * "Apagar mensagens de outros", não `DELETE_ANY_MESSAGE`. Quem administra este
 * lugar não é programador, e o nome da constante não explica a consequência —
 * é o texto daqui que a pessoa lê antes de dar um poder a alguém.
 *
 * Ver design/05-perfil-e-cargos.md, "Cargos".
 */

export interface DescricaoDePermissao {
  nome: PermName;
  rotulo: string;
  /** Uma linha, só quando o rótulo sozinho deixa dúvida. */
  detalhe?: string;
}

export interface GrupoDePermissoes {
  titulo: string;
  itens: DescricaoDePermissao[];
}

export const GRUPOS: GrupoDePermissoes[] = [
  {
    titulo: 'Conversa',
    itens: [
      { nome: 'SEND_MESSAGE', rotulo: 'Enviar mensagens' },
      { nome: 'ATTACH_FILE', rotulo: 'Anexar arquivos' },
      { nome: 'DELETE_OWN_MESSAGE', rotulo: 'Apagar as próprias mensagens' },
      {
        nome: 'DELETE_ANY_MESSAGE',
        rotulo: 'Apagar mensagens de outros',
        detalhe: 'Some para todo mundo, sem aviso a quem escreveu.',
      },
      {
        nome: 'PIN_MESSAGE',
        rotulo: 'Fixar mensagens',
        detalhe: 'Fixar muda a conversa para todas as pessoas do canal.',
      },
    ],
  },
  {
    titulo: 'Chamada',
    itens: [
      { nome: 'CONNECT_VOICE', rotulo: 'Entrar em chamadas' },
      { nome: 'SHARE_SCREEN', rotulo: 'Compartilhar tela' },
      { nome: 'MUTE_OTHERS', rotulo: 'Silenciar outras pessoas' },
    ],
  },
  {
    titulo: 'Projeto',
    itens: [
      { nome: 'MANAGE_NOTES', rotulo: 'Editar as notas do canal' },
      { nome: 'MANAGE_TASKS', rotulo: 'Criar e mover tarefas' },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      { nome: 'CREATE_INVITE', rotulo: 'Convidar pessoas' },
      { nome: 'MANAGE_CHANNEL', rotulo: 'Criar e arquivar canais' },
      {
        nome: 'MANAGE_ROLES',
        rotulo: 'Gerenciar cargos',
        detalhe: 'Só cargos abaixo do seu, e só permissões que você já tem.',
      },
      {
        nome: 'MANAGE_MEMBERS',
        rotulo: 'Gerenciar pessoas',
        detalhe: 'Trocar cargos e desativar contas abaixo da sua.',
      },
    ],
  },
];

/**
 * O aviso do `ADMINISTRATOR`, literal.
 *
 * Ele fica fora dos grupos porque não é mais uma permissão da lista: é a que
 * dispensa a lista inteira.
 */
export const AVISO_DE_ADMINISTRADOR =
  'Ignora todas as permissões acima e concede acesso total. ' +
  'Dê apenas a quem você confia com o servidor inteiro.';

export function bitDe(nome: PermName): bigint {
  return Perm[nome];
}

export function temBit(permissoes: bigint, nome: PermName): boolean {
  return (permissoes & Perm[nome]) !== 0n;
}

export function alternarBit(permissoes: bigint, nome: PermName, ligar: boolean): bigint {
  return ligar ? permissoes | Perm[nome] : permissoes & ~Perm[nome];
}

/** Toda permissão listada nos grupos, para conferir que nenhuma ficou de fora. */
export function nomesListados(): PermName[] {
  return GRUPOS.flatMap((g) => g.itens.map((i) => i.nome));
}
