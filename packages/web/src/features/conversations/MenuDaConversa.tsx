import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation, User } from '@trindade/shared';
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  useToast,
} from '../../components';
import { useAuth } from '../auth/store';
import {
  useCriarGrupo,
  useEsconderConversa,
  useRenomearConversa,
  useSairDaConversa,
} from './queries';
import styles from './conversas.module.css';

/**
 * O "⋯" do cabeçalho de uma conversa.
 *
 * Adicionar pessoa a partir de uma direta **cria um grupo novo**; a direta
 * original permanece intacta. É o que o modelo permite dizer com honestidade:
 * a conversa entre duas pessoas continua sendo entre duas pessoas, e o que
 * nasce é outra coisa. Ver design/10-conversas-privadas.md.
 */
export function MenuDaConversa({
  conversa,
  pessoas,
}: {
  conversa: Conversation;
  pessoas: readonly User[];
}) {
  const navigate = useNavigate();
  const { show } = useToast();
  const meuId = useAuth((s) => s.user?.id) ?? '';

  const criarGrupo = useCriarGrupo();
  const renomear = useRenomearConversa();
  const sair = useSairDaConversa();
  const esconder = useEsconderConversa();

  const [adicionando, setAdicionando] = useState(false);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [nome, setNome] = useState('');

  // As pessoas que ainda não estão aqui. Com cinco no total, são no máximo
  // três — por isso caixas de marcação e não um campo de busca.
  const disponiveis = pessoas.filter((p) => p.id !== meuId && !conversa.members.includes(p.id));

  function confirmar(): void {
    const escolhidos = [...marcados];
    if (escolhidos.length === 0) return;

    criarGrupo.mutate(
      {
        userIds: [...conversa.members.filter((id) => id !== meuId), ...escolhidos],
        name: nome.trim() || null,
      },
      {
        onSuccess: ({ conversation }) => {
          setAdicionando(false);
          setMarcados(new Set());
          setNome('');
          navigate(`/d/${conversation.id}`);
        },
        onError: () => show('Não foi possível criar o grupo.', 'danger'),
      },
    );
  }

  return (
    <>
      <Menu
        label="Mais"
        placement="bottom-end"
        trigger={
          <IconButton label="Mais ações da conversa" title="Mais ações" size="sm">
            <span aria-hidden="true">···</span>
          </IconButton>
        }
      >
        {disponiveis.length > 0 ? (
          <MenuItem onSelect={() => setAdicionando(true)}>
            {conversa.kind === 'direct' ? 'Adicionar pessoa' : 'Criar grupo com mais gente'}
          </MenuItem>
        ) : null}

        {conversa.kind === 'group' ? (
          <MenuItem
            onSelect={() => {
              const novo = prompt('Nome do grupo', conversa.name ?? '');
              if (novo === null) return;
              renomear.mutate({ id: conversa.id, name: novo.trim() || null });
            }}
          >
            Renomear
          </MenuItem>
        ) : null}

        <MenuSeparator />

        {/* Esconder não apaga: a conversa volta na próxima mensagem, e é por
            isso que não existe "apagar conversa". */}
        <MenuItem onSelect={() => esconder.mutate({ id: conversa.id, escondida: true })}>
          Esconder da lista
        </MenuItem>

        {conversa.kind === 'group' ? (
          <MenuItem
            onSelect={() => {
              if (!confirm('Sair da conversa? O histórico continua para os outros.')) return;
              sair.mutate(conversa.id, { onSuccess: () => navigate('/') });
            }}
          >
            Sair da conversa
          </MenuItem>
        ) : null}
      </Menu>

      <Dialog
        open={adicionando}
        onOpenChange={setAdicionando}
        title="Adicionar pessoa"
        description="Nasce um grupo novo. A conversa de vocês dois continua onde está."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdicionando(false)}>
              Cancelar
            </Button>
            <Button disabled={marcados.size === 0 || criarGrupo.isPending} onClick={confirmar}>
              Criar grupo
            </Button>
          </>
        }
      >
        <div className={styles.escolha}>
          {disponiveis.map((p) => (
            <label key={p.id} className={styles.pessoa}>
              <input
                type="checkbox"
                checked={marcados.has(p.id)}
                onChange={(e) =>
                  setMarcados((atual) => {
                    const proximo = new Set(atual);
                    if (e.target.checked) proximo.add(p.id);
                    else proximo.delete(p.id);
                    return proximo;
                  })
                }
              />
              {p.displayName}
            </label>
          ))}

          <label className={styles.pessoa}>
            Nome do grupo
            <input
              type="text"
              value={nome}
              maxLength={48}
              placeholder="opcional"
              onChange={(e) => setNome(e.target.value)}
            />
          </label>
        </div>
      </Dialog>
    </>
  );
}
