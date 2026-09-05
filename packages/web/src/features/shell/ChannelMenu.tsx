import type { ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem, MenuSeparator, useToast } from '../../components';
import { Sino } from '../../components/icones';
import { api } from '../../lib/http';
import { canal as alvoDoCanal } from '../messages/alvo';
import { useLeitura } from '../messages/leitura';
import { OPCOES_DE_SILENCIO, useSilenciar } from '../notifications/useSilenciar';
import { useDialogoDeCanal } from '../channels/DialogoDeCanal';
import type { ChannelWithState } from '../channels/canais';

export interface ChannelMenuProps {
  canal: ChannelWithState;
  trigger: ReactElement;
  podeGerenciar: boolean;
}

/**
 * Menu contextual de canal.
 *
 * **Arquivar, não excluir**: um canal com histórico não deve sumir por um
 * clique. Ver design/03-menu-e-navegacao.md.
 *
 * Quatro destes itens não faziam nada até 5 de setembro de 2026: três eram
 * `onSelect={() => undefined}` e o quarto chamava uma prop opcional que
 * nenhum chamador passava. Marcar como lido, silenciar, editar e arquivar
 * existiam no servidor desde as fases 4 e 9; o menu só nunca os chamou — e
 * não os chamava porque **o menu inteiro nunca era montado**.
 */
export function ChannelMenu({ canal, trigger, podeGerenciar }: ChannelMenuProps) {
  const { show } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const zerar = useLeitura((s) => s.zerar);
  const editar = useDialogoDeCanal((s) => s.editar);
  const { estaMudo, silenciar, reativar } = useSilenciar(alvoDoCanal(canal.id));

  /* Arquivar era um `onArquivar?.(canal)` com prop opcional que ninguém
     passava — mais um item que não fazia nada. A ação mora aqui porque toda
     tela que mostrar este menu vai querer exatamente esta, e uma prop que todo
     mundo implementaria igual é só um jeito de alguém esquecer. */
  async function arquivar(): Promise<void> {
    try {
      await api(`/channels/${canal.id}/archive`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['channels'] });
      // Sair do canal arquivado: continuar dentro de um canal que sumiu da
      // coluna é um beco sem saída visível.
      if (location.pathname === `/c/${canal.slug}`) navigate('/');
      show(`#${canal.slug} foi arquivado. O histórico fica.`);
    } catch {
      show('Não consegui arquivar o canal.', 'danger');
    }
  }

  function marcarComoLido(): void {
    /* Sem corpo: o servidor resolve "até a última que existe agora". Daqui não
       há id de mensagem nenhuma — este menu abre de fora do canal. */
    zerar(canal.id, null);
    void api(`/channels/${canal.id}/read`, { method: 'PUT', body: {} }).catch(() =>
      show('Não consegui marcar como lido.', 'danger'),
    );
  }

  return (
    <Menu label={`Ações de ${canal.name}`} trigger={trigger}>
      <MenuItem onSelect={marcarComoLido}>Marcar como lido</MenuItem>
      <MenuItem
        onSelect={() => void navigator.clipboard?.writeText(`${location.origin}/c/${canal.slug}`)}
      >
        Copiar link
      </MenuItem>
      <MenuSeparator />

      {/* Os prazos abrem aqui mesmo, e não num submenu: submenu para três itens
          é uma gaveta a mais para chegar no mesmo lugar. */}
      {estaMudo ? (
        <MenuItem icon={<Sino size={16} />} onSelect={reativar}>
          Reativar avisos
        </MenuItem>
      ) : (
        OPCOES_DE_SILENCIO.map((opcao) => (
          <MenuItem key={opcao.rotulo} onSelect={() => silenciar(opcao.horas)}>
            {`Silenciar ${opcao.rotulo.toLowerCase()}`}
          </MenuItem>
        ))
      )}

      {podeGerenciar ? <MenuSeparator /> : <></>}
      {podeGerenciar ? <MenuItem onSelect={() => editar(canal)}>Editar canal</MenuItem> : <></>}
      {podeGerenciar ? (
        <MenuItem onSelect={() => void arquivar()}>Arquivar canal</MenuItem>
      ) : (
        <></>
      )}
    </Menu>
  );
}
