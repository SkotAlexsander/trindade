import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Perm, can } from '@trindade/shared';
import { Menu, MenuItem, MenuSeparator } from '../../components';
import { api } from '../../lib/http';
import { useAuth } from '../auth/store';

export interface ServerMenuProps {
  trigger: ReactElement;
  podeGerenciarCanal: boolean;
}

/**
 * Itens sem permissão **não aparecem**.
 *
 * Não os mostre desabilitados: um item cinza informa a hierarquia a quem não
 * precisa saber dela. Ver design/03-menu-e-navegacao.md.
 */
export function ServerMenu({ trigger, podeGerenciarCanal }: ServerMenuProps) {
  const navigate = useNavigate();
  const permissoes = useAuth((state) => state.permissions);
  const limpar = useAuth((state) => state.clear);

  const podeConvidar = can(permissoes, Perm.CREATE_INVITE);
  const podeCargos = can(permissoes, Perm.MANAGE_ROLES);
  const podeMembros = can(permissoes, Perm.MANAGE_MEMBERS);

  async function sair(): Promise<void> {
    await api<void>('/auth/logout', { method: 'POST', auth: false }).catch(() => undefined);
    limpar();
    navigate('/entrar', { replace: true });
  }

  return (
    <Menu label="Menu do servidor" trigger={trigger}>
      {podeConvidar ? <MenuItem onSelect={() => navigate('/config/convites')}>Convidar alguém</MenuItem> : <></>}
      {podeGerenciarCanal ? <MenuItem onSelect={() => undefined}>Criar canal</MenuItem> : <></>}
      {podeConvidar || podeGerenciarCanal ? <MenuSeparator /> : <></>}

      {podeCargos ? <MenuItem onSelect={() => navigate('/config/cargos')}>Cargos e permissões</MenuItem> : <></>}
      {podeMembros ? <MenuItem onSelect={() => navigate('/config/pessoas')}>Pessoas</MenuItem> : <></>}
      {podeCargos || podeMembros ? <MenuSeparator /> : <></>}

      <MenuItem onSelect={() => navigate('/config/aparencia')}>Aparência</MenuItem>
      <MenuItem onSelect={() => navigate('/config/atalhos')}>Atalhos</MenuItem>
      <MenuSeparator />
      <MenuItem danger onSelect={() => void sair()}>
        Sair
      </MenuItem>
    </Menu>
  );
}
