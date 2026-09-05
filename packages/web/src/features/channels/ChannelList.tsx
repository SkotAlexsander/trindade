import { useState, type DragEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { IconButton } from '../../components';
import { ChevronDown, Hash, Reticencias, SinoCortado } from '../../components/icones';
import { ChannelMenu } from '../shell/ChannelMenu';
import { ItemDeVoz } from '../voice/ItemDeVoz';
import { LinhaDeApresentacao } from '../boards/LinhaDeApresentacao';
import { groupByCategory, type Category, type ChannelWithState } from './canais';
import styles from './channels.module.css';

export interface ChannelListProps {
  channels: ChannelWithState[];
  /** Mostra a alça de arrasto e permite reordenar. */
  podeGerenciar?: boolean;
  onReorder?: (ordem: ChannelWithState[]) => void;
}

export function ChannelList({ channels, podeGerenciar = false, onReorder }: ChannelListProps) {
  const [recolhidas, setRecolhidas] = useState<ReadonlySet<string>>(new Set());
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [destino, setDestino] = useState<string | null>(null);

  const grupos = groupByCategory(channels);

  function alternar(nome: string): void {
    setRecolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(nome)) proximo.delete(nome);
      else proximo.add(nome);
      return proximo;
    });
  }

  function soltar(alvoId: string): void {
    if (!arrastando || arrastando === alvoId || !onReorder) return;

    const atual = [...channels];
    const de = atual.findIndex((c) => c.id === arrastando);
    const para = atual.findIndex((c) => c.id === alvoId);
    if (de === -1 || para === -1) return;

    const [movido] = atual.splice(de, 1);
    if (movido) {
      // Cai na categoria do alvo: arrastar entre categorias é como se move um
      // canal de lugar, não um caso separado.
      const alvo = channels.find((c) => c.id === alvoId);
      atual.splice(para, 0, { ...movido, category: alvo?.category ?? movido.category });
    }
    onReorder(atual);
    setArrastando(null);
    setDestino(null);
  }

  return (
    <nav aria-label="Canais">
      {grupos.map((grupo) => (
        <GrupoCategoria
          key={grupo.nome ?? '_sem_'}
          grupo={grupo}
          recolhida={grupo.nome !== null && recolhidas.has(grupo.nome)}
          onAlternar={() => grupo.nome && alternar(grupo.nome)}
          podeGerenciar={podeGerenciar}
          arrastando={arrastando}
          destino={destino}
          setArrastando={setArrastando}
          setDestino={setDestino}
          onSoltar={soltar}
        />
      ))}
    </nav>
  );
}

function GrupoCategoria({
  grupo,
  recolhida,
  onAlternar,
  podeGerenciar,
  arrastando,
  destino,
  setArrastando,
  setDestino,
  onSoltar,
}: {
  grupo: Category;
  recolhida: boolean;
  onAlternar: () => void;
  podeGerenciar: boolean;
  arrastando: string | null;
  destino: string | null;
  setArrastando: (id: string | null) => void;
  setDestino: (id: string | null) => void;
  onSoltar: (id: string) => void;
}) {
  // Categoria recolhida esconde os canais lidos e mantém os não lidos. Um
  // canal com menção nunca some, mesmo com a categoria fechada.
  const visiveis = recolhida
    ? grupo.canais.filter((c) => c.unread || c.mentions > 0)
    : grupo.canais;

  return (
    <div className={styles.categoria}>
      {grupo.nome ? (
        <button
          type="button"
          className={styles.categoriaCabecalho}
          aria-expanded={!recolhida}
          onClick={onAlternar}
        >
          <ChevronDown size={12} className={styles.chevron} />
          {grupo.nome}
        </button>
      ) : null}

      {visiveis.map((canal) => (
        <div key={canal.id}>
          {destino === canal.id && arrastando ? <div className={styles.destino} /> : null}
          {/* O menu é irmão do item, e não filho: o item é um `<a>`, e um
              botão dentro de uma âncora é HTML inválido — o clique no botão
              navegaria junto. */}
          <div className={styles.linha}>
            <ItemCanal
              canal={canal}
              podeGerenciar={podeGerenciar}
              arrastando={arrastando === canal.id}
              onDragStart={() => setArrastando(canal.id)}
              onDragOver={() => setDestino(canal.id)}
              onDrop={() => onSoltar(canal.id)}
              onDragEnd={() => {
                setArrastando(null);
                setDestino(null);
              }}
            />
            <ChannelMenu
              canal={canal}
              podeGerenciar={podeGerenciar}
              trigger={
                <IconButton
                  label={`Ações de ${canal.name}`}
                  size="sm"
                  className={styles.acoes}
                >
                  <Reticencias size={16} />
                </IconButton>
              }
            />
          </div>
          {/* Uma apresentação em curso aparece aqui, indentada, como os
              avatares da chamada: quem está olhando a lista precisa ver que
              tem gente ao vivo ali dentro. */}
          <LinhaDeApresentacao channelId={canal.id} slug={canal.slug} />
        </div>
      ))}
    </div>
  );
}

function ItemCanal({
  canal,
  podeGerenciar,
  arrastando,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  canal: ChannelWithState;
  podeGerenciar: boolean;
  arrastando: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const arrasto = {
    draggable: podeGerenciar,
    onDragStart,
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      onDragOver();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      onDrop();
    },
    onDragEnd,
  };

  // Canal de voz não é um link: clicar nele **conecta**, e não existe página
  // para onde navegar. Ver design/07-chamada.md.
  if (canal.kind === 'voice') {
    return (
      <ItemDeVoz
        canal={canal}
        className={styles.item ?? ''}
        arrastando={arrastando}
        arrasto={arrasto}
      />
    );
  }

  return (
    <NavLink
      to={`/c/${canal.slug}`}
      // O estado ativo entra por classe, não por atributo: o NavLink já
      // calcula `isActive` aqui e assim ativo e não lido não brigam por
      // especificidade no CSS.
      className={({ isActive }) =>
        [styles.item, isActive ? styles.ativo : ''].filter(Boolean).join(' ')
      }
      data-unread={canal.unread}
      data-silenciado={canal.silenciadoAte !== null}
      data-arrastando={arrastando}
      draggable={podeGerenciar}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <span className={styles.icone}>
        {podeGerenciar ? (
          <span className={styles.alca} aria-hidden="true">
            ⠿
          </span>
        ) : null}
        <Hash size={16} />
      </span>
      <span className={styles.nome}>{canal.name}</span>
      {/* Silenciado continua marcando não lido, mas em peso normal e com o
          sino cortado: você vê que houve movimento sem que ele grite. */}
      {canal.silenciadoAte ? (
        <span className={styles.sino} aria-label="silenciado">
          <SinoCortado size={12} />
        </span>
      ) : null}
      {canal.mentions > 0 ? (
        <span className={styles.mencoes} aria-label={`${canal.mentions} menções`}>
          {canal.mentions > 9 ? '9+' : canal.mentions}
        </span>
      ) : canal.unread ? (
        <span className={styles.ponto} aria-label="não lido" />
      ) : null}
    </NavLink>
  );
}
