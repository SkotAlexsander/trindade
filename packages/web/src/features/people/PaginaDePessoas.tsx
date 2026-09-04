import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Perm, type Role, type User } from '@trindade/shared';
import { Avatar, Button, Menu, MenuItem, Spinner, useToast } from '../../components';
import { ChevronDown, Plus } from '../../components/icones';
import { api } from '../../lib/http';
import { useAuth } from '../auth/store';
import { ChipDeCargo } from '../profile/CartaoDePerfil';
import { usePresenca } from '../realtime/store';
import { DialogoDeCargos } from './DialogoDeCargos';
import { DialogoDeDesativar } from './DialogoDeDesativar';
import { useDialogoDeConvite } from './useDialogoDeConvite';
import styles from './pessoas.module.css';

/**
 * Pessoas.
 *
 * Lista simples: são cinco. Sem busca, sem filtro, sem paginação — cinco
 * linhas cabem na tela, e cada um desses controles seria um lugar a mais para
 * errar sem resolver problema nenhum. Ver design/05-perfil-e-cargos.md.
 */

/** A posição do maior cargo — a régua da hierarquia, igual à do servidor. */
function alcance(roles: readonly Role[], permissoes: bigint): number {
  if ((permissoes & Perm.ADMINISTRATOR) !== 0n) return Number.POSITIVE_INFINITY;
  return roles.reduce((maior, r) => Math.max(maior, r.position), -1);
}

