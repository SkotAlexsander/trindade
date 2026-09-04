import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Spinner, useToast } from '../../components';
import { CodeInput } from '../auth/components';
import { HttpError, api } from '../../lib/http';
import { useAuth } from '../auth/store';
import styles from './perfil.module.css';

/**
 * Segurança da conta.
 *
 * Senha, segundo fator, códigos de recuperação e sessões. A lista de sessões
 * **não mostra IP nem localização**, e isso é coerência e não omissão: se não
 * registramos IP, não temos o que exibir. Ver design/05-perfil-e-cargos.md.
 */

interface Sessao {
  id: string;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}

/**
 * "Chrome no Windows", a partir do user-agent.
 *
 * Não é detecção séria e não precisa ser: serve para a pessoa reconhecer o que
 * é dela. Errar para "um navegador" é melhor do que despejar a string crua.
 */
function navegador(ua: string | null): string {
  if (!ua) return 'um navegador';
  const nome =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'um navegador';
  const sistema =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return sistema ? `${nome} no ${sistema}` : nome;
}

function quando(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 2) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

export function AbaSeguranca() {
  return (
    <div className={styles.aba}>
      <BlocoDeSenha />
      <div className={styles.separador} />
      <BlocoDe2FA />
      <div className={styles.separador} />
      <BlocoDeSessoes />
    </div>
  );
}

// --- senha -----------------------------------------------------------------

