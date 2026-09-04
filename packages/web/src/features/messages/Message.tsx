import { memo, useEffect, useMemo, useRef } from 'react';
import {
  NOME_DA_COLUNA,
  type Channel,
  type Poll,
  type Role,
  type Task,
  type User,
} from '@trindade/shared';
import { Avatar, Tooltip } from '../../components';
import { Clock, Pin, Tasks } from '../../components/icones';
import { AcoesDaMensagem } from './AcoesDaMensagem';
import { Conteudo } from './Conteudo';
import { Anexos } from './Anexos';
import { CartaoDePerfil } from '../profile/CartaoDePerfil';
import { PreviaDeLink } from './PreviaDeLink';
import { useQuadro } from '../tasks/store';
import { Enquete } from '../polls/Enquete';
import { haQuantoTempo, hora } from './linhas';
import { analisarMarkdown, mencionados, primeiroLink } from './markdown';
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
  podeAnotar: boolean;
  podeTarefa: boolean;
  podeApagarDosOutros: boolean;
  onReagir: (mensagem: MensagemLocal, emoji: string, tirar: boolean) => void;
  onResponder: (mensagem: MensagemLocal) => void;
  onGuardar: (mensagem: MensagemLocal) => void;
  onFixar: (mensagem: MensagemLocal) => void;
  onParaNotas: (mensagem: MensagemLocal) => void;
  onCriarTarefa: (mensagem: MensagemLocal) => void;
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
  /** A tarefa que nasceu desta mensagem, se existir. */
  tarefa: Task | undefined;
  /** A enquete, quando esta mensagem é uma (`kind === 'poll'`). */
  enquete: Poll | undefined;
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
  tarefa,
  enquete,
  acoes,
}: MessageProps) {
  const abrirQuadro = useQuadro((s) => s.abrir);
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
  // Um cartão por mensagem, e só o primeiro link. Ver `primeiroLink`.
  const link = useMemo(() => primeiroLink(blocos), [blocos]);
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

  // A linha de sistema sai antes de tudo: sem avatar, sem cargo, sem barra de
  // ações e sem entrar no bloco de ninguém. É o canal falando, e o que ela
  // precisa é ocupar pouco espaço e não ser confundida com uma fala.
  if (mensagem.kind === 'system') {
    return (
      <article
        ref={artigo}
        className={styles.sistema}
        data-id={mensagem.id}
        data-destacada={destacada || undefined}
        tabIndex={focada ? 0 : -1}
        onFocus={() => acoes.onFocar(mensagem.id)}
      >
        <Tasks size={12} />
        <Conteudo
          texto={mensagem.content ?? ''}
          pessoas={pessoas}
          canais={canais}
          meuUsername={meuUsername}
        />
        <time dateTime={mensagem.createdAt}>{hora(mensagem.createdAt)}</time>
      </article>
    );
  }

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
          // O cartão precisa do `User` inteiro — cargos, bio, entrada. O
          // `author` da mensagem é só o suficiente para desenhar a linha, e
          // por isso o cartão só existe quando a pessoa está no cache.
          <PerfilSeConhecido user={autor}>
            <Avatar
              id={mensagem.author.id}
              name={mensagem.author.displayName}
              src={mensagem.author.avatarUrl}
              size="md"
            />
          </PerfilSeConhecido>
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
            <PerfilSeConhecido user={autor}>
              <button
                type="button"
                className={styles.nome}
                style={cor ? { color: cor } : undefined}
              >
                {mensagem.author.displayName}
              </button>
            </PerfilSeConhecido>
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
            {/* A pergunta fica no corpo da mensagem, como qualquer outra
                frase — é o que a faz aparecer na busca, na citação e no
                painel de fixadas. A caixa abaixo tem as opções, e nada mais:
                repetir a pergunta dentro dela seria dizer a mesma coisa duas
                vezes na mesma linha da conversa. */}
            {enquete ? <Enquete poll={enquete} pessoas={pessoas} /> : null}
            {mensagem.editedAt ? <span className={styles.editado}>(editado)</span> : null}
            {mensagem.attachments.length > 0 ? (
              <Anexos anexos={mensagem.attachments} />
            ) : null}
            {/* O cartão só entra quando não há anexo: com os dois juntos a
                mensagem vira um bloco de meia tela, e o anexo é o que a pessoa
                escolheu mandar. */}
            {link && mensagem.attachments.length === 0 ? <PreviaDeLink url={link} /> : null}
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

        {/* O elo de ida: daqui em diante a mensagem carrega o que virou. Fica
            preso à tarefa de verdade — arrastar o cartão para outra coluna
            muda esta linha na conversa de todo mundo. */}
        {tarefa ? (
          <button
            type="button"
            className={styles.rodapeTarefa}
            onClick={() => abrirQuadro()}
            aria-label={`Virou tarefa em ${NOME_DA_COLUNA[tarefa.columnKey]} — abrir o quadro`}
          >
            <Tasks size={12} />
            <span>Virou tarefa</span>
            <span aria-hidden="true">·</span>
            <span>{NOME_DA_COLUNA[tarefa.columnKey]}</span>
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
          podeAnotar={acoes.podeAnotar}
          podeTarefa={acoes.podeTarefa}
          podeApagar={souOAutor || acoes.podeApagarDosOutros}
          onReagir={(emoji) => {
            const minha = mensagem.reactions.find((r) => r.emoji === emoji)?.me ?? false;
            acoes.onReagir(mensagem, emoji, minha);
          }}
          onResponder={() => acoes.onResponder(mensagem)}
          onGuardar={() => acoes.onGuardar(mensagem)}
          onFixar={() => acoes.onFixar(mensagem)}
          onParaNotas={() => acoes.onParaNotas(mensagem)}
          onCriarTarefa={() => acoes.onCriarTarefa(mensagem)}
          onEditar={() => acoes.onEditar(mensagem)}
          onApagar={() => acoes.onApagar(mensagem)}
          onThread={() => acoes.onThread(mensagem)}
        />
      ) : null}
    </article>
  );
});

/**
 * Abre o cartão de perfil, quando dá.
 *
 * A mensagem carrega só o `author` — id, nome, avatar — que é o bastante para
 * desenhar a linha. O cartão quer cargos, bio e data de entrada, e isso vem do
 * cache de pessoas. Se a pessoa não estiver lá (histórico antigo de alguém que
 * saiu), o gatilho aparece igual e simplesmente não abre nada.
 */
function PerfilSeConhecido({
  user,
  children,
}: {
  user: User | undefined;
  children: React.ReactElement;
}) {
  if (!user) return children;
  return <CartaoDePerfil user={user} trigger={children} />;
}
