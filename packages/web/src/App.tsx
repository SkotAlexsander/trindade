import { Routes, Route, Navigate } from 'react-router-dom';
import { Entrar } from './features/auth/Entrar';
import { Verificacao } from './features/auth/Verificacao';
import { AceitarConvite } from './features/auth/AceitarConvite';
import { CriarConta } from './features/auth/CriarConta';
import { RequireAuth } from './features/auth/RequireAuth';
import { Health } from './routes/Health';

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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
