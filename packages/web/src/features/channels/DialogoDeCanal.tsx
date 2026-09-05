import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import type { Channel } from '@trindade/shared';
import { Button, Dialog, Input, Textarea, useToast } from '../../components';
import { Hash, Volume } from '../../components/icones';
import { HttpError, api } from '../../lib/http';
import styles from './channels.module.css';

/**
 * Criar e editar canal.
 *
 * O servidor sabia fazer isto desde a fase 4 — `POST /channels` e
 * `PATCH /channels/:id` com `MANAGE_CHANNEL` — e a interface prometia em três
 * lugares (o `+` da coluna, o menu do servidor e a paleta de comandos) sem
 * fazer em nenhum. Botão que não faz nada é pior que botão ausente: ensina
 * que a interface mente.
 *
 * Ver design/03-menu-e-navegacao.md.
 */

interface EstadoDoDialogo {
  /** `null` fechado; `{ canal: null }` criando; `{ canal }` editando. */
  aberto: { canal: Channel | null } | null;
  criar: () => void;
  editar: (canal: Channel) => void;
  fechar: () => void;
}

export const useDialogoDeCanal = create<EstadoDoDialogo>((set) => ({
  aberto: null,
  criar: () => set({ aberto: { canal: null } }),
  editar: (canal) => set({ aberto: { canal } }),
  fechar: () => set({ aberto: null }),
}));

/**
 * "Bugs de Produção" → "bugs-de-producao".
 *
 * O acento sai por decomposição: sem o `NFD`, `ç` não é `c` + cedilha e o
 * regex de marcas não tem o que remover — o endereço sairia com o caractere
 * que o servidor recusa.
 */
export function enderecoDe(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function DialogoDeCanal() {
  const aberto = useDialogoDeCanal((s) => s.aberto);
  const fechar = useDialogoDeCanal((s) => s.fechar);
  const canal = aberto?.canal ?? null;
  const editando = canal !== null;

  const qc = useQueryClient();
  const navigate = useNavigate();
  const { show } = useToast();

  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [topico, setTopico] = useState('');
  const [tipo, setTipo] = useState<'text' | 'voice'>('text');
  /* Enquanto ninguém tocou no endereço, ele segue o nome. Depois de tocado,
     para de seguir — senão corrigir o endereço à mão é impossível, porque a
     letra seguinte do nome o reescreve. */
  const [enderecoTocado, setEnderecoTocado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome(canal?.name ?? '');
    setEndereco(canal?.slug ?? '');
    setTopico(canal?.topic ?? '');
    setTipo(canal?.kind ?? 'text');
    setEnderecoTocado(editando);
  }, [aberto, canal, editando]);

  const enderecoFinal = enderecoTocado ? endereco : enderecoDe(nome);

  const salvar = useMutation({
    mutationFn: async () => {
      if (editando) {
        return await api<{ channel: Channel }>(`/channels/${canal.id}`, {
          method: 'PATCH',
          body: { name: nome.trim(), topic: topico.trim() || null },
        });
      }
      return await api<{ channel: Channel }>('/channels', {
        method: 'POST',
        body: {
          name: nome.trim(),
          slug: enderecoFinal,
          kind: tipo,
          topic: topico.trim() || null,
          category: tipo === 'voice' ? 'voz' : 'conversa',
        },
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      fechar();
      // Quem cria um canal quer entrar nele. Quem edita já está dentro.
      if (!editando && r.channel.kind === 'text') navigate(`/c/${r.channel.slug}`);
    },
    onError: (erro: unknown) => {
      // O conflito de endereço tem texto próprio: "não consegui criar" manda a
      // pessoa tentar de novo igual, e ela erraria de novo.
      if (erro instanceof HttpError && erro.code === 'SLUG_TAKEN') {
        show('Já existe um canal com esse endereço.', 'danger');
        return;
      }
      show(editando ? 'Não consegui salvar o canal.' : 'Não consegui criar o canal.', 'danger');
    },
  });

  const nomeVazio = nome.trim().length === 0;
  const enderecoInvalido = !/^[a-z0-9-]{1,32}$/.test(enderecoFinal);

  return (
    <Dialog
      open={aberto !== null}
      onOpenChange={(proximo) => {
        if (!proximo) fechar();
      }}
      title={editando ? `Editar #${canal.slug}` : 'Criar canal'}
      footer={
        <>
          <Button variant="secondary" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            disabled={nomeVazio || enderecoInvalido || salvar.isPending}
            loading={salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {editando ? 'Salvar' : 'Criar canal'}
          </Button>
        </>
      }
    >
      {editando ? null : (
        <fieldset className={styles.tipos}>
          <legend className="section-label">Tipo</legend>
          {(
            [
              { valor: 'text', rotulo: 'Conversa', dica: 'Mensagens, anexos, tópicos.', Icone: Hash },
              { valor: 'voice', rotulo: 'Voz', dica: 'Áudio, vídeo e tela.', Icone: Volume },
            ] as const
          ).map(({ valor, rotulo, dica, Icone }) => (
            <label key={valor} className={styles.tipo} data-escolhido={tipo === valor}>
              <input
                type="radio"
                name="tipo-de-canal"
                value={valor}
                checked={tipo === valor}
                onChange={() => setTipo(valor)}
                className="visually-hidden"
              />
              <Icone size={18} />
              <span className={styles.tipoNome}>{rotulo}</span>
              <span className={styles.tipoDica}>{dica}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Input
        label="Nome"
        value={nome}
        maxLength={32}
        autoFocus
        placeholder={tipo === 'voice' ? 'Sala' : 'Bugs de produção'}
        onChange={(e) => setNome(e.target.value)}
      />

      {editando ? (
        /* O endereço não muda depois de criado: links já enviados apontariam
           para lugar nenhum. Dizer isso é melhor que omitir o campo e deixar
           a pessoa procurando onde se edita. */
        <p className={styles.enderecoFixo}>
          O endereço <code>/c/{canal.slug}</code> não muda — links já enviados
          continuariam apontando para ele.
        </p>
      ) : (
        <Input
          label="Endereço"
          value={enderecoFinal}
          maxLength={32}
          /* A dica mostra o endereço montado, e não um prefixo `/c/` colado no
             campo: o que a pessoa quer conferir é o resultado, não a sintaxe. */
          hint={
            enderecoFinal ? (
              <>
                Vai ficar em <code className={styles.prefixo}>/c/{enderecoFinal}</code>. Segue o
                nome até você mexer.
              </>
            ) : (
              'Minúsculas, números e hífen. Segue o nome até você mexer.'
            )
          }
          error={
            enderecoFinal.length > 0 && enderecoInvalido
              ? 'Use apenas letras minúsculas, números e hífen.'
              : undefined
          }
          onChange={(e) => {
            setEnderecoTocado(true);
            setEndereco(e.target.value);
          }}
        />
      )}

      <Textarea
        label="Tópico (opcional)"
        value={topico}
        maxLength={200}
        rows={2}
        placeholder="O que se decide aqui."
        hint="Aparece no cabeçalho do canal."
        onChange={(e) => setTopico(e.target.value)}
      />
    </Dialog>
  );
}
