import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ToastProvider } from './components';
import './styles/tokens.css';
import './styles/globals.css';

// Sem polling. Se o WebSocket cai, o cliente reconecta e refaz o fetch inicial.
// Ver docs/02-arquitetura.md.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

/* O Excalidraw carrega as fontes daqui, e não de `esm.sh`: nenhuma tela deste
   produto faz requisição externa, e a CSP em produção recusaria de qualquer
   jeito. Fica antes de qualquer render porque o pacote lê a variável ao ser
   carregado — e ele é carregado sob demanda, na primeira vez que alguém abre um
   quadro. Ver packages/web/scripts/fontes-do-quadro.mjs. */
window.EXCALIDRAW_ASSET_PATH = '/excalidraw/';

const root = document.getElementById('root');
if (!root) throw new Error('#root não existe no index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
