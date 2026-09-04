import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role, User } from '@trindade/shared';
import { Button, Dialog, Spinner, Toggle, useToast } from '../../components';
import { HttpError, api } from '../../lib/http';
import styles from './pessoas.module.css';

/**
 * Os cargos de uma pessoa.
 *
 * Substitui o conjunto inteiro numa chamada — é assim que a rota funciona, e
 * mandar um cargo por vez deixaria a pessoa passar por estados intermediários
 * em que ela tem menos poder do que deveria por um instante.
 */
export function DialogoDeCargos({
  pessoa,
  meuAlcance,
  onFechar,
}: {
  pessoa: User;
  meuAlcance: number;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [escolhidos, setEscolhidos] = useState<string[]>(pessoa.roles.map((r) => r.id));

  const { data: cargos, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api<{ roles: Role[] }>('/roles')).roles,
  });

  const salvar = useMutation({
    mutationFn: () =>
      api(`/users/${pessoa.id}/roles`, { method: 'PATCH', body: { roleIds: escolhidos } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onFechar();
    },
    onError: (err) =>
      show(
        err instanceof HttpError ? err.message : 'Não consegui salvar os cargos.',
        'danger',
      ),
  });

  const ordenados = [...(cargos ?? [])].sort((a, b) => b.position - a.position);

  return (
    <Dialog
      open
      onOpenChange={(proximo) => {
        if (!proximo) onFechar();
      }}
      title={`Cargos de ${pessoa.displayName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : (
        <div className={styles.listaDeCargos}>
          {ordenados.map((cargo) => {
            // Cargo no seu nível ou acima não se concede nem se tira: o
            // servidor devolve HIERARCHY_VIOLATION, e um interruptor que
            // sempre falha é pior do que um travado com o motivo escrito.
            const foraDoAlcance = cargo.position >= meuAlcance;
            return (
              <Toggle
                key={cargo.id}
                label={cargo.name}
                checked={escolhidos.includes(cargo.id)}
                disabled={foraDoAlcance}
                hint={foraDoAlcance ? 'Está no seu nível ou acima.' : ''}
                onChange={(liga) =>
                  setEscolhidos((atuais) =>
                    liga ? [...atuais, cargo.id] : atuais.filter((id) => id !== cargo.id),
                  )
                }
              />
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
