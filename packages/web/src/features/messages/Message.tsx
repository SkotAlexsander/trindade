import { memo, useEffect, useMemo, useRef } from 'react';
import type { Channel, Role, User } from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import { Clock, Pin } from '../../components/icones';
import { AcoesDaMensagem } from './AcoesDaMensagem';
import { Conteudo } from './Conteudo';
import { haQuantoTempo, hora } from './linhas';
import { analisarMarkdown, mencionados } from './markdown';
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

export interface AcoesDisponiveis {
  podeFixar: boolean;
  podeApagarDosOutros: boolean;
  onReagir: (mensagem: MensagemLocal, emoji: string, tirar: boolean) => void;
  onResponder: (mensagem: MensagemLocal) => void;
  onGuardar: (mensagem: MensagemLocal) => void;
  onFixar: (mensagem: MensagemLocal) => void;
  onEditar: (mensagem: MensagemLocal) => void;
  onApagar: (mensagem: MensagemLocal) => void;
  onTentarDeNovo: (mensagem: MensagemLocal) => void;
  onDescartar: (mensagem: MensagemLocal) => void;
  onPular: (messageId: string) => void;
  onFocar: (messageId: string) => void;
  onThread: (mensagem: MensagemLocal) => void;
}

export interface MessageProps {
  mensagem: MensagemLocal;
  cabeca: boolean;
  autor: User | undefined;
  meuId: string;
  meuUsername: string;
  pessoas: readonly User[];
  canais: readonly Channel[];
  /** A mensagem citada, se esta for uma resposta e ela estiver carregada. */
  respondida: MensagemLocal | undefined;
  /** Único ponto de parada do Tab na lista — o foco itinerante. */
  focada: boolean;
  /**
   * Pedido explícito de foco, distinto de `focada`.
   *
   * Sem a distinção, entrar na lista não funciona: a última mensagem já é o
   * ponto de parada por padrão, então `focada` nunca muda de valor quando se
   * pede o foco para ela, e o efeito que chama `.focus()` nunca roda.
   */
  assumirFoco: boolean;
  /** Acesa por 800ms depois de um pulo vindo de uma citação ou da busca. */
  destacada: boolean;
  acoes: AcoesDisponiveis;
}

