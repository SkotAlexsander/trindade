import { Toggle } from '../../components';
import type { DescricaoDePermissao } from './permissoes';

/**
 * Uma linha de permissão.
 *
 * `bloqueada` existe porque o servidor recusa dar a um cargo permissão que
 * quem edita não tem — mostrar o interruptor como se desse seria mentir e
 * render um erro no salvamento automático, que ninguém está olhando.
 */
export function Permissao({
  item,
  ligada,
  bloqueada,
  grave,
  onAlternar,
}: {
  item: DescricaoDePermissao;
  ligada: boolean;
  bloqueada: boolean;
  grave?: boolean;
  onAlternar: (ligar: boolean) => void;
}) {
  return (
    <Toggle
      checked={ligada}
      disabled={bloqueada}
      grave={grave ?? false}
      label={item.rotulo}
      hint={bloqueada ? 'Você não tem esta permissão para poder concedê-la.' : (item.detalhe ?? '')}
      onChange={onAlternar}
    />
  );
}
