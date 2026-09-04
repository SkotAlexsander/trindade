import { Routes, Route, Navigate } from 'react-router-dom';
import { Entrar } from './features/auth/Entrar';
import { Verificacao } from './features/auth/Verificacao';
import { AceitarConvite } from './features/auth/AceitarConvite';
import { CriarConta } from './features/auth/CriarConta';
import { RequireAuth } from './features/auth/RequireAuth';
import { AppShell } from './features/shell/AppShell';
import { Canal } from './routes/Canal';
import { Conversa } from './routes/Conversa';
import { Config } from './routes/Config';
import { DevUi } from './routes/DevUi';

export function App() {
  return (
    <Routes>
      {/* As quatro telas fora do shell. Ver design/06-autenticacao.md. */}
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/entrar/verificacao" element={<Verificacao />} />
      <Route path="/entrar/:codigo" element={<AceitarConvite />} />
      <Route path="/criar-conta/:codigo" element={<CriarConta />} />

      {/* Tudo o que exige sessão vive dentro do shell. */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Canal />} />
        <Route path="/c/:slug" element={<Canal />} />
        <Route path="/d/:id" element={<Conversa />} />
        <Route path="/config/:secao" element={<Config />} />
      </Route>

      {/* Galeria dos primitivos. Só em desenvolvimento: em produção a rota
          nem entra no bundle, porque o import.meta.env.DEV vira false e o
          Rollup remove o ramo inteiro. */}
      {import.meta.env.DEV ? <Route path="/dev/ui" element={<DevUi />} /> : null}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
