import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Perm, type Role, type User } from '@trindade/shared';
import { Button, Input, Spinner, useToast } from '../../components';
import { Plus, Trash } from '../../components/icones';
import { api } from '../../lib/http';
import { ensureContrast, sobrepor } from '../../lib/contraste';
import { lerToken } from '../../lib/tokens';
import { useAuth } from '../auth/store';
import { AVISO_DE_ADMINISTRADOR, GRUPOS, alternarBit, temBit } from './permissoes';
import { Permissao } from './Permissao';
import styles from './cargos.module.css';

/**
 * Cargos e permissões.
 *
 * Página, não diálogo: a lista da esquerda **é** a hierarquia, e mostrar isso
 * visualmente evita ter que explicar o conceito. Ver
 * design/05-perfil-e-cargos.md.
 *
 * O servidor recusa tudo o que esta tela esconde. As duas coisas, sempre: a
 * daqui para não oferecer o que vai dar erro, a de lá porque é ela que vale.
 */

/** O tempo do salvamento automático. Botão Salvar convida a esquecer de clicar. */
const ESPERA_MS = 800;
const SALVO_VISIVEL_MS = 2000;

const CORES = ['#22d3ee', '#4c8df6', '#a855f7', '#ec4899', '#f97316', '#22c55e'] as const;

