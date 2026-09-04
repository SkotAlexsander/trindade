import { useMemo, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  COLUNAS,
  NOME_DA_COLUNA,
  Perm,
  can,
  type ColunaDoQuadro,
  type Task,
  type User,
} from '@trindade/shared';
import { Avatar, Button, Input, Menu, MenuItem } from '../../components';
import { Check, Reply } from '../../components/icones';
import { useAuth } from '../auth/store';
import { useThread } from '../messages/store';
import {
  posicaoEntre,
  useAtribuirTarefa,
  useConcluirTarefa,
  useCriarTarefa,
  useMoverTarefa,
  useTarefas,
} from './queries';
import styles from './tarefas.module.css';

/**
 * O quadro do canal.
 *
 * Colunas **empilhadas na vertical**: o painel tem 320px, e três colunas lado a
 * lado nele viram cartões de 90px ilegíveis. Ver design/08-projeto.md.
 */
export function PainelDeTarefas({
  channelId,
  pessoas,
}: {
  channelId: string;
  pessoas: readonly User[];
}) {
  const { data: tarefas } = useTarefas(channelId);
  const permissoes = useAuth((s) => s.permissions);
  const podeMexer = can(permissoes, Perm.MANAGE_TASKS);

  const mover = useMoverTarefa(channelId);
  const criar = useCriarTarefa(channelId);
  const concluir = useConcluirTarefa();
  const atribuir = useAtribuirTarefa();

  const [feitoAberto, setFeitoAberto] = useState(false);
  const [titulo, setTitulo] = useState('');

  // O ponteiro só começa a arrastar depois de 6px: sem isso, um clique no
  // cartão vira arrasto de um pixel e o link de volta nunca abre.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const porColuna = useMemo(() => {
    const mapa: Record<ColunaDoQuadro, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tarefas ?? []) mapa[t.columnKey]?.push(t);
    for (const coluna of COLUNAS) mapa[coluna].sort((a, b) => a.position - b.position);
    // Feito mostra as concluídas nos últimos 14 dias; antes disso é histórico,
    // e histórico não precisa estar na frente todo dia.
    const limite = Date.now() - 14 * 86_400_000;
    mapa.done = mapa.done.filter((t) => !t.completedAt || Date.parse(t.completedAt) >= limite);
    return mapa;
  }, [tarefas]);

  function aoSoltar(evento: DragEndEvent): void {
    const destino = evento.over?.id;
    const arrastada = (tarefas ?? []).find((t) => t.id === evento.active.id);
    if (!destino || !arrastada) return;

    const coluna = String(destino) as ColunaDoQuadro;
    if (!COLUNAS.includes(coluna)) return;

    const lista = porColuna[coluna].filter((t) => t.id !== arrastada.id);
    // Soltar na coluna põe no fim dela: com colunas curtas, escolher a posição
    // exata é precisão que ninguém pediu.
    mover.mutate({
      id: arrastada.id,
      columnKey: coluna,
      position: posicaoEntre(lista[lista.length - 1], undefined),
    });
  }

  return (
    <div className={styles.painel}>
      {podeMexer ? (
        <form
          className={styles.nova}
          onSubmit={(e) => {
            e.preventDefault();
            const texto = titulo.trim();
            if (!texto) return;
            criar.mutate({ title: texto });
            setTitulo('');
          }}
        >
          <Input
            label="Nova tarefa"
            placeholder="O que precisa ser feito?"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!titulo.trim()}>
            Criar
          </Button>
        </form>
      ) : null}

      <DndContext sensors={sensores} onDragEnd={aoSoltar}>
        <div className={styles.colunas}>
          {COLUNAS.map((coluna) => (
            <Coluna
              key={coluna}
              coluna={coluna}
              tarefas={porColuna[coluna]}
              pessoas={pessoas}
              podeMexer={podeMexer}
              recolhida={coluna === 'done' && !feitoAberto}
              onAlternar={() => coluna === 'done' && setFeitoAberto((v) => !v)}
              onConcluir={(t) => concluir.mutate({ id: t.id, concluida: !t.completedAt })}
              onDono={(t, assigneeId) => atribuir.mutate({ id: t.id, assigneeId })}
              onPrazo={(t, dueAt) => atribuir.mutate({ id: t.id, dueAt })}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Coluna({
  coluna,
  tarefas,
  pessoas,
  podeMexer,
  recolhida,
  onAlternar,
  onConcluir,
  onDono,
  onPrazo,
}: {
  coluna: ColunaDoQuadro;
  tarefas: Task[];
  pessoas: readonly User[];
  podeMexer: boolean;
  recolhida: boolean;
  onAlternar: () => void;
  onConcluir: (t: Task) => void;
  onDono: (t: Task, assigneeId: string | null) => void;
  onPrazo: (t: Task, dueAt: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna });

  return (
    <section ref={setNodeRef} className={styles.coluna} data-sobre={isOver}>
      <header className={styles.cabecalhoDaColuna}>
        {coluna === 'done' ? (
          <button
            type="button"
            className={styles.tituloBotao}
            aria-expanded={!recolhida}
            onClick={onAlternar}
          >
            {NOME_DA_COLUNA[coluna]}
          </button>
        ) : (
          <span className={styles.titulo}>{NOME_DA_COLUNA[coluna]}</span>
        )}
        <span className={styles.contagem}>{tarefas.length}</span>
      </header>

      {recolhida ? (
        <button type="button" className={styles.mostrar} onClick={onAlternar}>
          mostrar
        </button>
      ) : (
        tarefas.map((tarefa) => (
          <Cartao
            key={tarefa.id}
            tarefa={tarefa}
            dono={pessoas.find((p) => p.id === tarefa.assigneeId)}
            pessoas={pessoas}
            podeMexer={podeMexer}
            onConcluir={() => onConcluir(tarefa)}
            onDono={(id) => onDono(tarefa, id)}
            onPrazo={(iso) => onPrazo(tarefa, iso)}
          />
        ))
      )}
    </section>
  );
}

function Cartao({
  tarefa,
  dono,
  pessoas,
  podeMexer,
  onConcluir,
  onDono,
  onPrazo,
}: {
  tarefa: Task;
  dono: User | undefined;
  pessoas: readonly User[];
  podeMexer: boolean;
  onConcluir: () => void;
  onDono: (assigneeId: string | null) => void;
  onPrazo: (dueAt: string | null) => void;
}) {
  const abrirThread = useThread((s) => s.abrir);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: tarefa.id,
    disabled: !podeMexer,
  });

  return (
    <article
      ref={setNodeRef}
      className={styles.cartao}
      data-arrastando={isDragging}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      {...listeners}
      {...attributes}
    >
      <div className={styles.linhaTitulo}>
        {podeMexer ? (
          <button
            type="button"
            className={styles.marcar}
            data-feita={Boolean(tarefa.completedAt)}
            aria-label={tarefa.completedAt ? 'Reabrir tarefa' : 'Concluir tarefa'}
            onClick={onConcluir}
            // O clique de concluir não pode virar arrasto.
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Check size={12} />
          </button>
        ) : null}
        <span className={styles.tituloDaTarefa} data-feita={Boolean(tarefa.completedAt)}>
          {tarefa.title}
        </span>
      </div>

      <div className={styles.rodapeDoCartao}>
        {/* "sem dono" é um convite, e convite que não dá para aceitar é
            decoração: o mesmo lugar que mostra quem assumiu é onde se assume. */}
        <Menu
          label="Dono da tarefa"
          trigger={
            <button
              type="button"
              className={dono ? styles.dono : styles.semDono}
              disabled={!podeMexer}
              aria-label={dono ? `Dono: ${dono.displayName}` : 'Assumir ou atribuir'}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {dono ? (
                <>
                  <Avatar id={dono.id} name={dono.displayName} src={dono.avatarUrl} size="xs" />
                  {dono.displayName.split(' ')[0]}
                </>
              ) : (
                <>
                  <span className={styles.circulo} aria-hidden="true" />
                  sem dono
                </>
              )}
            </button>
          }
        >
          {pessoas.map((p) => (
            <MenuItem
              key={p.id}
              icon={<Avatar id={p.id} name={p.displayName} src={p.avatarUrl} size="xs" />}
              onSelect={() => onDono(p.id === tarefa.assigneeId ? null : p.id)}
            >
              {p.displayName}
            </MenuItem>
          ))}
          {tarefa.assigneeId ? (
            <MenuItem onSelect={() => onDono(null)}>Deixar sem dono</MenuItem>
          ) : null}
        </Menu>

        {/* O prazo aparece sempre que existe, e só no hover quando não existe:
            um campo de data vazio em cada cartão é ruído em cima do título. */}
        {podeMexer ? (
          <label className={styles.prazo} data-vazio={!tarefa.dueAt}>
            <span className="visually-hidden">Prazo</span>
            {tarefa.dueAt ? (
              <span data-passou={Date.parse(tarefa.dueAt) < Date.now()}>
                {prazoRelativo(tarefa.dueAt)}
              </span>
            ) : null}
            <input
              type="date"
              value={tarefa.dueAt ? tarefa.dueAt.slice(0, 10) : ''}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => onPrazo(e.target.value ? `${e.target.value}T12:00:00.000Z` : null)}
            />
          </label>
        ) : tarefa.dueAt ? (
          <span className={styles.prazo} data-passou={Date.parse(tarefa.dueAt) < Date.now()}>
            {prazoRelativo(tarefa.dueAt)}
          </span>
        ) : null}

        {/* O elo de volta. Sem ele, o quadro é um Trello pior. */}
        {tarefa.sourceMessageId ? (
          <button
            type="button"
            className={styles.origem}
            aria-label="Ver a mensagem de origem"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => abrirThread(tarefa.sourceMessageId as string)}
          >
            <Reply size={12} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** "hoje", "amanhã", "até sex", "há 2 dias". */
export function prazoRelativo(iso: string, agora = new Date()): string {
  const alvo = new Date(iso);
  const dias = Math.round(
    (new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate()).getTime() -
      new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime()) /
      86_400_000,
  );

  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias === -1) return 'ontem';
  if (dias < 0) return `há ${-dias} dias`;
  if (dias <= 6) {
    const nomes = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    return `até ${nomes[alvo.getDay()]}`;
  }
  return alvo.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
