import { Routes, Route } from 'react-router-dom';
import { Health } from './routes/Health';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Health />} />
    </Routes>
  );
}
