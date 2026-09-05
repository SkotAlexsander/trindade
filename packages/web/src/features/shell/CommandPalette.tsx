import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@trindade/shared';
import { Avatar } from '../../components';
import { Hash, Search, Volume } from '../../components/icones';
import type { ChannelWithState } from '../channels/canais';
import { useDialogoDeCanal } from '../channels/DialogoDeCanal';
import { useDialogoDeConvite } from '../people/useDialogoDeConvite';
import styles from './palette.module.css';

export interface CommandPaletteProps {
  aberta: boolean;
  onFechar: () => void;
  canais: ChannelWithState[];
  pessoas: User[];
  onAbrirPainel: (qual: 'fixadas' | 'guardadas') => void;
}

interface Resultado {
  id: string;
  grupo: 'Canais' | 'Pessoas' | 'Ações';
  rotulo: string;
  detalhe?: string;
  icone?: React.ReactNode;
  run: () => void;
}

/**
 * Busca difusa: as letras do termo precisam aparecer em ordem no alvo, não
 * necessariamente juntas — `prd` acha `produto`.
 *
 * A pontuação favorece quem casa mais cedo e mais junto, para que `bug` não
 * ranqueie um canal onde as três letras estão espalhadas acima de `bugs`.
 */
export function pontuar(alvo: string, termo: string): number | null {
  if (!termo) return 0;
  const a = alvo.toLowerCase();
  const t = termo.toLowerCase();

  let indice = -1;
  let pontos = 0;
  let anterior = -2;

  for (const letra of t) {
    indice = a.indexOf(letra, indice + 1);
    if (indice === -1) return null;
    // Letras seguidas valem mais que letras espalhadas.
    pontos += indice === anterior + 1 ? 3 : 1;
    if (indice === 0) pontos += 2;
    anterior = indice;
  }
  // Alvo curto que casa inteiro vale mais que alvo longo com as letras soltas.
  return pontos - a.length * 0.01;
}

