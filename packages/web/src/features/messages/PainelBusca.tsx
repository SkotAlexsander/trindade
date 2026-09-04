import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Channel, Message, User } from '@trindade/shared';
import { Avatar, Spinner } from '../../components';
import { Search, X } from '../../components/icones';
import { api } from '../../lib/http';
import { hora, rotuloDoDia } from './linhas';
import { useBusca, useDestaque } from './store';
import styles from './messages.module.css';

/**
 * Busca dentro do canal, no painel direito e não em tela cheia: você quer ver
 * o resultado sem perder a conversa. Ver design/04-mensagens.md.
 */

/** Espera de digitação antes de consultar. */
const ESPERA_MS = 250;

export interface PainelBuscaProps {
  canal: Channel | undefined;
  pessoas: readonly User[];
}

interface Resultado {
  results: Message[];
  total: number;
}

export function PainelBusca({ canal, pessoas }: PainelBuscaProps) {
  const termo = useBusca((s) => s.termo);
  const setTermo = useBusca((s) => s.setTermo);
  const pular = useDestaque((s) => s.pular);
  const campo = useRef<HTMLInputElement>(null);

  const [de, setDe] = useState<string>('');
  const [atrasado, setAtrasado] = useState(termo);

  useEffect(() => {
    campo.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setAtrasado(termo), ESPERA_MS);
    return () => clearTimeout(id);
  }, [termo]);

  const consulta = atrasado.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['busca', canal?.id, consulta, de],
    enabled: Boolean(canal) && consulta.length > 0,
    // Mantém o resultado anterior enquanto o novo vem: sem isto a lista
    // pisca em branco a cada tecla.
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ q: consulta, limit: '25' });
      if (de) params.set('from', de);
      return api<Resultado>(`/channels/${canal?.id}/messages/search?${params.toString()}`);
    },
  });

  return (
    <div className={styles.busca}>
      <div className={styles.buscaCampo}>
        <Search size={16} />
        <input
          ref={campo}
          type="search"
          value={termo}
          placeholder={canal ? `buscar em #${canal.name}` : 'buscar'}
          aria-label="Buscar no canal"
          onChange={(e) => setTermo(e.target.value)}
        />
        {termo ? (
          <button type="button" aria-label="Limpar busca" onClick={() => setTermo('')}>
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className={styles.filtros}>
        <label className={styles.filtro}>
          De:
          <select value={de} onChange={(e) => setDe(e.target.value)} aria-label="Filtrar por autor">
            <option value="">todos</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {consulta.length === 0 ? (
        <p className={styles.painelDica}>Escreva para buscar nas mensagens deste canal.</p>
      ) : isFetching && !data ? (
        <Spinner />
      ) : !data || data.results.length === 0 ? (
        <div className={styles.painelVazio}>
          <p>Nada encontrado para “{consulta}”.</p>
          <p className={styles.painelDica}>Tente menos palavras, ou remova os filtros.</p>
        </div>
      ) : (
        <>
          <p className={styles.buscaTotal}>
            {data.total === 1 ? '1 resultado' : `${data.total} resultados`}
          </p>
          {data.results.map((m) => (
            <button
              key={m.id}
              type="button"
              className={styles.linhaPainel}
              onClick={() => pular(m.id)}
            >
              <span className={styles.linhaMeta}>
                <span>{rotuloDoDia(m.createdAt)}</span>
                <span>{hora(m.createdAt)}</span>
              </span>
              <span className={styles.linhaAutor}>
                <Avatar
                  id={m.author.id}
                  name={m.author.displayName}
                  src={m.author.avatarUrl}
                  size="xs"
                />
                <strong>{m.author.displayName}</strong>
              </span>
              <span className={styles.linhaTexto}>
                <Destacado texto={m.content ?? ''} termo={consulta} />
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Acende os termos procurados dentro do trecho.
 *
 * Comparação sem acento e sem caixa, para casar com o que o Postgres faz: a
 * busca acha "migração" quando se digita "migracao", e o destaque tem de
 * concordar com ela, senão o resultado aparece sem nada aceso.
 */
function Destacado({ texto, termo }: { texto: string; termo: string }) {
  const pedacos = useMemo(() => quebrar(texto, termo), [texto, termo]);
  return (
    <>
      {pedacos.map((p, i) => (
        <Fragment key={i}>
          {p.aceso ? <mark className={styles.aceso}>{p.texto}</mark> : p.texto}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Dobra o texto para comparação **guardando de onde veio cada caractere**.
 *
 * Sem o mapa, os índices não batem: "migração" tem nove caracteres e a versão
 * sem acento tem oito, então uma posição encontrada na dobrada recortaria o
 * pedaço errado do original — o destaque sairia deslocado exatamente nas
 * palavras acentuadas, que são as que mais aparecem.
 */
function dobrar(texto: string): { chato: string; origem: number[] } {
  let chato = '';
  const origem: number[] = [];

  for (let i = 0; i < texto.length; i += 1) {
    const limpo = (texto[i] ?? '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    for (const c of limpo) {
      chato += c;
      origem.push(i);
    }
  }
  return { chato, origem };
}

export function quebrar(
  texto: string,
  termo: string,
): Array<{ texto: string; aceso: boolean }> {
  const palavras = dobrar(termo)
    .chato.split(/\s+/)
    .map((p) => p.replace(/^[-"']+|["']+$/g, ''))
    .filter((p) => p.length > 1);
  if (palavras.length === 0) return [{ texto, aceso: false }];

  const { chato, origem } = dobrar(texto);
  const marcas = new Array<boolean>(texto.length).fill(false);

  for (const palavra of palavras) {
    let de = chato.indexOf(palavra);
    while (de >= 0) {
      for (let i = de; i < de + palavra.length; i += 1) {
        const original = origem[i];
        if (original !== undefined) marcas[original] = true;
      }
      de = chato.indexOf(palavra, de + palavra.length);
    }
  }

  const saida: Array<{ texto: string; aceso: boolean }> = [];
  let atual = '';
  let aceso = marcas[0] ?? false;
  for (let i = 0; i < texto.length; i += 1) {
    const m = marcas[i] ?? false;
    if (m !== aceso) {
      if (atual) saida.push({ texto: atual, aceso });
      atual = '';
      aceso = m;
    }
    atual += texto[i];
  }
  if (atual) saida.push({ texto: atual, aceso });
  return saida;
}
