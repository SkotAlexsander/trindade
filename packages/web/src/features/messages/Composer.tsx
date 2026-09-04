import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TYPING_THROTTLE_MS, type Channel, type Message, type User } from '@trindade/shared';
import { IconButton, Tooltip, useToast } from '../../components';
import { Paperclip, Reply, Send, X } from '../../components/icones';
import { api } from '../../lib/http';
import { enviar as enviarPeloSocket } from '../../lib/ws';
import { useAuth } from '../auth/store';
import { atualizarMensagem, chaveDoCanal, type CacheCanal } from './queries';
import { SeletorDeEmoji } from './SeletorDeEmoji';
import { gatilhoAtivo, sugerir, type Sugestao } from './autocompletar';
import { algumSubindo, prontos, useAnexos } from './useAnexos';
import { FaixaDeAnexos } from './FaixaDeAnexos';
import { useComposer, useFoco } from './store';
import { useEnviarMensagem } from './useEnviar';
import styles from './messages.module.css';

/**
 * O compositor.
 *
 * `textarea` que cresce de 40px a 240px ajustando `style.height` a partir do
 * `scrollHeight`. **Não é `contenteditable`** — este último traz uma classe
 * inteira de bugs de colagem e de desfazer que não compensam.
 * Ver design/04-mensagens.md.
 */

const ALTURA_MIN = 40;
const ALTURA_MAX = 240;

/** Referência estável: `?? []` num seletor de store remonta a cada render. */
const VAZIO: never[] = [];

export interface ComposerProps {
  canal: Channel;
  pessoas: readonly User[];
  canais: readonly Channel[];
}

