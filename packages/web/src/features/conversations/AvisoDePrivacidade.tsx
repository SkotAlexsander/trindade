import { useState } from 'react';
import { IconButton } from '../../components';
import { X } from '../../components/icones';
import styles from './conversas.module.css';

/**
 * A promessa, uma vez só.
 *
 * O pacote trazia "Nem quem administra o servidor tem acesso", e a frase era
 * **falsa**: não há criptografia ponta a ponta, e quem administra o servidor é
 * exatamente quem tem acesso ao banco. Dizer isso a alguém que confia na frase
 * é pior que não dizer nada — design/10-conversas-privadas.md manda reformular
 * ou implementar o que a frase promete, e a reformulação é o que este produto
 * entrega.
 *
 * O que a aplicação garante de verdade: nenhuma rota devolve esta conversa a
 * quem não é membro, `ADMINISTRATOR` inclusive, e o conteúdo não aparece em
 * busca nenhuma fora dela.
 */

const CHAVE = 'trindade:aviso-de-privacidade';

export function AvisoDePrivacidade() {
  const [visivel, setVisivel] = useState(() => {
    try {
      return window.localStorage.getItem(CHAVE) !== 'visto';
    } catch {
      // Navegador que recusa `localStorage` mostra o aviso toda vez. É melhor
      // repetir a promessa que escondê-la de quem nunca a viu.
      return true;
    }
  });

  if (!visivel) return null;

  function dispensar(): void {
    try {
      window.localStorage.setItem(CHAVE, 'visto');
    } catch {
      /* sem espaço ou sem permissão: some nesta sessão e volta na próxima. */
    }
    setVisivel(false);
  }

  return (
    <aside className={styles.aviso} role="note">
      <p>
        Só vocês dois veem esta conversa — ninguém mais, nem quem administra o servidor, vê o
        conteúdo pela aplicação. Não é criptografia ponta a ponta: quem tem acesso ao banco de dados
        consegue ler.
      </p>
      <IconButton label="Entendi" size="sm" onClick={dispensar}>
        <X size={16} />
      </IconButton>
    </aside>
  );
}
