import { useCallback, useEffect, useState } from 'react';

/**
 * Tema, guardado em **cookie** e não em localStorage.
 *
 * O motivo é a piscada branca: localStorage só existe depois que o JavaScript
 * roda, então a primeira pintura sai no tema errado. O cookie vai junto com a
 * requisição, o servidor carimba o atributo no HTML e a página já nasce certa.
 * Ver design/01-tokens.md.
 *
 * Enquanto o front é servido estático pelo Vite, quem carimba é o snippet
 * inline em index.html — mesma leitura, antes da primeira pintura.
 */
export type Theme = 'dark' | 'light' | 'system';

export const THEME_COOKIE = 'tema';
const UM_ANO = 60 * 60 * 24 * 365;

export function readThemeCookie(): Theme {
  const achado = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
  return achado === 'dark' || achado === 'light' || achado === 'system' ? achado : 'system';
}

function writeThemeCookie(theme: Theme): void {
  // `SameSite=Lax` basta: é preferência de exibição, não credencial.
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${UM_ANO}; SameSite=Lax`;
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** O tema que de fato vale agora, com `system` já resolvido. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function useTheme(): {
  theme: Theme;
  resolved: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(() => readThemeCookie());
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(theme));

  const setTheme = useCallback((next: Theme) => {
    writeThemeCookie(next);
    applyTheme(next);
    setThemeState(next);
    setResolved(resolveTheme(next));
  }, []);

  // Em `system`, seguir a troca do sistema sem exigir recarregar.
  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const ouvir = () => {
      applyTheme('system');
      setResolved(resolveTheme('system'));
    };
    query.addEventListener('change', ouvir);
    return () => query.removeEventListener('change', ouvir);
  }, [theme]);

  return { theme, resolved, setTheme };
}
