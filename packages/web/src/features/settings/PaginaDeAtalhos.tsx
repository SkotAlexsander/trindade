import { useEffect, useState } from 'react';
import styles from './ajustes.module.css';

/**
 * Atalhos.
 *
 * A lista é do que **existe**, não do que `design/02-shell-principal.md`
 * imaginou: uma página que promete `Alt ⇧ ↑` e não faz nada quando a pessoa
 * aperta é pior que página nenhuma — ela ensina a não confiar na lista inteira.
 * Cada linha daqui foi conferida contra o `useHotkeys` do `AppShell`, o
 * `Composer` e a `MessageList`.
 */

interface Atalho {
  teclas: string[];
  o: string;
}

interface Grupo {
  titulo: string;
  dica?: string;
  atalhos: Atalho[];
}

/** `Ctrl` no Windows e Linux, `⌘` no mac — a mesma tecla para quem usa. */
function ehMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

function grupos(mod: string): Grupo[] {
  return [
    {
      titulo: 'Navegação',
      atalhos: [
        { teclas: [mod, 'K'], o: 'Paleta de comandos' },
        { teclas: ['Alt', '↑'], o: 'Canal anterior' },
        { teclas: ['Alt', '↓'], o: 'Próximo canal' },
        { teclas: ['Alt', '⇧', 'C'], o: 'Ir para a chamada em andamento' },
      ],
    },
    {
      titulo: 'Conversa e painéis',
      atalhos: [
        { teclas: [mod, 'F'], o: 'Buscar neste canal' },
        { teclas: [mod, 'P'], o: 'Fixadas deste canal' },
        { teclas: [mod, '⇧', 'B'], o: 'Suas guardadas, de todas as conversas' },
        { teclas: [mod, 'U'], o: 'Mostrar e esconder o elenco' },
        { teclas: ['Esc'], o: 'Fechar o que estiver aberto, um passo por vez' },
      ],
    },
    {
      titulo: 'Escrevendo',
      dica: 'Valem com o foco no compositor.',
      atalhos: [
        { teclas: ['Enter'], o: 'Enviar' },
        { teclas: ['⇧', 'Enter'], o: 'Quebrar linha' },
        { teclas: ['↑'], o: 'Editar sua última mensagem, com o campo vazio' },
        { teclas: ['Esc'], o: 'Cancelar a edição ou a resposta' },
        { teclas: ['⇧', 'Tab'], o: 'Entrar na lista de mensagens' },
      ],
    },
    {
      titulo: 'Na lista de mensagens',
      dica: 'Depois de entrar nela com ⇧ Tab.',
      atalhos: [
        { teclas: ['↑', '↓'], o: 'Mover entre as mensagens' },
        { teclas: ['Delete'], o: 'Apagar a mensagem em foco, se for sua' },
        { teclas: ['Esc'], o: 'Voltar ao compositor' },
      ],
    },
    {
      titulo: 'Voz e tela',
      dica: 'Estes valem mesmo enquanto você digita — calar o microfone no meio de uma frase é exatamente quando se precisa deles.',
      atalhos: [
        { teclas: [mod, '⇧', 'M'], o: 'Microfone' },
        { teclas: [mod, '⇧', 'A'], o: 'Ensurdecer — cala todo mundo, inclusive você' },
        { teclas: [mod, '⇧', 'V'], o: 'Câmera' },
        { teclas: [mod, '⇧', 'E'], o: 'Compartilhar tela' },
        { teclas: [mod, '⇧', 'D'], o: 'Sair da chamada' },
      ],
    },
    {
      titulo: 'Vendo uma imagem',
      atalhos: [
        { teclas: ['←', '→'], o: 'Imagem anterior e próxima' },
        { teclas: ['Esc'], o: 'Fechar' },
      ],
    },
  ];
}

export function PaginaDeAtalhos() {
  // O `navigator` só existe no navegador, e o estado evita divergência entre a
  // primeira pintura e a seguinte.
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => setMod(ehMac() ? '⌘' : 'Ctrl'), []);

  return (
    <div className={styles.secoes}>
      {grupos(mod).map((grupo) => (
        <section key={grupo.titulo} className={styles.secao}>
          <h2 className={styles.secaoTitulo}>{grupo.titulo}</h2>
          {grupo.dica ? <p className={styles.secaoDica}>{grupo.dica}</p> : null}
          <ul className={styles.atalhos}>
            {grupo.atalhos.map((atalho) => (
              <li key={`${grupo.titulo}-${atalho.o}`} className={styles.atalho}>
                <span className={styles.teclas}>
                  {atalho.teclas.map((tecla) => (
                    <kbd key={tecla} className={styles.tecla}>
                      {tecla}
                    </kbd>
                  ))}
                </span>
                <span className={styles.atalhoTexto}>{atalho.o}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