export function CommandPalette({
  aberta,
  onFechar,
  canais,
  pessoas,
  onAbrirPainel,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  /* As duas ações abrem diálogo. Antes navegavam para `/config/canais` e
     `/config/convites`, rotas que nunca existiram e caíam na página que
     dizia "chega numa fase adiante" — com o diálogo de convite pronto e
     ligado no menu do servidor ao lado. */
  const criarCanal = useDialogoDeCanal((s) => s.criar);
  const abrirConvite = useDialogoDeConvite((s) => s.abrir);
  const [termo, setTermo] = useState('');
  const [selecionado, setSelecionado] = useState(0);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const acoes: Resultado[] = useMemo(
    () => [
      {
        id: 'acao-criar-canal',
        grupo: 'Ações',
        rotulo: 'Criar canal',
        run: criarCanal,
      },
      {
        id: 'acao-convidar',
        grupo: 'Ações',
        rotulo: 'Convidar alguém',
        run: abrirConvite,
      },
      {
        id: 'acao-guardadas',
        grupo: 'Ações',
        rotulo: 'Guardadas',
        detalhe: 'suas, de todas as conversas',
        run: () => onAbrirPainel('guardadas'),
      },
      {
        id: 'acao-fixadas',
        grupo: 'Ações',
        rotulo: 'Fixadas',
        detalhe: 'deste canal, de todo mundo',
        run: () => onAbrirPainel('fixadas'),
      },
    ],
    [criarCanal, abrirConvite, onAbrirPainel],
  );

  const resultados = useMemo(() => {
    const todos: Array<Resultado & { pontos: number }> = [];

    for (const canal of canais) {
      const pontos = pontuar(canal.name, termo);
      if (pontos === null) continue;
      todos.push({
        id: `canal-${canal.id}`,
        grupo: 'Canais',
        rotulo: canal.name,
        ...(canal.topic ? { detalhe: canal.topic } : {}),
        icone: canal.kind === 'voice' ? <Volume size={16} /> : <Hash size={16} />,
        run: () => navigate(`/c/${canal.slug}`),
        pontos,
      });
    }

    for (const pessoa of pessoas) {
      const pontos = Math.max(
        pontuar(pessoa.displayName, termo) ?? -Infinity,
        pontuar(pessoa.username, termo) ?? -Infinity,
      );
      if (pontos === -Infinity) continue;
      todos.push({
        id: `pessoa-${pessoa.id}`,
        grupo: 'Pessoas',
        rotulo: pessoa.displayName,
        detalhe: `@${pessoa.username}`,
        icone: <Avatar id={pessoa.id} name={pessoa.displayName} src={pessoa.avatarUrl} size="xs" />,
        run: () => undefined,
        pontos,
      });
    }

    for (const acao of acoes) {
      const pontos = pontuar(acao.rotulo, termo);
      if (pontos === null) continue;
      todos.push({ ...acao, pontos });
    }

    const ordenados = todos.sort((a, b) => b.pontos - a.pontos).slice(0, 12);

    // Beco sem saída vira ação: sem resultado, ofereça buscar nas mensagens.
    if (ordenados.length === 0 && termo) {
      return [
        {
          id: 'buscar-mensagens',
          grupo: 'Ações' as const,
          rotulo: `Buscar "${termo}" nas mensagens`,
          run: () => undefined,
          pontos: 0,
        },
      ];
    }
    return ordenados;
  }, [canais, pessoas, acoes, termo, navigate]);

  useEffect(() => {
    if (aberta) {
      setTermo('');
      setSelecionado(0);
      campoRef.current?.focus();
    }
  }, [aberta]);

  useEffect(() => {
    setSelecionado(0);
  }, [termo]);

  if (!aberta) return null;

  function escolher(indice: number): void {
    resultados[indice]?.run();
    onFechar();
  }

  // Agrupa preservando a ordem por pontuação dentro de cada grupo.
  const grupos: Array<{ nome: string; itens: Array<{ item: Resultado; indice: number }> }> = [];
  resultados.forEach((item, indice) => {
    const ultimo = grupos.find((g) => g.nome === item.grupo);
    if (ultimo) ultimo.itens.push({ item, indice });
    else grupos.push({ nome: item.grupo, itens: [{ item, indice }] });
  });

  return (
    <div className={styles.veu} onMouseDown={onFechar} role="presentation">
      <div
        className={`${styles.caixa} chamfer`}
        role="dialog"
        aria-modal="true"
        aria-label="Ir para"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.campoLinha}>
          <Search size={18} />
          <input
            ref={campoRef}
            className={styles.campo}
            value={termo}
            placeholder="ir para…"
            aria-label="Ir para"
            aria-activedescendant={resultados[selecionado]?.id}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelecionado((i) => (i + 1) % Math.max(resultados.length, 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelecionado((i) => (i - 1 + resultados.length) % Math.max(resultados.length, 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                escolher(selecionado);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onFechar();
              }
            }}
          />
        </div>

        <div className={styles.lista} ref={listaRef} role="listbox" aria-label="Resultados">
          {grupos.map((grupo) => (
            <div key={grupo.nome}>
              <p className={`section-label ${styles.grupoRotulo}`}>{grupo.nome}</p>
              {grupo.itens.map(({ item, indice }) => (
                <button
                  key={item.id}
                  id={item.id}
                  type="button"
                  role="option"
                  aria-selected={indice === selecionado}
                  className={styles.opcao}
                  data-selecionado={indice === selecionado}
                  onMouseEnter={() => setSelecionado(indice)}
                  onClick={() => escolher(indice)}
                >
                  <span className={styles.opcaoIcone}>{item.icone}</span>
                  <span className={styles.opcaoRotulo}>{item.rotulo}</span>
                  {item.detalhe ? <span className={styles.opcaoDetalhe}>{item.detalhe}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
