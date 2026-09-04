import { memo } from 'react';
import type { Role, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import { Clock } from '../../components/icones';
import { hora } from './linhas';
import type { MensagemLocal } from './queries';
import styles from './messages.module.css';

/**
 * Uma linha da conversa.
 *
 * `cabeca` decide tudo o que se vê: a primeira do bloco carrega avatar, nome,
 * cargo e horário; as seguintes carregam só o corpo, com o horário aparecendo
 * no gutter no hover. Repetir o cabeçalho a cada linha é o maior desperdício
 * vertical do design de chat. Ver design/04-mensagens.md.
 */

export interface MessageProps {
  mensagem: MensagemLocal;
  cabeca: boolean;
  autor: User | undefined;
  /** Nome de usuário de quem está lendo — para destacar a menção a você. */
  meuUsername: string;
  onReagir: (messageId: string, emoji: string, tirar: boolean) => void;
  onTentarDeNovo: (mensagem: MensagemLocal) => void;
  onDescartar: (mensagem: MensagemLocal) => void;
}

function maisAlto(roles: readonly Role[]): Role | undefined {
  return roles.reduce<Role | undefined>(
    (maior, r) => (!maior || r.position > maior.position ? r : maior),
    undefined,
  );
}

/**
 * O cargo que **aparece** ao lado do nome: o de maior posição, tenha cor ou
 * não. Um só, nunca a lista inteira.
 */
export function cargoDoTopo(roles: readonly Role[] | undefined): Role | undefined {
  if (!roles || roles.length === 0) return undefined;
  return maisAlto(roles);
}

/**
 * O cargo que **colore** o nome: o de maior posição *entre os que têm cor*.
 *
 * São duas escolhas diferentes de propósito. Se o cargo mais alto não tiver
 * cor, o nome não fica sem cor — ele herda a do cargo colorido abaixo dele,
 * que é o que a pessoa espera ver.
 */
export function corDoCargo(roles: readonly Role[] | undefined): string | undefined {
  if (!roles) return undefined;
  return maisAlto(roles.filter((r) => r.color))?.color ?? undefined;
}

/**
 * Menção a quem está lendo.
 *
 * Comparação de texto por enquanto: o analisador de menções chega junto com o
 * markdown, na próxima fatia, e é ele que vai substituir isto.
 */
function ehMencaoAMim(conteudo: string | null, meuUsername: string): boolean {
  if (!conteudo || !meuUsername) return false;
  return conteudo.includes(`@${meuUsername}`);
}

export const Message = memo(function Message({
  mensagem,
  cabeca,
  autor,
  meuUsername,
  onReagir,
  onTentarDeNovo,
  onDescartar,
}: MessageProps) {
  const cargo = cargoDoTopo(autor?.roles);
  const cor = corDoCargo(autor?.roles);
  const apagada = mensagem.deletedAt !== null;
  const local = mensagem.local;

  return (
    <article
      className={styles.mensagem}
      data-cabeca={cabeca}
      data-local={local ?? undefined}
      data-mencionado={ehMencaoAMim(mensagem.content, meuUsername)}
    >
      <div className={styles.gutter}>
        {cabeca ? (
          <Avatar
            id={mensagem.author.id}
            name={mensagem.author.displayName}
            src={mensagem.author.avatarUrl}
            size="md"
          />
        ) : local === 'na-fila' ? (
          <Tooltip label="Na fila — sai quando a conexão voltar">
            <span className={styles.horaGutter}>
              <Clock size={12} />
            </span>
          </Tooltip>
        ) : (
          <time className={styles.horaGutter} dateTime={mensagem.createdAt}>
            {hora(mensagem.createdAt)}
          </time>
        )}
      </div>

      <div className={styles.conteudo}>
        {cabeca ? (
          <div className={styles.cabecalho}>
            <span
              className={styles.nome}
              style={cor ? { color: cor } : undefined}
            >
              {mensagem.author.displayName}
            </span>
            {cargo ? <span className={styles.cargo}>{cargo.name}</span> : null}
            <time className={styles.hora} dateTime={mensagem.createdAt}>
              {hora(mensagem.createdAt)}
            </time>
          </div>
        ) : null}

        {apagada ? (
          <p className={styles.apagada}>Mensagem apagada</p>
        ) : (
          <p className={styles.corpo}>
            {mensagem.content}
            {mensagem.editedAt ? <span className={styles.editado}>(editado)</span> : null}
          </p>
        )}

        {mensagem.reactions.length > 0 ? (
          <div className={styles.reacoes}>
            {mensagem.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={styles.reacao}
                data-minha={r.me}
                aria-pressed={r.me}
                aria-label={`${r.emoji}, ${r.count}`}
                onClick={() => onReagir(mensagem.id, r.emoji, r.me)}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* O erro pertence ao lugar da mensagem, nunca a um toast num canto:
            é ali que está o texto que a pessoa escreveu. */}
        {local === 'falhou' ? (
          <p className={styles.falhou}>
            Não enviou.{' '}
            <button type="button" onClick={() => onTentarDeNovo(mensagem)}>
              Tentar de novo
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => onDescartar(mensagem)}>
              Descartar
            </button>
          </p>
        ) : null}
      </div>
    </article>
  );
});
