import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import type { Channel, User } from '@trindade/shared';
import { Avatar } from '../../components';
import { colorFromId, ensureContrast } from '../../lib/contraste';
import { lerToken } from '../../lib/tokens';
import { useAuth } from '../auth/store';
import { abrirNota, FRAGMENTO, type Provedor } from './provedor';
import styles from './notas.module.css';

/**
 * A nota do canal.
 *
 * Uma por canal — não uma wiki, não uma árvore de páginas. Um documento só, o
 * "estado atual" daquele assunto. Ver design/08-projeto.md.
 *
 * Sem barra de ferramentas: atalhos e a sintaxe do Markdown bastam para cinco
 * pessoas que sabem escrever Markdown. E sem botão de salvar — o documento é um
 * CRDT, o que existe é o que está na tela.
 */
export function PainelDeNotas({ canal, pessoas }: { canal: Channel; pessoas: readonly User[] }) {
  const eu = useAuth((s) => s.user);
  const [podeEditar, setPodeEditar] = useState(false);
  const [presentes, setPresentes] = useState<string[]>([]);
  const [provedor, setProvedor] = useState<Provedor | null>(null);
  const [pronto, setPronto] = useState(false);

  const cor = useMemo(
    () => (eu ? ensureContrast(colorFromId(eu.id), lerToken('--bg-panel', '#0b1120')) : '#22d3ee'),
    [eu],
  );

  /* O provedor nasce e morre **dentro do efeito**.
   *
   * A primeira versão o criava durante a renderização e o destruía na limpeza:
   * no StrictMode, o efeito roda, é limpo e roda de novo — a limpeza destruía o
   * provedor que a renderização já tinha criado, e o segundo `NOTE_CLOSE`
   * cancelava a inscrição no servidor. O editor continuava na tela, o texto
   * ainda chegava ao banco, e nada dos outros voltava: sem cursor, sem faixa de
   * "editando", sem uma letra do que o outro escrevia.
   *
   * Simétrico assim, cada limpeza corresponde a uma criação.
   */
  useEffect(() => {
    if (!eu) return;

    const aberto = abrirNota({
      channelId: canal.id,
      eu: { id: eu.id, nome: eu.displayName, cor },
      aoReceberEstado: (permitido) => {
        setPodeEditar(permitido);
        setPronto(true);
      },
      aoMudarPresenca: setPresentes,
    });
    setProvedor(aberto);

    return () => {
      aberto.destruir();
      setProvedor(null);
      setPronto(false);
      setPresentes([]);
    };
  }, [canal.id, eu, cor]);

  const outros = presentes.filter((id) => id !== eu?.id);

  return (
    <div className={styles.painel}>
      {/* A faixa só aparece com alguém além de você. Sozinho, não há nada a
          dizer — e uma faixa que diz "só você" é ruído permanente. */}
      {outros.length > 0 ? (
        <div className={styles.editando} aria-live="polite">
          <span className={styles.avatares}>
            {outros.slice(0, 3).map((id) => {
              const quem = pessoas.find((p) => p.id === id);
              return (
                <Avatar
                  key={id}
                  id={id}
                  name={quem?.displayName ?? 'Alguém'}
                  src={quem?.avatarUrl}
                  size="xs"
                />
              );
            })}
          </span>
          {nomesDeQuemEdita(outros, pessoas)}
        </div>
      ) : null}

      {!podeEditar && pronto ? (
        <p className={styles.somenteLeitura}>
          Você pode ler estas notas, mas não editá-las.
        </p>
      ) : null}

      <div className={styles.corpo}>
        {pronto && provedor ? (
          /* `key` no provedor: o editor é **refeito** quando o provedor troca.
             As extensões de colaboração guardam o documento no momento em que
             são configuradas, e trocá-lo por baixo não funciona — o editor
             continua desenhando o documento antigo, que recebe o estado inicial
             e nunca mais um delta. */
          <EditorDaNota
            key={provedor.id}
            provedor={provedor}
            podeEditar={podeEditar}
            rotulo={`Notas de ${canal.name}`}
            eu={{ name: eu?.displayName ?? 'Alguém', color: cor }}
          />
        ) : (
          <p className={styles.carregando}>Abrindo…</p>
        )}
      </div>
    </div>
  );
}

/** "Ana editando", "Ana e Bruno editando", "Ana e mais 2 editando". */
function nomesDeQuemEdita(ids: string[], pessoas: readonly User[]): string {
  const nomes = ids.map(
    (id) => pessoas.find((p) => p.id === id)?.displayName.split(' ')[0] ?? 'Alguém',
  );
  if (nomes.length === 1) return `${nomes[0]} editando`;
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]} editando`;
  return `${nomes[0]} e mais ${nomes.length - 1} editando`;
}

function EditorDaNota({
  provedor,
  podeEditar,
  rotulo,
  eu,
}: {
  provedor: Provedor;
  podeEditar: boolean;
  rotulo: string;
  eu: { name: string; color: string };
}) {
  const editor = useEditor({
    extensions: [
      // O histórico do StarterKit briga com o do Yjs: os dois querem ser o
      // "desfazer", e juntos desfazem coisa dos outros.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: provedor.doc, field: FRAGMENTO }),
      /* O `user` vai aqui e não só na awareness: a extensão escreve o próprio
         campo ao montar, e sem ele o outro lado desenha "User: 1888703423" em
         vez do primeiro nome. */
      CollaborationCaret.configure({
        provider: { awareness: provedor.awareness },
        user: eu,
      }),
    ],
    editable: podeEditar,
    editorProps: {
      attributes: { class: styles.editor ?? '', 'aria-label': rotulo },
    },
  });

  return <EditorContent editor={editor} />;
}
