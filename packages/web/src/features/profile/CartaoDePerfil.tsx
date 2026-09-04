import { cloneElement, useState, type ReactElement } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react';
import type { Role, User } from '@trindade/shared';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button } from '../../components';
import { useAbrirDireta } from '../conversations/queries';
import { ensureContrast, sobrepor } from '../../lib/contraste';
import { lerToken } from '../../lib/tokens';
import { useAuth } from '../auth/store';
import { usePresenca } from '../realtime/store';
import { useDialogoDePerfil } from './DialogoDePerfil';
import styles from './perfil.module.css';

/**
 * O cartão de perfil.
 *
 * Abre no hover depois de 400ms, ou no clique. Fecha ao sair do mouse **com
 * 300ms de atraso**, e esse atraso não é enfeite: sem ele, atravessar a borda
 * do cartão o fecha na cara de quem estava indo clicar, e a interface fica
 * hostil. Ver design/05-perfil-e-cargos.md.
 */

const ABRIR_MS = 400;
const FECHAR_MS = 300;

/** O cargo que dá a cor: o de maior posição que tenha cor definida. */
export function cargoQueColore(roles: readonly Role[]): Role | null {
  return [...roles].sort((a, b) => b.position - a.position).find((r) => r.color) ?? null;
}

/**
 * A faixa do topo: a cor escolhida pela pessoa, senão a do cargo mais alto,
 * senão uma neutra. É a única personalização cromática que cada um controla.
 *
 * O padrão é `--bg-panel` e não o `--mid` que o documento pedia: no tema
 * escuro `--bg-raised` **é** `--mid`, então a faixa saía exatamente da cor do
 * cartão e desaparecia. `--bg-panel` é mais escura que a superfície nos dois
 * temas, e é o que faz a faixa existir para quem não escolheu cor nenhuma.
 */
function corDaFaixa(user: User): string {
  return user.accentColor ?? cargoQueColore(user.roles)?.color ?? 'var(--bg-panel)';
}

function desde(iso: string): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const NOME_DO_STATUS: Record<string, string> = {
  online: 'Disponível',
  idle: 'Ausente',
  busy: 'Ocupado',
  invisible: 'Invisível',
  offline: 'Offline',
};

export interface CartaoDePerfilProps {
  user: User;
  /** O elemento que abre. Recebe ref e handlers por clonagem. */
  trigger: ReactElement;
  onEditar?: () => void;
  onMensagem?: (user: User) => void;
}