export function PaginaDePessoas() {
  const qc = useQueryClient();
  const { show } = useToast();
  const eu = useAuth((s) => s.user);
  const minhasPermissoes = useAuth((s) => s.permissions);
  const meusCargos = useAuth((s) => s.roles);

  const [aGerenciar, setAGerenciar] = useState<User | null>(null);
  const [aDesativar, setADesativar] = useState<User | null>(null);
  const abrirConvite = useDialogoDeConvite((s) => s.abrir);
  const [verDesativadas, setVerDesativadas] = useState(false);

  const { data: pessoas, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api<{ users: User[] }>('/users')).users,
  });

  const meuAlcance = useMemo(
    () => alcance(meusCargos, minhasPermissoes),
    [meusCargos, minhasPermissoes],
  );

  const podeCargos = (minhasPermissoes & (Perm.MANAGE_ROLES | Perm.ADMINISTRATOR)) !== 0n;
  const podeMembros = (minhasPermissoes & (Perm.MANAGE_MEMBERS | Perm.ADMINISTRATOR)) !== 0n;
  const podeConvidar = (minhasPermissoes & (Perm.CREATE_INVITE | Perm.ADMINISTRATOR)) !== 0n;

  const reativar = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/enable`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError: () => show('Não consegui reativar essa pessoa.', 'danger'),
  });

  if (isLoading) {
    return (
      <div className={styles.carregando}>
        <Spinner />
      </div>
    );
  }

  const ativas = (pessoas ?? []).filter((p) => !p.disabled);
  const desativadas = (pessoas ?? []).filter((p) => p.disabled);

  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <p className={styles.contagem}>
          {ativas.length === 1 ? '1 pessoa' : `${ativas.length} pessoas`}
        </p>
        {podeConvidar ? (
          <Button variant="secondary" size="sm" onClick={abrirConvite}>
            <Plus size={16} /> Convidar
          </Button>
        ) : null}
      </header>

      <ul className={styles.lista}>
        {ativas.map((pessoa) => (
          <Linha
            key={pessoa.id}
            pessoa={pessoa}
            souEu={pessoa.id === eu?.id}
            // As três condições do servidor, repetidas aqui só para não
            // oferecer o que vai dar 403: **ter a permissão**, **alcançar a
            // pessoa** e **não ser você**. Quem não passa nas três não vê o
            // item — escondido, nunca desabilitado.
            //
            // A própria conta fica de fora das duas ações pelo mesmo motivo
            // que no servidor: o alcance sobre si mesmo é sempre empate, e
            // mexer nos próprios cargos por esta porta nunca é o que a pessoa
            // quis. Para editar o próprio perfil existe o diálogo.
            podeCargos={
              podeCargos && pessoa.id !== eu?.id && alcance(pessoa.roles, 0n) < meuAlcance
            }
            podeDesativar={
              podeMembros && pessoa.id !== eu?.id && alcance(pessoa.roles, 0n) < meuAlcance
            }
            onCargos={() => setAGerenciar(pessoa)}
            onDesativar={() => setADesativar(pessoa)}
          />
        ))}
      </ul>

      {desativadas.length > 0 ? (
        <section className={styles.desativadas}>
          <button
            type="button"
            className={styles.dobrar}
            aria-expanded={verDesativadas}
            onClick={() => setVerDesativadas((v) => !v)}
          >
            <ChevronDown size={16} className={verDesativadas ? styles.giradoAberto : styles.girado} />
            Desativadas ({desativadas.length})
          </button>

          {verDesativadas ? (
            <ul className={styles.lista}>
              {desativadas.map((pessoa) => (
                <li key={pessoa.id} className={styles.linha} data-desativada="true">
                  <Avatar id={pessoa.id} name={pessoa.displayName} src={pessoa.avatarUrl} size="sm" />
                  <span className={styles.nome}>{pessoa.displayName}</span>
                  <span className={styles.usuario}>@{pessoa.username}</span>
                  <span className={styles.espacador} />
                  {podeMembros ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => reativar.mutate(pessoa.id)}
                    >
                      Reativar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {aGerenciar ? (
        <DialogoDeCargos
          pessoa={aGerenciar}
          meuAlcance={meuAlcance}
          onFechar={() => setAGerenciar(null)}
        />
      ) : null}

      {aDesativar ? (
        <DialogoDeDesativar pessoa={aDesativar} onFechar={() => setADesativar(null)} />
      ) : null}

    </div>
  );
}

function Linha({
  pessoa,
  souEu,
  podeCargos,
  podeDesativar,
  onCargos,
  onDesativar,
}: {
  pessoa: User;
  souEu: boolean;
  podeCargos: boolean;
  podeDesativar: boolean;
  onCargos: () => void;
  onDesativar: () => void;
}) {
  // A presença vem do gateway: o `status` do cache é do momento em que a lista
  // foi buscada, e esta tela fica aberta.
  const presenca = usePresenca((s) => s.porUsuario[pessoa.id]);
  const status = presenca?.status ?? pessoa.status;
  const cargos = [...pessoa.roles].sort((a, b) => b.position - a.position);
  const temMenu = podeCargos || podeDesativar;

  return (
    <li className={styles.linha}>
      <Avatar
        id={pessoa.id}
        name={pessoa.displayName}
        src={pessoa.avatarUrl}
        size="sm"
        status={status}
      />
      <span className={styles.nome}>
        {pessoa.displayName}
        {souEu ? <span className={styles.voce}>você</span> : null}
      </span>
      <span className={styles.usuario}>@{pessoa.username}</span>

      <span className={styles.cargos}>
        {cargos.map((cargo) => (
          <ChipDeCargo key={cargo.id} cargo={cargo} />
        ))}
      </span>

      <span className={styles.espacador} />

      {/* Sem item nenhum, sem menu: um `⋯` que abre vazio é pior do que a
          ausência dele. */}
      {temMenu ? (
        <Menu
          label={`Ações para ${pessoa.displayName}`}
          placement="bottom-end"
          trigger={
            <button type="button" className={styles.maisAcoes} aria-label={`Ações para ${pessoa.displayName}`}>
              ⋯
            </button>
          }
        >
          {podeCargos ? <MenuItem onSelect={onCargos}>Gerenciar cargos</MenuItem> : <></>}
          {podeDesativar ? (
            <MenuItem danger onSelect={onDesativar}>
              Desativar conta
            </MenuItem>
          ) : (
            <></>
          )}
        </Menu>
      ) : null}
    </li>
  );
}
