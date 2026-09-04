import type { ReactElement } from 'react';
import { Menu, MenuItem, MenuSeparator } from '../../components';
import type { ChannelWithState } from '../channels/canais';

export interface ChannelMenuProps {
  canal: ChannelWithState;
  trigger: ReactElement;
  podeGerenciar: boolean;
  onArquivar?: (canal: ChannelWithState) => void;
}

/**
 * Menu contextual de canal.
 *
 * **Arquivar, não excluir**: um canal com histórico não deve sumir por um
 * clique. Ver design/03-menu-e-navegacao.md.
 */
export function ChannelMenu({ canal, trigger, podeGerenciar, onArquivar }: ChannelMenuProps) {
  return (
    <Menu label={`Ações de ${canal.name}`} trigger={trigger}>
      <MenuItem onSelect={() => undefined}>Marcar como lido</MenuItem>
      <MenuItem
        onSelect={() => void navigator.clipboard?.writeText(`${location.origin}/c/${canal.slug}`)}
      >
        Copiar link
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => undefined}>Silenciar</MenuItem>
      {podeGerenciar ? <MenuSeparator /> : <></>}
      {podeGerenciar ? <MenuItem onSelect={() => undefined}>Editar canal</MenuItem> : <></>}
      {podeGerenciar ? (
        <MenuItem onSelect={() => onArquivar?.(canal)}>Arquivar canal</MenuItem>
      ) : (
        <></>
      )}
    </Menu>
  );
}