export function CartaoDePerfil({ user, trigger, onEditar, onMensagem }: CartaoDePerfilProps) {
  const navigate = useNavigate();
  const abrindo = useAbrirDireta();
  const [aberto, setAberto] = useState(false);
  const souEu = useAuth((s) => s.user?.id) === user.id;
  // A presença vem do gateway, não do `User` do cache: o status muda muito mais
  // vezes do que o perfil, e o cartão precisa dizer a verdade agora.
  const presenca = usePresenca((s) => s.porUsuario[user.id]);
  const abrirPerfil = useDialogoDePerfil((s) => s.abrir);
  const status = presenca?.status ?? user.status;

  const { refs, floatingStyles, context } = useFloating({
    open: aberto,
    onOpenChange: setAberto,
    // Direita primeiro; `flip` tenta a esquerda, `shift` alinha pelo rodapé da
    // janela quando não cabe na vertical. O cartão nunca sai da viewport.
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      delay: { open: ABRIR_MS, close: FECHAR_MS },
      // O `safePolygon` cobre o caminho diagonal entre o avatar e o cartão. Só
      // o atraso não basta: quem mira o botão de baixo passa por fora dos dois
      // retângulos, e o cartão fecharia no meio do movimento.
      handleClose: safePolygon({ blockPointerEvents: false }),
    }),
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  const gatilhoRef = (trigger as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
  const ref = useMergeRefs([refs.setReference, gatilhoRef ?? null]);

  const faixa = corDaFaixa(user);
  const cargos = [...user.roles].sort((a, b) => b.position - a.position);

  return (
    <>
      {cloneElement(trigger, {
        ref,
        ...getReferenceProps(trigger.props as Record<string, unknown>),
      })}

      {aberto ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={`${styles.cartao} chamfer-sm`}
              aria-label={`Perfil de ${user.displayName}`}
              {...getFloatingProps()}
            >
              <div className={styles.faixa} style={{ background: faixa }} />

              <div className={styles.avatarSobreposto}>
                <Avatar
                  id={user.id}
                  name={user.displayName}
                  src={user.avatarUrl}
                  size="xl"
                  status={status}
                />
              </div>

              <div className={styles.corpo}>
                <p className={styles.nome}>{user.displayName}</p>
                <p className={styles.usuario}>@{user.username}</p>

                {cargos.length > 0 ? (
                  <div className={styles.cargos}>
                    {cargos.map((cargo) => (
                      <ChipDeCargo key={cargo.id} cargo={cargo} />
                    ))}
                  </div>
                ) : null}

                {user.bio ? <p className={styles.bio}>{user.bio}</p> : null}

                <div className={styles.separador} />

                <p className={styles.linhaStatus}>
                  <span className={styles.pontoStatus} data-status={status} aria-hidden="true" />
                  <span>{user.customStatus ?? NOME_DO_STATUS[status] ?? status}</span>
                </p>
                {desde(user.createdAt) ? (
                  <p className={styles.desde}>Está aqui desde {desde(user.createdAt)}</p>
                ) : null}

                <div className={styles.separador} />

                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.acao}
                  disabled={abrindo.isPending}
                  onClick={() => {
                    setAberto(false);
                    if (souEu) {
                      (onEditar ?? (() => abrirPerfil('perfil')))();
                      return;
                    }
                    // Sem `onMensagem`, o próprio cartão abre a direta: este é
                    // **o** caminho principal para uma conversa privada, e
                    // depender de cada tela passar um callback era o jeito
                    // garantido de o botão não funcionar em alguma delas.
                    if (onMensagem) {
                      onMensagem(user);
                      return;
                    }
                    abrindo.mutate(user.id, {
                      onSuccess: ({ conversation }) => navigate(`/d/${conversation.id}`),
                    });
                  }}
                >
                  {souEu ? 'Editar perfil' : 'Mandar mensagem'}
                </Button>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}

/**
 * O chip de cargo.
 *
 * O fundo é a cor do cargo a 12%, e o texto é a mesma cor **corrigida para
 * contraste**: uma cor escolhida no seletor de cores raramente é legível sobre
 * o fundo do tema, e sem a correção o nome do cargo some. Ver o utilitário da
 * fase 3.
 */
export function ChipDeCargo({ cargo }: { cargo: Role }) {
  if (!cargo.color) {
    return (
      <span className={styles.chip}>
        <span className={styles.chipPonto} aria-hidden="true" />
        {cargo.name}
      </span>
    );
  }

  // Primeiro a cor legível sobre a superfície, depois a pílula a 12% **dessa**
  // cor — não da original. Tingir com o hex cru dá uma pílula invisível
  // sempre que a cor é escura e o tema também é: 12% de azul-marinho sobre um
  // fundo quase preto devolve o próprio fundo, e o chip some.
  //
  // O texto é medido contra a mistura final, não contra a cor pura nem contra
  // o fundo puro — comparar com qualquer um dos dois erra para um dos lados.
  // O ajuste é só de exibição: o hex escolhido fica intacto no banco.
  const superficie = lerToken('--bg-raised', '#101a2e');
  const base = ensureContrast(cargo.color, superficie);
  const fundo = sobrepor(base, superficie, 0.12);
  const legivel = ensureContrast(base, fundo);

  return (
    <span className={styles.chip} style={{ background: fundo, color: legivel }}>
      <span className={styles.chipPonto} style={{ background: legivel }} aria-hidden="true" />
      {cargo.name}
    </span>
  );
}