function BlocoDeSenha() {
  const { show } = useToast();
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function trocar(): Promise<void> {
    setErro(null);
    setSalvando(true);
    try {
      await api('/me/password', { method: 'POST', body: { current: atual, next: nova } });
      setAberto(false);
      setAtual('');
      setNova('');
      // Trocar a senha derruba as outras sessões — o servidor faz isso, e
      // dizer é a diferença entre um alívio e um susto no outro aparelho.
      show('Senha alterada. As outras sessões foram encerradas.', 'info');
    } catch (err) {
      setErro(err instanceof HttpError ? err.message : 'não consegui alterar a senha');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className={styles.bloco}>
      <div className={styles.blocoTopo}>
        <div>
          <h3 className={styles.blocoTitulo}>Senha</h3>
          <p className={styles.blocoDica}>Ao menos 12 caracteres.</p>
        </div>
        {!aberto ? (
          <Button variant="secondary" size="sm" onClick={() => setAberto(true)}>
            Alterar senha
          </Button>
        ) : null}
      </div>

      {aberto ? (
        <div className={styles.blocoCorpo}>
          <Input
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={nova}
            {...(erro ? { error: erro } : {})}
            onChange={(e) => setNova(e.target.value)}
          />
          <div className={styles.acoesFoto}>
            <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={salvando || nova.length < 12 || atual.length === 0}
              onClick={() => void trocar()}
            >
              {salvando ? <Spinner /> : 'Salvar senha'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// --- segundo fator ---------------------------------------------------------

type PassoDe2FA = 'fechado' | 'segredo' | 'confirmar' | 'codigos';

function BlocoDe2FA() {
  const { show } = useToast();
  const [passo, setPasso] = useState<PassoDe2FA>('fechado');
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [guardei, setGuardei] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [restantes, setRestantes] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ available: number }>('/me/totp/recovery-codes/count');
      setRestantes(r.available);
      setAtivo(r.available > 0);
    } catch {
      setAtivo(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function comecar(): Promise<void> {
    setErro(null);
    try {
      const r = await api<{ secret: string; qrSvg: string }>('/me/totp/setup', { method: 'POST' });
      setSetup(r);
      setPasso('segredo');
    } catch (err) {
      setErro(err instanceof HttpError ? err.message : 'não consegui começar');
    }
  }

  async function confirmar(code: string): Promise<void> {
    setErro(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/me/totp/enable', {
        method: 'POST',
        body: { code },
      });
      setCodigos(r.recoveryCodes);
      setPasso('codigos');
      await carregar();
    } catch (err) {
      setDigitado('');
      setErro(err instanceof HttpError ? err.message : 'código inválido');
    }
  }

  function baixar(): void {
    if (!codigos) return;
    const texto = `Códigos de recuperação — Trindade\n\n${codigos.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trindade-codigos-de-recuperacao.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={styles.bloco}>
      <div className={styles.blocoTopo}>
        <div>
          <h3 className={styles.blocoTitulo}>Verificação em duas etapas</h3>
          <p className={styles.blocoDica}>
            {ativo === null
              ? '…'
              : ativo
                ? `Ativa. ${restantes ?? 0} de 10 códigos de recuperação ainda válidos.`
                : 'Um código do seu telefone, além da senha.'}
          </p>
        </div>
        {passo === 'fechado' && ativo === false ? (
          <Button variant="secondary" size="sm" onClick={() => void comecar()}>
            Ativar
          </Button>
        ) : null}
      </div>

      {erro ? <p className={styles.erroFoto}>{erro}</p> : null}

      {passo === 'segredo' && setup ? (
        <div className={styles.blocoCorpo}>
          <p className={styles.blocoDica}>
            Leia o código no seu aplicativo de autenticação, ou digite o segredo à mão.
          </p>
          {/* `<img>` com data URI, e não `dangerouslySetInnerHTML`. O SVG sai
              do nosso servidor, mas SVG inline **é** um documento com script
              dentro do nosso próprio origin, e o projeto inteiro se recusa a
              injetar HTML — foi por isso que o markdown virou nós React. Em
              `<img>` o SVG é passivo: nada roda, nada busca nada de fora. */}
          <img
            className={styles.qr}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
            alt="Código QR para o aplicativo de autenticação"
          />
          <div className={styles.segredo}>
            <code>{setup.secret}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(setup.secret)}
            >
              Copiar
            </Button>
          </div>
          <div className={styles.acoesFoto}>
            <Button variant="ghost" size="sm" onClick={() => setPasso('fechado')}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => setPasso('confirmar')}>
              Já adicionei
            </Button>
          </div>
        </div>
      ) : null}

      {passo === 'confirmar' ? (
        <div className={styles.blocoCorpo}>
          <p className={styles.blocoDica}>
            Digite o código de seis dígitos. Só agora a verificação é realmente ativada.
          </p>
          <CodeInput
            value={digitado}
            onChange={setDigitado}
            shake={Boolean(erro)}
            onComplete={(code) => void confirmar(code)}
          />
        </div>
      ) : null}

      {passo === 'codigos' && codigos ? (
        <div className={styles.blocoCorpo}>
          {/* O aviso é literal, e o atrito aqui é o desenho certo: é um dos
              raríssimos casos em que dificultar o fechamento protege alguém de
              perder a conta. */}
          <p className={styles.avisoForte}>
            Guarde estes códigos agora. Sem e-mail cadastrado, eles são a única forma de entrar
            se você perder o telefone. Não é possível vê-los de novo.
          </p>
          <ul className={styles.codigos}>
            {codigos.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className={styles.acoesFoto}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(codigos.join('\n'))}
            >
              Copiar
            </Button>
            <Button variant="ghost" size="sm" onClick={baixar}>
              Baixar
            </Button>
          </div>
          <label className={styles.confirmacao}>
            <input
              type="checkbox"
              checked={guardei}
              onChange={(e) => setGuardei(e.target.checked)}
            />
            <span>Guardei os códigos num lugar seguro.</span>
          </label>
          <Button
            size="sm"
            disabled={!guardei}
            onClick={() => {
              setPasso('fechado');
              setCodigos(null);
              setGuardei(false);
              show('Verificação em duas etapas ativada.', 'info');
            }}
          >
            Concluir
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// --- sessões ---------------------------------------------------------------

function BlocoDeSessoes() {
  const { show } = useToast();
  const clear = useAuth((s) => s.clear);
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ sessions: Sessao[] }>('/me/sessions');
      setSessoes(r.sessions);
    } catch {
      setSessoes([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function encerrar(id: string): Promise<void> {
    await api(`/me/sessions/${id}`, { method: 'DELETE' });
    await carregar();
  }

  async function encerrarTodas(): Promise<void> {
    try {
      await api('/auth/logout-all', { method: 'POST' });
      // `logout-all` derruba **todas**, inclusive esta: a sessão atual também
      // morre, então a única saída honesta é voltar para a tela de entrada.
      clear();
    } catch {
      show('Não consegui encerrar as sessões.', 'danger');
    }
  }

  return (
    <section className={styles.bloco}>
      <div className={styles.blocoTopo}>
        <div>
          <h3 className={styles.blocoTitulo}>Sessões abertas</h3>
          {/* De propósito, e vale explicar: se não registramos IP, não temos o
              que exibir. O navegador e o horário bastam para reconhecer o que
              é seu. */}
          <p className={styles.blocoDica}>Sem IP e sem localização — não guardamos nenhum dos dois.</p>
        </div>
      </div>

      <ul className={styles.sessoes}>
        {sessoes === null ? (
          <li className={styles.blocoDica}>
            <Spinner />
          </li>
        ) : (
          sessoes.map((s) => (
            <li key={s.id} className={styles.sessao}>
              <span className={styles.sessaoNome}>{navegador(s.userAgent)}</span>
              <span className={styles.sessaoQuando}>{quando(s.createdAt)}</span>
              {s.current ? (
                <span className={styles.sessaoAtual}>esta sessão</span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => void encerrar(s.id)}>
                  Encerrar
                </Button>
              )}
            </li>
          ))
        )}
      </ul>

      {sessoes && sessoes.length > 1 ? (
        <Button variant="secondary" size="sm" onClick={() => void encerrarTodas()}>
          Encerrar todas as sessões
        </Button>
      ) : null}
    </section>
  );
}
