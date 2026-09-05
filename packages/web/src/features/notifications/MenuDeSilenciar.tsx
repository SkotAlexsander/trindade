import { IconButton, Menu, MenuItem, MenuSeparator } from '../../components';
import { Sino, SinoCortado } from '../../components/icones';
import type { Alvo } from '../messages/alvo';
import { OPCOES_DE_SILENCIO, useSilenciar } from './useSilenciar';

/**
 * Silenciar o alvo — canal ou conversa: 1 hora, 8 horas, até eu ligar.
 *
 * Três opções e nenhum campo de duração: quem silencia quer parar de ser
 * interrompido agora, não configurar uma política. Ver design/09-notificacoes.md.
 *
 * A regra do prazo mora em `useSilenciar`, compartilhada com o menu do canal.
 */
export function MenuDeSilenciar({ alvo }: { alvo: Alvo }) {
  // O rótulo nomeia o que está sendo calado: "Silenciar canal" numa conversa
  // privada seria dizer a coisa errada em voz alta.
  const oQue = alvo.tipo === 'canal' ? 'canal' : 'conversa';
  const { estaMudo, silenciar, reativar } = useSilenciar(alvo);

  return (
    <Menu
      label={`Silenciar ${oQue}`}
      placement="bottom-end"
      /* O gatilho é o próprio botão, sem `Tooltip` em volta: o `Menu` clona o
         elemento que recebe para pendurar nele o `ref` e os manipuladores, e
         com o tooltip no meio eles parariam no tooltip — o menu simplesmente
         não abria. O `label` do `IconButton` já é o texto acessível. */
      trigger={
        <IconButton
          label={estaMudo ? `${maiuscula(oQue)} silenciado` : `Silenciar ${oQue}`}
          title={estaMudo ? `${maiuscula(oQue)} silenciado` : `Silenciar ${oQue}`}
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
      {OPCOES_DE_SILENCIO.map((opcao) => (
        <MenuItem key={opcao.rotulo} onSelect={() => silenciar(opcao.horas)}>
          {opcao.rotulo}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** "canal" → "Canal". Só para o rótulo do botão. */
function maiuscula(palavra: string): string {
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}