export const Message = memo(function Message({
  mensagem,
  cabeca,
  autor,
  meuId,
  meuUsername,
  pessoas,
  canais,
  respondida,
  focada,
  assumirFoco,
  destacada,
  acoes,
}: MessageProps) {
  const cargo = cargoDoTopo(autor?.roles);
  const cor = corDoCargo(autor?.roles);
  const apagada = mensagem.deletedAt !== null;
  const local = mensagem.local;
  const souOAutor = mensagem.author.id === meuId;
  const artigo = useRef<HTMLElement>(null);

  // A árvore é montada uma vez e serve para desenhar **e** para saber se você
  // foi citado. Procurar `@usuario` no texto cru acharia dentro de um bloco de
  // código, e a linha inteira mudaria de cor por engano.
  const blocos = useMemo(
    () => (mensagem.content ? analisarMarkdown(mensagem.content) : []),
    [mensagem.content],
  );
  const meCitou = useMemo(
    () => Boolean(meuUsername) && mencionados(blocos).has(meuUsername),
    [blocos, meuUsername],
  );

  useEffect(() => {
    if (!assumirFoco) return;
    // `nearest` e nunca `center`: centralizar faz a lista pular meia tela a
    // cada tecla de seta.
    artigo.current?.scrollIntoView({ block: 'nearest' });
    if (document.activeElement !== artigo.current) artigo.current?.focus({ preventScroll: true });
  }, [assumirFoco]);

  // Mensagem otimista ainda não existe no servidor: agir sobre ela produziria
  // um 404. A barra só aparece quando há o que acionar.
  const temAcoes = !apagada && !local;

  return (
    <article
      ref={artigo}
      className={styles.mensagem}
      data-cabeca={cabeca}
      data-local={local ?? undefined}
      data-mencionado={meCitou}
      data-destacada={destacada || undefined}
      data-id={mensagem.id}
      tabIndex={focada ? 0 : -1}
      onFocus={() => acoes.onFocar(mensagem.id)}
    >
      {mensagem.replyToId ? (
        <div className={styles.citacao}>
          {respondida ? (
            <button
              type="button"
              className={styles.citacaoTexto}
              onClick={() => acoes.onPular(respondida.id)}
            >
              <Avatar
                id={respondida.author.id}
                name={respondida.author.displayName}
                src={respondida.author.avatarUrl}
                size="xs"
              />
              <strong>{respondida.author.displayName}</strong>
              <span>{respondida.deletedAt ? 'mensagem apagada' : respondida.content}</span>
            </button>
          ) : (
            // A original pode estar fora do trecho carregado. Dizer isso é
            // melhor que uma citação vazia que parece defeito.
            <span className={styles.citacaoTexto}>
              <span>mensagem original acima do histórico carregado</span>
            </span>
          )}
        </div>
      ) : null}

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
        ) : mensagem.pinnedAt ? (
          // Fixar muda a linha para todo mundo, e continuação de bloco não tem
          // cabeçalho onde pendurar o selo. Ele vem para o gutter e fica
          // sempre visível: é informação, não decoração de hover.
          <Tooltip label="Fixada neste canal">
            <span className={styles.selo}>
              <Pin size={12} />
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
            <span className={styles.nome} style={cor ? { color: cor } : undefined}>
              {mensagem.author.displayName}
            </span>
            {cargo ? <span className={styles.cargo}>{cargo.name}</span> : null}
            <time className={styles.hora} dateTime={mensagem.createdAt}>
              {hora(mensagem.createdAt)}
            </time>

            {/* Fixada muda a linha para todo mundo, porque é do canal.
                Guardada **não** muda nada aqui — só o botão da barra acende —
                senão a mesma conversa pareceria diferente para cada pessoa. */}
            {mensagem.pinnedAt ? (
              <Tooltip label="Fixada neste canal">
                <span className={styles.selo}>
                  <Pin size={12} />
                </span>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {apagada ? (
          <p className={styles.apagada}>Mensagem apagada</p>
        ) : (
          <div className={styles.corpoBloco}>
            <Conteudo
              texto={mensagem.content ?? ''}
              pessoas={pessoas}
              canais={canais}
              meuUsername={meuUsername}
            />
            {mensagem.editedAt ? <span className={styles.editado}>(editado)</span> : null}
          </div>
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
                onClick={() => acoes.onReagir(mensagem, r.emoji, r.me)}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* O único ponto do projeto onde `·` separa meta, porque aqui são
            dois fatos da mesma coisa e não uma cadeia de rótulos. */}
        {mensagem.threadCount > 0 ? (
          <button
            type="button"
            className={styles.rodapeThread}
            onClick={() => acoes.onThread(mensagem)}
          >
            <span>
              {mensagem.threadCount === 1 ? '1 resposta' : `${mensagem.threadCount} respostas`}
            </span>
            {mensagem.threadLastReplyAt ? (
              <>
                {/* Cada pedaço num elemento próprio: num container flex, o nó
                    de texto solto vira item e os espaços dele colapsam — foi
                    assim que o separador sumiu e saiu "1 respostaúltima". */}
                <span aria-hidden="true">·</span>
                <span>última {haQuantoTempo(mensagem.threadLastReplyAt)}</span>
              </>
            ) : null}
          </button>
        ) : null}

        {/* O erro pertence ao lugar da mensagem, nunca a um toast num canto:
            é ali que está o texto que a pessoa escreveu. */}
        {local === 'falhou' ? (
          <p className={styles.falhou}>
            Não enviou.{' '}
            <button type="button" onClick={() => acoes.onTentarDeNovo(mensagem)}>
              Tentar de novo
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => acoes.onDescartar(mensagem)}>
              Descartar
            </button>
          </p>
        ) : null}
      </div>

      {temAcoes ? (
        <AcoesDaMensagem
          mensagem={mensagem}
          souOAutor={souOAutor}
          podeFixar={acoes.podeFixar}
          podeApagar={souOAutor || acoes.podeApagarDosOutros}
          onReagir={(emoji) => {
            const minha = mensagem.reactions.find((r) => r.emoji === emoji)?.me ?? false;
            acoes.onReagir(mensagem, emoji, minha);
          }}
          onResponder={() => acoes.onResponder(mensagem)}
          onGuardar={() => acoes.onGuardar(mensagem)}
          onFixar={() => acoes.onFixar(mensagem)}
          onEditar={() => acoes.onEditar(mensagem)}
          onApagar={() => acoes.onApagar(mensagem)}
          onThread={() => acoes.onThread(mensagem)}
        />
      ) : null}
    </article>
  );
});
