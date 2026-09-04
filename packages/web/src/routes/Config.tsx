import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components';
import { ChevronLeft } from '../components/icones';
import { usePermissions } from '../features/auth/usePermissions';
import { PaginaDeCargos } from '../features/roles/PaginaDeCargos';
import { PaginaDePessoas } from '../features/people/PaginaDePessoas';
import styles from './config.module.css';

/**
 * Páginas de configuração.
 *
 * Só o que é lista longa ou hierarquia mora aqui. Perfil e convite são
 * diálogos: edição pontual não merece tirar a pessoa da conversa.
 */

const TITULOS: Record<string, string> = {
  cargos: 'Cargos e permissões',
  pessoas: 'Pessoas',
  convites: 'Convites',
  aparencia: 'Aparência',
  atalhos: 'Atalhos',
};

export function Config() {
  const { secao } = useParams<{ secao: string }>();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const conteudo = (() => {
    if (secao === 'cargos') {
      // A rota do servidor recusa de qualquer forma; isto só evita desenhar
      // uma página inteira que não vai responder a nada.
      if (!can('MANAGE_ROLES')) return <SemPermissao o="gerenciar cargos" />;
      return <PaginaDeCargos />;
    }
    if (secao === 'pessoas') {
      // Ver a lista não exige permissão nenhuma — `GET /users` é aberto a
      // quem tem sessão, e o elenco inteiro já aparece na faixa lateral. O
      // que exige permissão são as ações, e cada uma se esconde sozinha.
      return <PaginaDePessoas />;
    }
    return <p className={styles.pendente}>Esta página chega numa fase adiante.</p>;
  })();

  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ChevronLeft size={16} /> Voltar
        </Button>
        <h1 className={styles.titulo}>{TITULOS[secao ?? ''] ?? secao ?? 'Configurações'}</h1>
      </header>
      {conteudo}
    </div>
  );
}

function SemPermissao({ o }: { o: string }) {
  return <p className={styles.pendente}>Você não tem permissão para {o}.</p>;
}