export function PaginaDeCargos() {
  const qc = useQueryClient();
  const { show } = useToast();
  const minhasPermissoes = useAuth((s) => s.permissions);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const { data: cargos, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api<{ roles: Role[] }>('/roles')).roles,
  });
  const { data: pessoas } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: User[] }>('/users')).users,
  });

  /**
   * O seu alcance: a posição do seu maior cargo.
   *
   * Administrador não tem teto — é o único lugar do produto onde a hierarquia
   * não se aplica, e está dito assim no servidor também.
   */
  const meuAlcance = useMemo(() => {
    if ((minhasPermissoes & Perm.ADMINISTRATOR) !== 0n) return Number.POSITIVE_INFINITY;
    const meus = useAuth.getState().roles;
    return meus.reduce((maior, r) => Math.max(maior, r.position), -1);
  }, [minhasPermissoes]);

  const ordenados = useMemo(
    () => [...(cargos ?? [])].sort((a, b) => b.position - a.position),
    [cargos],
  );

  useEffect(() => {
    if (selecionado || ordenados.length === 0) return;
    // Abre no primeiro que dá para editar, não no primeiro da lista: abrir num
    // cargo esmaecido mostraria um painel inteiro que não responde.
    const primeiro = ordenados.find((r) => r.position < meuAlcance);
    if (primeiro) setSelecionado(primeiro.id);
  }, [ordenados, selecionado, meuAlcance]);

  const criar = useMutation({
    mutationFn: async () => (await api<{ role: Role }>('/roles', {
      method: 'POST',
      body: { name: 'Cargo novo' },
    })).role,
    onSuccess: (novo) => {
      qc.setQueryData<Role[]>(['roles'], (atuais) => [...(atuais ?? []), novo]);
      setSelecionado(novo.id);
    },
    onError: () => show('Não consegui criar o cargo.', 'danger'),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => {
      qc.setQueryData<Role[]>(['roles'], (atuais) => atuais?.filter((r) => r.id !== id));
      setSelecionado(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => show('Não consegui apagar o cargo.', 'danger'),
  });

  const reordenar = useMutation({
    mutationFn: async (roleIds: string[]) =>
      (await api<{ roles: Role[] }>('/roles/order', { method: 'PUT', body: { roleIds } })).roles,
    onSuccess: (novos) => qc.setQueryData<Role[]>(['roles'], novos),
    onError: () => {
      show('Não consegui reordenar — algum cargo está no seu nível ou acima.', 'danger');
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  function soltarSobre(alvoId: string): void {
    if (!arrastando || arrastando === alvoId) return;
    const ids = ordenados.map((r) => r.id);
    const de = ids.indexOf(arrastando);
    const para = ids.indexOf(alvoId);
    if (de < 0 || para < 0) return;
    ids.splice(para, 0, ...ids.splice(de, 1));
    setArrastando(null);
    reordenar.mutate(ids);
  }

  const cargo = ordenados.find((r) => r.id === selecionado) ?? null;
  const posso = cargo ? cargo.position < meuAlcance : false;

  if (isLoading) {
    return (
      <div className={styles.carregando}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      <aside className={styles.lista} aria-label="Cargos">
        <p className="section-label">Cargos</p>
        <p className={styles.dicaDaLista}>De cima para baixo: quem manda em quem.</p>

        <ul className={styles.itens}>
          {ordenados.map((r) => {
            const acima = r.position >= meuAlcance;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.item}
                  data-ativo={r.id === selecionado}
                  data-acima={acima}
                  data-arrastando={arrastando === r.id}
                  // Cargo acima do seu não abre. Esmaecido, e não escondido:
                  // aqui a hierarquia é o assunto da tela, então ver que existe
                  // algo acima é informação, não vazamento.
                  aria-disabled={acima}
                  draggable={!acima}
                  onDragStart={() => setArrastando(r.id)}
                  onDragEnd={() => setArrastando(null)}
                  onDragOver={(e) => {
                    if (arrastando && !acima) e.preventDefault();
                  }}
                  onDrop={() => soltarSobre(r.id)}
                  onClick={() => {
                    if (!acima) setSelecionado(r.id);
                  }}
                >
                  <span
                    className={styles.ponto}
                    style={{ background: r.color ?? 'var(--text-tertiary)' }}
                    aria-hidden="true"
                  />
                  <span className={styles.nomeDoCargo}>{r.name}</span>
                  <span className={styles.quantos}>
                    {(pessoas ?? []).filter((p) => p.roles.some((x) => x.id === r.id)).length || ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <Button
          variant="ghost"
          size="sm"
          className={styles.criar}
          disabled={criar.isPending}
          onClick={() => criar.mutate()}
        >
          <Plus size={16} /> Criar cargo
        </Button>

        {ordenados.some((r) => r.position >= meuAlcance) ? (
          <p className={styles.avisoDaLista}>Você não pode editar cargos acima do seu.</p>
        ) : null}
      </aside>

      <section className={styles.editor}>
        {cargo && posso ? (
          <EditorDeCargo
            key={cargo.id}
            cargo={cargo}
            pessoas={pessoas ?? []}
            minhasPermissoes={minhasPermissoes}
            onApagar={() => apagar.mutate(cargo.id)}
          />
        ) : (
          <p className={styles.vazio}>Escolha um cargo à esquerda.</p>
        )}
      </section>
    </div>
  );
}

// --- editor ----------------------------------------------------------------

function EditorDeCargo({
  cargo,
  pessoas,
  minhasPermissoes,
  onApagar,
}: {
  cargo: Role;
  pessoas: User[];
  minhasPermissoes: bigint;
  onApagar: () => void;
}) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [nome, setNome] = useState(cargo.name);
  const [cor, setCor] = useState(cargo.color ?? '');
  const [permissoes, setPermissoes] = useState(BigInt(cargo.permissions));
  const [salvo, setSalvo] = useState(false);

  const souAdmin = (minhasPermissoes & Perm.ADMINISTRATOR) !== 0n;
  const comEsteCargo = pessoas.filter((p) => p.roles.some((r) => r.id === cargo.id));

  const salvar = useCallback(async () => {
    const { role } = await api<{ role: Role }>(`/roles/${cargo.id}`, {
      method: 'PATCH',
      body: { name: nome.trim() || 'Sem nome', color: cor || null, permissions: permissoes.toString() },
    });
    qc.setQueryData<Role[]>(['roles'], (atuais) =>
      atuais?.map((r) => (r.id === role.id ? role : r)),
    );
    // O cargo mudou de cor ou de nome: quem o tem aparece diferente em toda a
    // interface, e o cache de pessoas carrega essa cópia.
    void qc.invalidateQueries({ queryKey: ['users'] });
  }, [cargo.id, nome, cor, permissoes, qc]);

  /**
   * Salvamento automático.
   *
   * Formulário de permissão com botão Salvar convida a esquecer de clicar — e
   * esquecer aqui significa achar que deu um poder a alguém sem ter dado.
   */
  // A guarda é comparar com o cargo que veio do servidor, e não um "primeira
  // vez" num ref: no StrictMode o efeito roda, é limpo e roda de novo, e a
  // segunda passagem já encontraria o ref gasto — a tela salvava sozinha ao
  // abrir, acendia "Salvo" sem ninguém ter mexido em nada, e mandava um PATCH
  // por cargo visitado.
  const intocado =
    nome === cargo.name &&
    (cor || null) === cargo.color &&
    permissoes === BigInt(cargo.permissions);

  useEffect(() => {
    if (intocado) return;
    const id = setTimeout(() => {
      void salvar()
        .then(() => {
          setSalvo(true);
          setTimeout(() => setSalvo(false), SALVO_VISIVEL_MS);
        })
        .catch(() => show('Não consegui salvar o cargo.', 'danger'));
    }, ESPERA_MS);
    return () => clearTimeout(id);
  }, [intocado, salvar, show]);

  const superficie = lerToken('--bg-raised', '#101a2e');

  return (
    <div className={styles.form}>
      <header className={styles.cabecalhoDoEditor}>
        <h2 className={styles.titulo}>{nome || 'Sem nome'}</h2>
        <span className={styles.salvo} data-visivel={salvo} aria-live="polite">
          {salvo ? 'Salvo' : ''}
        </span>
        {cargo.name !== 'Membro' ? (
          <Button variant="ghost" size="sm" onClick={onApagar} aria-label="Apagar cargo">
            <Trash size={16} />
          </Button>
        ) : null}
      </header>

      <Input label="Nome" value={nome} maxLength={24} onChange={(e) => setNome(e.target.value)} />

      <div className={styles.campo}>
        <p className={styles.rotulo}>Cor</p>
        <div className={styles.cores}>
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.amostra}
              style={{ background: c }}
              aria-label={`Usar ${c}`}
              aria-pressed={cor === c}
              data-ativa={cor === c}
              onClick={() => setCor(cor === c ? '' : c)}
            />
          ))}
          <input
            className={styles.hex}
            value={cor}
            placeholder="#de5d52"
            aria-label="Cor em hexadecimal"
            maxLength={7}
            onChange={(e) => setCor(e.target.value.toLowerCase())}
          />
        </div>
        {cor ? (
          <p className={styles.previaDaCor}>
            <span
              className={styles.chipPrevia}
              style={{
                background: sobrepor(ensureContrast(cor, superficie), superficie, 0.12),
                color: ensureContrast(cor, superficie),
              }}
            >
              {nome || 'Sem nome'}
            </span>
            {/* A cor escolhida fica intacta no banco; o que muda é só como ela
                é desenhada, e vale mostrar isso antes de salvar. */}
            <span className={styles.notaDaCor}>Clareada quando preciso, para ficar legível.</span>
          </p>
        ) : null}
      </div>

      <div className={styles.separador} />

      <p className="section-label">Permissões</p>

      {GRUPOS.map((grupo) => (
        <fieldset key={grupo.titulo} className={styles.grupo}>
          <legend className={styles.tituloDoGrupo}>{grupo.titulo}</legend>
          {grupo.itens.map((item) => (
            <Permissao
              key={item.nome}
              item={item}
              ligada={temBit(permissoes, item.nome)}
              // Não se dá a um cargo permissão que você não tem: o servidor
              // recusa, e mostrar o interruptor ligável seria mentir.
              bloqueada={!souAdmin && !temBit(minhasPermissoes, item.nome)}
              onAlternar={(liga) => setPermissoes((p) => alternarBit(p, item.nome, liga))}
            />
          ))}
        </fieldset>
      ))}

      <div className={styles.separador} />

      {/* Separado no fim, e com destaque: não é mais uma permissão da lista, é
          a que dispensa a lista inteira. */}
      <div className={styles.administrador} data-ligado={temBit(permissoes, 'ADMINISTRATOR')}>
        <Permissao
          item={{
            nome: 'ADMINISTRATOR',
            rotulo: 'Administrador',
            detalhe: AVISO_DE_ADMINISTRADOR,
          }}
          ligada={temBit(permissoes, 'ADMINISTRATOR')}
          bloqueada={!souAdmin}
          grave
          onAlternar={(liga) => setPermissoes((p) => alternarBit(p, 'ADMINISTRATOR', liga))}
        />
      </div>

      <div className={styles.separador} />

      <p className="section-label">Quem tem este cargo</p>
      {comEsteCargo.length === 0 ? (
        <p className={styles.vazio}>Ninguém, por enquanto.</p>
      ) : (
        <ul className={styles.pessoas}>
          {comEsteCargo.map((p) => (
            <li key={p.id} className={styles.pessoa}>
              {p.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
