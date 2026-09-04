import { IconButton, Menu, MenuItem, MenuSeparator, useToast } from '../../components';
import { Sino, SinoCortado } from '../../components/icones';
import { api } from '../../lib/http';
import { useLeitura } from '../messages/leitura';

/**
 * Silenciar o canal: 1 hora, 8 horas, até eu ligar.
 *
 * Três opções e nenhum campo de duração: quem silencia quer parar de ser
 * interrompido agora, não configurar uma política. Ver design/09-notificacoes.md.
 */

const OPCOES: { rotulo: string; horas: number | null }[] = [
  { rotulo: 'Por 1 hora', horas: 1 },
  { rotulo: 'Por 8 horas', horas: 8 },
  { rotulo: 'Até eu ligar', horas: null },
];

export function MenuDeSilenciar({ channelId }: { channelId: string }) {
  const { show } = useToast();
  const leitura = useLeitura((s) => s.porCanal[channelId]);

  // Silêncio vencido é silêncio nenhum: o prazo passa sem ninguém limpar a
  // linha, e o ícone não pode continuar cortado por causa disso.
  const ate = leitura?.mutedUntil ? Date.parse(leitura.mutedUntil) : null;
  const estaMudo = ate !== null && ate > Date.now();

  function silenciar(horas: number | null): void {
    // "Até eu ligar" é um prazo de dez anos e não um `null`: `null` já quer
    // dizer "não silenciado" no estado de leitura, e usar o mesmo valor para
    // as duas coisas apagaria a diferença entre calado para sempre e nunca
    // calado.
    const until =
      horas === null
        ? new Date(Date.now() + 10 * 365 * 86_400_000).toISOString()
        : new Date(Date.now() + horas * 3_600_000).toISOString();

    // O estado volta pelo `READ_STATE_UPDATE`, como em qualquer outra aba
    // sua: não há o que atualizar aqui à mão.
    void api(`/channels/${channelId}/mute`, { method: 'PUT', body: { until } }).catch(() =>
      show('Não foi possível silenciar o canal.', 'danger'),
    );
  }

  function reativar(): void {
    void api(`/channels/${channelId}/mute`, { method: 'DELETE' }).catch(() =>
      show('Não foi possível reativar o canal.', 'danger'),
    );
  }

  return (
    <Menu
      label="Silenciar canal"
      placement="bottom-end"
      /* O gatilho é o próprio botão, sem `Tooltip` em volta: o `Menu` clona o
         elemento que recebe para pendurar nele o `ref` e os manipuladores, e
         com o tooltip no meio eles parariam no tooltip — o menu simplesmente
         não abria. O `label` do `IconButton` já é o texto acessível. */
      trigger={
        <IconButton
          label={estaMudo ? 'Canal silenciado' : 'Silenciar canal'}
          title={estaMudo ? 'Canal silenciado' : 'Silenciar canal'}
          size="sm"
        >
          {estaMudo ? <SinoCortado size={16} /> : <Sino size={16} />}
        </IconButton>
      }
    >
      {estaMudo ? (
        <>
          <MenuItem icon={<Sino size={16} />} onSelect={reativar}>
            Reativar avisos
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {OPCOES.map((opcao) => (
        <MenuItem key={opcao.rotulo} onSelect={() => silenciar(opcao.horas)}>
          {opcao.rotulo}
        </MenuItem>
      ))}
    </Menu>
  );
}
