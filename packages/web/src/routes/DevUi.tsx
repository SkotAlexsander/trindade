import { useState } from 'react';
import {
  Avatar,
  Button,
  Dialog,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Skeleton,
  Spinner,
  Textarea,
  Tooltip,
  useToast,
} from '../components';
import { Check, ChevronDown, Moon, Monitor, Sun, Trash } from '../components/icones';
import { useTheme, type Theme } from '../lib/tema';
import { contrastRatio, ensureContrast, parseHex } from '../lib/contraste';
import styles from './DevUi.module.css';

/**
 * Galeria dos primitivos. Só existe em desenvolvimento — é o que se usa para
 * revisar sem abrir o produto. Nenhum componente de domínio entra aqui.
 */
export function DevUi() {
  const { theme, resolved, setTheme } = useTheme();
  const toast = useToast();
  const [dialogAberto, setDialogAberto] = useState(false);
  const [texto, setTexto] = useState('');

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Primitivos</h1>
          <p className={styles.sub}>
            Tema resolvido: <strong>{resolved}</strong>
          </p>
        </div>
        <div className={styles.themeSwitch} role="group" aria-label="Tema">
          {(
            [
              ['light', 'Claro', <Sun key="s" size={16} />],
              ['dark', 'Escuro', <Moon key="m" size={16} />],
              ['system', 'Sistema', <Monitor key="c" size={16} />],
            ] as Array<[Theme, string, React.ReactNode]>
          ).map(([valor, rotulo, icone]) => (
            <Button
              key={valor}
              size="sm"
              variant={theme === valor ? 'primary' : 'ghost'}
              onClick={() => setTheme(valor)}
              aria-pressed={theme === valor}
            >
              {icone}
              {rotulo}
            </Button>
          ))}
        </div>
      </header>

      <Secao titulo="Button">
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="live">Ao vivo</Button>
        </div>
        <div className={styles.row}>
          <Button size="sm" variant="primary">
            Pequeno
          </Button>
          <Button size="sm" variant="secondary">
            Pequeno
          </Button>
          <Button variant="primary" disabled>
            Desabilitado
          </Button>
          <Button variant="primary" loading loadingLabel="Salvando…">
            Salvar
          </Button>
        </div>
        <p className={styles.nota}>
          O estado de carregamento troca o texto pelo gerúndio, nunca por um símbolo: o rótulo é a
          informação de qual ação está em curso.
        </p>
      </Secao>

      <Secao titulo="IconButton e Tooltip">
        <div className={styles.row}>
          <Tooltip label="Apagar mensagem">
            <IconButton label="Apagar mensagem" variant="ghost">
              <Trash />
            </IconButton>
          </Tooltip>
          <Tooltip label="Confirmar">
            <IconButton label="Confirmar" variant="secondary">
              <Check />
            </IconButton>
          </Tooltip>
          <Tooltip label="Some no Escape, aparece no Tab" placement="right">
            <IconButton label="Mais" variant="ghost" size="sm">
              <ChevronDown size={16} />
            </IconButton>
          </Tooltip>
        </div>
        <p className={styles.nota}>300ms para abrir, nenhum para fechar. Abre também no foco.</p>
      </Secao>

      <Secao titulo="Input e Textarea">
        <div className={styles.col}>
          <Input label="Nome do canal" placeholder="produto" hint="Minúsculas e hífen." />
          <Input
            label="Com erro"
            defaultValue="Nome Inválido"
            error="Use apenas letras minúsculas, números e hífen."
          />
          <Input label="Desabilitado" defaultValue="não editável" disabled />
          <Textarea
            label="Tópico"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            hint="Aparece no cabeçalho do canal."
          />
        </div>
      </Secao>

      <Secao titulo="Avatar">
        <div className={styles.row}>
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((tamanho) => (
            <Avatar key={tamanho} id="ana-01" name="Ana Ribeiro" size={tamanho} />
          ))}
        </div>
        <div className={styles.row}>
          {(['online', 'idle', 'busy', 'offline'] as const).map((status) => (
            <div key={status} className={styles.stack}>
              <Avatar id={`u-${status}`} name={status} size="lg" status={status} />
              <span className={styles.legenda}>{status}</span>
            </div>
          ))}
        </div>
        <p className={styles.nota}>
          Sem imagem, cai nas iniciais sobre uma cor derivada do id — estável, e o contraste do
          texto é ajustado para a cor sorteada.
        </p>
      </Secao>

      <Secao titulo="Menu">
        <div className={styles.row}>
          <Menu
            label="Ações do canal"
            trigger={
              <Button variant="secondary">
                Ações <ChevronDown size={16} />
              </Button>
            }
          >
            <MenuItem onSelect={() => toast.show('Canal renomeado.')}>Renomear</MenuItem>
            <MenuItem onSelect={() => toast.show('Canal arquivado.')}>Arquivar</MenuItem>
            <MenuItem disabled>Sem permissão</MenuItem>
            <MenuSeparator />
            <MenuItem danger icon={<Trash size={16} />} onSelect={() => toast.show('Apagado.', 'danger')}>
              Apagar
            </MenuItem>
          </Menu>
        </div>
        <p className={styles.nota}>Setas navegam, Enter escolhe, Escape fecha, digitar procura.</p>
      </Secao>

      <Secao titulo="Popover">
        <div className={styles.row}>
          <Popover trigger={<Button variant="secondary">Abrir popover</Button>}>
            <p>Reposiciona sozinho quando encosta na borda da janela.</p>
          </Popover>
          <Popover placement="right" trigger={<Button variant="ghost">À direita</Button>}>
            <p>Este pediu a direita e cede se não couber.</p>
          </Popover>
        </div>
      </Secao>

      <Secao titulo="Dialog">
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setDialogAberto(true)}>
            Abrir diálogo
          </Button>
        </div>
        <Dialog
          open={dialogAberto}
          onOpenChange={setDialogAberto}
          title="Apagar canal"
          description="Isto apaga o histórico junto e não tem volta."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogAberto(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDialogAberto(false);
                  toast.show('Canal apagado.', 'danger');
                }}
              >
                Apagar
              </Button>
            </>
          }
        />
        <p className={styles.nota}>
          Foco preso dentro, Escape fecha, e o foco volta para o botão que abriu.
        </p>
      </Secao>

      <Secao titulo="Toast">
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => toast.show('Convite copiado.')}>
            Mostrar aviso
          </Button>
          <Button variant="secondary" onClick={() => toast.show('Não foi possível enviar.', 'danger')}>
            Mostrar erro
          </Button>
        </div>
        <p className={styles.nota}>Empilha até três; o quarto empurra o mais velho para fora.</p>
      </Secao>

      <Secao titulo="Spinner e Skeleton">
        <div className={styles.row}>
          <Spinner />
          <div className={styles.skeletonBox}>
            <Skeleton width="40%" />
            <Skeleton />
            <Skeleton width="70%" />
          </div>
        </div>
        <p className={styles.nota}>
          Opacidade pulsando em 1,4s, sem varredura diagonal. O spinner só vale para página inteira.
        </p>
      </Secao>

      <Secao titulo="Cor de cargo">
        <TabelaContraste />
        <p className={styles.nota}>
          Cargo tem cor livre. A da esquerda é a escolhida; a da direita é a que aparece, clareada
          até 4.5:1 contra o fundo.
        </p>
      </Secao>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className={styles.secao}>
      <h2 className="section-label">{titulo}</h2>
      <div className={styles.corpo}>{children}</div>
    </section>
  );
}

function TabelaContraste() {
  const { resolved } = useTheme();
  const fundo = resolved === 'dark' ? '#080d18' : '#e4ebf1';
  const cores = ['#1a237e', '#4a148c', '#0d47a1', '#e879f9', '#7f8c8d'];

  return (
    <table className={styles.tabela}>
      <thead>
        <tr>
          <th>escolhida</th>
          <th>razão</th>
          <th>exibida</th>
          <th>razão</th>
        </tr>
      </thead>
      <tbody>
        {cores.map((cor) => {
          const ajustada = ensureContrast(cor, fundo);
          const antes = parseHex(cor);
          const depois = parseHex(ajustada);
          const bg = parseHex(fundo);
          return (
            <tr key={cor}>
              <td style={{ color: cor }}>{cor}</td>
              <td>{antes && bg ? contrastRatio(antes, bg).toFixed(2) : '—'}</td>
              <td style={{ color: ajustada }}>{ajustada}</td>
              <td>{depois && bg ? contrastRatio(depois, bg).toFixed(2) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
