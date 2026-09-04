import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@trindade/shared';
import { Button, Dialog, Input, useToast } from '../../components';
import { HttpError, api } from '../../lib/http';
import styles from './pessoas.module.css';

/**
 * Desativar uma conta.
 *
 * Pede o nome digitado — atrito de propósito, num dos poucos lugares em que
 * ele é o desenho certo: a ação derruba a conexão da pessoa na hora e ela
 * descobre sozinha, sem aviso.
 *
 * A confirmação explica a **consequência real**, não a operação. "Tem
 * certeza?" não informa nada; dizer que as mensagens continuam no histórico e
 * que dá para reativar responde às duas perguntas que quem clica realmente
 * tem. Ver design/05-perfil-e-cargos.md.
 */
export function DialogoDeDesativar({
  pessoa,
  onFechar,
}: {
  pessoa: User;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { show } = useToast();
  const [digitado, setDigitado] = useState('');

  const desativar = useMutation({
    mutationFn: () => api(`/users/${pessoa.id}/disable`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      show(`${pessoa.displayName} foi desativado.`, 'info');
      onFechar();
    },
    onError: (err) =>
      show(err instanceof HttpError ? err.message : 'Não consegui desativar.', 'danger'),
  });

  const confere = digitado.trim() === pessoa.displayName;

  return (
    <Dialog
      open
      onOpenChange={(proximo) => {
        if (!proximo) onFechar();
      }}
      title={`Desativar ${pessoa.displayName}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={!confere || desativar.isPending}
            onClick={() => desativar.mutate()}
          >
            Desativar conta
          </Button>
        </>
      }
    >
      <p className={styles.consequencia}>
        {pessoa.displayName} perde o acesso imediatamente — a conexão aberta cai junto. As
        mensagens continuam no histórico, com o nome de sempre. Você pode reativar depois.
      </p>

      <Input
        label={`Digite ${pessoa.displayName} para confirmar`}
        value={digitado}
        autoComplete="off"
        onChange={(e) => setDigitado(e.target.value)}
      />
    </Dialog>
  );
}