export function Composer({ canal, pessoas, canais }: ComposerProps) {
  const qc = useQueryClient();
  const { show } = useToast();
  const meuId = useAuth((s) => s.user?.id);
  const { enviar } = useEnviarMensagem();

  const focar = useFoco((s) => s.focar);
  const respondendoA = useComposer((s) => s.respondendoA);
  const editando = useComposer((s) => s.editando);
  const editar = useComposer((s) => s.editar);
  const limparContexto = useComposer((s) => s.limpar);

  const campo = useRef<HTMLTextAreaElement>(null);
  const seletorDeArquivo = useRef<HTMLInputElement>(null);
  const ultimoTyping = useRef(0);

  const pendentes = useAnexos((s) => s.porCanal[canal.id]) ?? VAZIO;
  const anexarArquivos = useAnexos((s) => s.anexar);
  const limparAnexos = useAnexos((s) => s.limpar);
  const [texto, setTexto] = useState('');
  const [cursor, setCursor] = useState(0);
  const [escolhida, setEscolhida] = useState(0);
  // Fechado à mão com `Esc`, até o gatilho mudar. Sem isto, `Esc` fecharia e a
  // próxima tecla reabriria a mesma lista.
  const [dispensado, setDispensado] = useState('');
  const [arrastando, setArrastando] = useState(false);

  const gatilho = useMemo(() => gatilhoAtivo(texto, cursor), [texto, cursor]);
  const sugestoes = useMemo(
    () => (gatilho ? sugerir(gatilho, pessoas, canais) : []),
    [gatilho, pessoas, canais],
  );
  const chaveDoGatilho = gatilho ? `${gatilho.tipo}${gatilho.inicio}` : '';
  const abertas = sugestoes.length > 0 && dispensado !== chaveDoGatilho;

  useEffect(() => {
    setEscolhida(0);
  }, [chaveDoGatilho, sugestoes.length]);

  const completar = useCallback(
    (sugestao: Sugestao) => {
      if (!gatilho) return;
      const antes = texto.slice(0, gatilho.inicio);
      const depois = texto.slice(cursor);
      const novo = antes + sugestao.troca + depois;
      const posicao = antes.length + sugestao.troca.length;

      setTexto(novo);
      requestAnimationFrame(() => {
        const el = campo.current;
        el?.focus();
        el?.setSelectionRange(posicao, posicao);
        setCursor(posicao);
      });
    },
    [gatilho, texto, cursor],
  );

  const ajustarAltura = useCallback(() => {
    const el = campo.current;
    if (!el) return;
    // `auto` primeiro: sem isso o `scrollHeight` nunca diminui e o campo só
    // cresce, mesmo quando a pessoa apaga o que escreveu.
    el.style.height = 'auto';
    el.style.height = `${Math.min(ALTURA_MAX, Math.max(ALTURA_MIN, el.scrollHeight))}px`;
  }, []);

  useEffect(() => {
    ajustarAltura();
  }, [texto, ajustarAltura]);

  // Trocar de canal limpa o que estava escrito para outro lugar.
  useEffect(() => {
    setTexto('');
    limparContexto();
  }, [canal.id, limparContexto]);

  // Entrar em edição traz o texto atual; responder não mexe no que já está
  // escrito — quem já digitou meia frase antes de clicar em responder não a
  // perde.
  useEffect(() => {
    if (!editando) return;
    setTexto(editando.content ?? '');
    requestAnimationFrame(() => {
      const el = campo.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }, [editando]);

  useEffect(() => {
    if (respondendoA) campo.current?.focus();
  }, [respondendoA]);

  const sinalizarDigitacao = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoTyping.current < TYPING_THROTTLE_MS) return;
    ultimoTyping.current = agora;
    enviarPeloSocket({ op: 'TYPING_START', d: { channelId: canal.id } });
  }, [canal.id]);

  const cancelar = useCallback(() => {
    if (editando) setTexto('');
    limparContexto();
    campo.current?.focus();
  }, [editando, limparContexto]);

  const submeter = useCallback(() => {
    const conteudo = texto.trim();
    const anexos = prontos(pendentes);
    // Uma foto sem legenda é uma mensagem inteira; um `Enter` num campo vazio
    // não é. E enquanto algum upload não terminou, enviar perderia o arquivo.
    if ((!conteudo && anexos.length === 0) || algumSubindo(pendentes)) return;

    if (editando) {
      const alvo = editando;
      limparContexto();
      setTexto('');
      void api<{ message: Message }>(`/messages/${alvo.id}`, {
        method: 'PATCH',
        body: { content: conteudo },
      })
        .then((r) => atualizarMensagem(qc, r.message))
        .catch(() => show('Não foi possível editar a mensagem.', 'danger'));
      return;
    }

    enviar({
      channelId: canal.id,
      content: conteudo,
      ...(anexos.length > 0 ? { anexos } : {}),
      ...(respondendoA ? { replyToId: respondendoA.id } : {}),
    });
    setTexto('');
    limparAnexos(canal.id);
    limparContexto();
    // O envio é otimista: quem escreveu já vê a mensagem, então o campo pode
    // esvaziar sem esperar resposta nenhuma.
  }, [
    texto,
    pendentes,
    editando,
    enviar,
    canal.id,
    qc,
    show,
    respondendoA,
    limparContexto,
    limparAnexos,
  ]);

  /** `↑` no campo vazio traz a sua última mensagem para edição. */
  const editarUltima = useCallback(() => {
    const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(canal.id));
    const minha = [...(cache?.mensagens ?? [])]
      .reverse()
      .find((m) => m.author.id === meuId && !m.local && !m.deletedAt && m.content);
    if (minha) editar(minha);
  }, [qc, canal.id, meuId, editar]);

  const inserir = useCallback((trecho: string) => {
    const el = campo.current;
    if (!el) return;
    const inicio = el.selectionStart;
    const fim = el.selectionEnd;
    setTexto((atual) => atual.slice(0, inicio) + trecho + atual.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + trecho.length, inicio + trecho.length);
    });
  }, []);

  const escolherArquivos = useCallback(
    (arquivos: FileList | null) => {
      const lista = arquivos ? [...arquivos] : [];
      if (lista.length === 0) return;
      anexarArquivos(canal.id, lista);
      campo.current?.focus();
    },
    [anexarArquivos, canal.id],
  );

  /**
   * Colar uma imagem anexa; colar texto não é da nossa conta.
   *
   * A captura de tela vai para a área de transferência como arquivo, e é de
   * longe o anexo mais comum numa conversa de trabalho. `preventDefault` só
   * quando há arquivo — sem isso, colar texto pararia de funcionar.
   */
  const aoColar = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const arquivos = [...e.clipboardData.files];
      if (arquivos.length === 0) return;
      e.preventDefault();
      anexarArquivos(canal.id, arquivos);
    },
    [anexarArquivos, canal.id],
  );

  const aoTeclar = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enquanto o IME está montando um caractere, `Enter` confirma a
      // composição — enviar aqui cortaria a palavra no meio.
      if (e.nativeEvent.isComposing) return;

      // O autocompletar come as teclas antes de todo o resto: com a lista
      // aberta, `Enter` escolhe e não envia.
      if (abertas) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setEscolhida((i) => {
            const passo = e.key === 'ArrowDown' ? 1 : -1;
            return (i + passo + sugestoes.length) % sugestoes.length;
          });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const alvo = sugestoes[escolhida];
          if (alvo) {
            e.preventDefault();
            completar(alvo);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDispensado(chaveDoGatilho);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submeter();
        return;
      }
      if (e.key === 'Escape' && (editando || respondendoA)) {
        e.preventDefault();
        cancelar();
        return;
      }
      if (e.key === 'ArrowUp' && texto === '' && !editando) {
        e.preventDefault();
        editarUltima();
        return;
      }

      // `⇧ Tab` entra na lista, e não na ordem natural do DOM: entre o
      // compositor e a última mensagem existem chips de reação e botões de
      // citação, todos focáveis, e a tabulação pararia no primeiro deles. A
      // lista é **um** ponto de parada, então o salto é explícito.
      if (e.key === 'Tab' && e.shiftKey) {
        const cache = qc.getQueryData<CacheCanal>(chaveDoCanal(canal.id));
        const ultima = cache?.mensagens[cache.mensagens.length - 1];
        if (!ultima) return;
        e.preventDefault();
        focar(ultima.id);
        // O `.focus()` é imperativo de propósito: confiar no efeito que
        // reage a `assumirFoco` falha quando o id já era o focado — clicar
        // numa citação registra o foco daquela mensagem, e o `⇧ Tab`
        // seguinte não mudaria estado nenhum, logo nada aconteceria.
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`article[data-id="${CSS.escape(ultima.id)}"]`)
            ?.focus();
        });
      }
    },
    [
      submeter,
      editando,
      respondendoA,
      cancelar,
      texto,
      editarUltima,
      qc,
      canal.id,
      focar,
      abertas,
      sugestoes,
      escolhida,
      completar,
      chaveDoGatilho,
    ],
  );

  const contexto = editando
    ? { titulo: 'Editando mensagem', dica: 'Esc para cancelar', icone: null }
    : respondendoA
      ? {
          titulo: `Respondendo a ${respondendoA.author.displayName}`,
          dica: 'Esc para cancelar',
          icone: <Reply size={14} />,
        }
      : null;

  return (
    <div className={styles.compositorArea}>
      {/* Acima do campo, nunca abaixo: embaixo ela sairia da tela, porque o
          compositor já está colado no rodapé. */}
      {abertas ? (
        <div className={styles.sugestoes} role="listbox" aria-label="Sugestões">
          {sugestoes.map((s, i) => (
            <button
              key={s.chave}
              type="button"
              role="option"
              aria-selected={i === escolhida}
              className={styles.sugestao}
              data-ativa={i === escolhida}
              onMouseEnter={() => setEscolhida(i)}
              onMouseDown={(e) => {
                // `mousedown` e não `click`: o clique tiraria o foco do campo
                // antes de completar, e o cursor se perderia.
                e.preventDefault();
                completar(s);
              }}
            >
              {s.simbolo ? <span className={styles.sugestaoSimbolo}>{s.simbolo}</span> : null}
              <span className={styles.sugestaoRotulo}>{s.rotulo}</span>
              {s.detalhe ? <span className={styles.sugestaoDetalhe}>{s.detalhe}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {contexto ? (
        <div className={styles.barraContexto}>
          {contexto.icone}
          <span>{contexto.titulo}</span>
          <span className={styles.dica}>{contexto.dica}</span>
          <IconButton label="Cancelar" size="sm" onClick={cancelar}>
            <X size={16} />
          </IconButton>
        </div>
      ) : null}

      <FaixaDeAnexos channelId={canal.id} />

      <div
        className={styles.compositor}
        data-contexto={contexto !== null}
        data-arrastando={arrastando}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={(e) => {
          // `relatedTarget` fora do compositor: sem esta checagem, passar por
          // cima de um botão de dentro contaria como sair.
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setArrastando(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setArrastando(false);
          escolherArquivos(e.dataTransfer.files);
        }}
      >
        <Tooltip label="Anexar arquivo">
          <IconButton
            label="Anexar arquivo"
            size="sm"
            onClick={() => seletorDeArquivo.current?.click()}
          >
            <Paperclip size={18} />
          </IconButton>
        </Tooltip>
        {/* O input fica escondido e o botão o aciona: o seletor nativo é feio
            e não aceita estilo, mas é o único que abre o diálogo do sistema. */}
        <input
          ref={seletorDeArquivo}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            escolherArquivos(e.target.files);
            // Sem isto, escolher o mesmo arquivo duas vezes seguidas não
            // dispara `change` na segunda.
            e.target.value = '';
          }}
        />

        <textarea
          ref={campo}
          id="compositor"
          className={styles.campo}
          rows={1}
          value={texto}
          // O `#` é do canal de texto. Um canal de voz tem conversa igual,
          // mas chamá-lo de `#sala` contradiz o ícone ao lado do nome.
          placeholder={`escreva em ${canal.kind === 'voice' ? '' : '#'}${canal.name}`}
          aria-label={`Escrever em ${canal.name}`}
          onChange={(e) => {
            setTexto(e.target.value);
            setCursor(e.target.selectionStart);
            if (e.target.value) sinalizarDigitacao();
          }}
          onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
          onClick={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
        />

        <SeletorDeEmoji
          onEscolher={inserir}
          trigger={
            <IconButton label="Emoji" size="sm">
              <span aria-hidden="true" className={styles.emojiBotao}>
                🙂
              </span>
            </IconButton>
          }
        />

        <Tooltip label={editando ? 'Salvar' : 'Enviar'}>
          <IconButton
            label={editando ? 'Salvar' : 'Enviar'}
            size="sm"
            disabled={
              (texto.trim().length === 0 && prontos(pendentes).length === 0) ||
              algumSubindo(pendentes)
            }
            onClick={submeter}
          >
            <Send size={18} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
