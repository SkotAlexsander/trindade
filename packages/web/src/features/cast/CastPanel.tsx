import { useEffect, useRef, useState } from 'react';
import type { User } from '@trindade/shared';
import { Avatar, IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from '../../components';
import { Headphones, Mark, Mic, MicOff, HeadphonesOff, Settings } from '../../components/icones';
import { useAuth } from '../auth/store';
import { CartaoDePerfil } from '../profile/CartaoDePerfil';
import { useDialogoDePerfil } from '../profile/DialogoDePerfil';
import styles from './cast.module.css';

/**
 * Painel do elenco.
 *
 * São **sempre cinco espaços**. Quem está offline aparece esmaecido, não some:
 * o espaço vazio de alguém ausente é informação, e é isso que faz o painel
 * funcionar como instrumento em vez de lista.
 *
 * Ver design/03-menu-e-navegacao.md — é a seção mais longa do documento, e por
 * um motivo: este é o elemento que diferencia o produto.
 */
export const ESPACOS = 5;

/** Estados de presença, mais os dois que só a chamada produz (fase 7). */
export type EstadoElenco = User['status'] | 'call' | 'speaking';

export interface CastPanelProps {
  users: User[];
  /** Quem está digitando agora — chega pelo WebSocket na fase 5. */
  typing?: ReadonlySet<string>;
  /** Verdadeiro no primeiro READY da sessão, falso em reconexão. */
  acender?: boolean;
  onSelect?: (user: User) => void;
  /**
   * Abre o painel de guardadas. O gatilho fica aqui, no rodapé com o seu nome,
   * e não no cabeçalho do canal: aquela barra é do canal em que você está, e
   * guardadas atravessa todos. Ver design/04-mensagens.md.
   */
  onGuardadas?: () => void;
}

/** Primeiro nome, truncado em 6 sem reticências: `Cristina` vira `Crist`. */
export function nomeCurto(displayName: string): string {
  const primeiro = displayName.trim().split(/\s+/)[0] ?? displayName;
  return primeiro.length > 6 ? primeiro.slice(0, 5) : primeiro;
}

export function CastPanel({
  users,
  typing,
  acender = false,
  onSelect,
  onGuardadas,
}: CastPanelProps) {
  const eu = useAuth((state) => state.user);
  const abrirPerfil = useDialogoDePerfil((s) => s.abrir);
  const [microfone, setMicrofone] = useState(true);
  const [fone, setFone] = useState(true);

  // A sequência roda uma vez por sessão. O ref é o que garante isso: um
  // segundo `acender=true` vindo de reconexão não reanima nada.
  const jaAcendeu = useRef(false);
  const [animar, setAnimar] = useState(false);

  useEffect(() => {
    if (!acender || jaAcendeu.current) return;
    jaAcendeu.current = true;
    setAnimar(true);
    const id = setTimeout(() => setAnimar(false), 700);
    return () => clearTimeout(id);
  }, [acender]);

  // Cinco espaços sempre: completa com vazios se ainda faltar gente no elenco.
  const espacos: Array<User | null> = [...users.slice(0, ESPACOS)];
  while (espacos.length < ESPACOS) espacos.push(null);

  return (
    <div className={styles.painel}>
      <div className={styles.espacos} data-acender={animar} aria-label="Elenco" role="group">
        {espacos.map((pessoa, indice) =>
          pessoa ? (
            <EspacoPessoa
              key={pessoa.id}
              user={pessoa}
              indice={indice}
              digitando={typing?.has(pessoa.id) ?? false}
              {...(onSelect ? { onSelect } : {})}
            />
          ) : (
            <div key={`vago-${indice}`} className={styles.espaco} aria-hidden="true" />
          ),
        )}
      </div>

      {eu ? (
        <div className={styles.voce}>
          <Avatar id={eu.id} name={eu.displayName} src={eu.avatarUrl} size="sm" status={eu.status} />
          <Menu
            label="Você"
            placement="top-start"
            trigger={
              <button type="button" className={styles.voceNome}>
                {eu.displayName}
              </button>
            }
          >
            <MenuItem
              icon={<Mark size={16} />}
              onSelect={() => onGuardadas?.()}
            >
              Guardadas
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => abrirPerfil('perfil')}>Editar perfil</MenuItem>
            <MenuItem onSelect={() => abrirPerfil('conta')}>Conta e segurança</MenuItem>
          </Menu>
          <div className={styles.controles}>
            <Tooltip label={microfone ? 'Desligar microfone (Ctrl ⇧ M)' : 'Ligar microfone (Ctrl ⇧ M)'}>
              <IconButton
                label={microfone ? 'Desligar microfone' : 'Ligar microfone'}
                size="sm"
                aria-pressed={!microfone}
                className={microfone ? undefined : styles.cortado}
                onClick={() => setMicrofone((v) => !v)}
              >
                {microfone ? <Mic size={16} /> : <MicOff size={16} />}
              </IconButton>
            </Tooltip>
            <Tooltip label={fone ? 'Desligar áudio' : 'Ligar áudio'}>
              <IconButton
                label={fone ? 'Desligar áudio' : 'Ligar áudio'}
                size="sm"
                aria-pressed={!fone}
                className={fone ? undefined : styles.cortado}
                onClick={() => setFone((v) => !v)}
              >
                {fone ? <Headphones size={16} /> : <HeadphonesOff size={16} />}
              </IconButton>
            </Tooltip>
            <Tooltip label="Configurações">
              <IconButton label="Configurações" size="sm">
                <Settings size={16} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EspacoPessoa({
  user,
  indice,
  digitando,
  onSelect,
}: {
  user: User;
  indice: number;
  digitando: boolean;
  onSelect?: (user: User) => void;
}) {
  const estado: EstadoElenco = user.status;
  const rotulo = `${user.displayName}${digitando ? ', digitando' : `, ${estado}`}`;

  // O `onSelect` continua no clique, e o cartão também abre no clique. Não
  // brigam: o cartão é um popover, e quem clica num rosto quer as duas coisas
  // — ir para a pessoa e ver quem ela é.
  return (
    <CartaoDePerfil
      user={user}
      trigger={
        <button
          type="button"
          className={styles.espaco}
          data-estado={estado}
          // 60ms entre cada, da esquerda para a direita.
          style={{ animationDelay: `${indice * 60}ms` }}
          aria-label={rotulo}
          onClick={() => onSelect?.(user)}
        >
          <span className={styles.avatarBox}>
            <Avatar id={user.id} name={user.displayName} src={user.avatarUrl} size="md" />
          </span>
          {digitando ? (
            <span className={styles.pontos} aria-hidden="true">
              <span className={styles.ponto} />
              <span className={styles.ponto} />
              <span className={styles.ponto} />
            </span>
          ) : (
            <span className={styles.nome}>{nomeCurto(user.displayName)}</span>
          )}
        </button>
      }
    />
  );
}
