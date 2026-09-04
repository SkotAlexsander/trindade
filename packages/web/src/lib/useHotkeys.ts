import { useEffect, useRef } from 'react';

/**
 * Atalhos globais que não disparam enquanto a pessoa digita.
 *
 * Essa é a regra inteira do hook. `Alt ↓` trocando de canal no meio de uma
 * frase é o tipo de defeito que só aparece em uso real e irrita muito — está
 * no aceite da fase por isso. Ver design/02-shell-principal.md.
 */
export interface Hotkey {
  /** `key` do evento, comparado sem diferenciar maiúscula. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Dispara mesmo com o foco num campo de texto. Use com parcimônia. */
  emCampo?: boolean;
  run: (event: KeyboardEvent) => void;
}

function editando(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  if (alvo.isContentEditable) return true;
  const tag = alvo.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // Caixa e rádio não são digitação; um atalho ali é legítimo.
  const tipo = (alvo as HTMLInputElement).type;
  return tipo !== 'checkbox' && tipo !== 'radio' && tipo !== 'button';
}

/** `Ctrl` no Windows e Linux, `⌘` no mac — a mesma tecla para quem usa. */
function modAtivo(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function useHotkeys(atalhos: Hotkey[]): void {
  // O ref evita reassinar o listener a cada render sem exigir que quem chama
  // memoize o array.
  const atual = useRef(atalhos);
  atual.current = atalhos;

  useEffect(() => {
    function aoTeclar(event: KeyboardEvent): void {
      const digitando = editando(event.target);

      for (const atalho of atual.current) {
        if (event.key.toLowerCase() !== atalho.key.toLowerCase()) continue;
        if (Boolean(atalho.mod) !== modAtivo(event)) continue;
        if (Boolean(atalho.shift) !== event.shiftKey) continue;
        if (Boolean(atalho.alt) !== event.altKey) continue;
        if (digitando && !atalho.emCampo) continue;

        event.preventDefault();
        atalho.run(event);
        return;
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);
}

export { editando as focoEmCampoDeTexto };
