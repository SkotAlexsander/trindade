import { Routes, Route, Navigate } from 'react-router-dom';
import { Entrar } from './features/auth/Entrar';
import { Verificacao } from './features/auth/Verificacao';
import { AceitarConvite } from './features/auth/AceitarConvite';
import { CriarConta } from './features/auth/CriarConta';
import { RequireAuth } from './features/auth/RequireAuth';
import { Health } from './routes/Health';
import { DevUi } from './routes/DevUi';

export function App() {
  return (
    <Routes>
      {/* As quatro telas fora do shell. Ver design/06-autenticacao.md. */}
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/entrar/verificacao" element={<Verificacao />} />
      <Route path="/entrar/:codigo" element={<AceitarConvite />} />
      <Route path="/criar-conta/:codigo" element={<CriarConta />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Health />
          </RequireAuth>
        }
      />

      {/* Galeria dos primitivos. Só em desenvolvimento: em produção a rota
          nem entra no bundle, porque o import.meta.env.DEV vira false e o
          Rollup remove o ramo inteiro. */}
      {import.meta.env.DEV ? <Route path="/dev/ui" element={<DevUi />} /> : null}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
