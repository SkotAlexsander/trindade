import { useCallback, useRef, useState } from 'react';
import { create } from 'zustand';
import { Button, Dialog, useToast } from '../../components';
import { useAuth } from '../auth/store';
import { AbaPerfil } from './AbaPerfil';
import { AbaSeguranca } from './AbaSeguranca';
import { AbaNotificacoes } from '../notifications/AbaNotificacoes';
import styles from './perfil.module.css';

/**
 * Editar o próprio perfil.
 *
 * Diálogo, não página: perfil é edição pontual, e tirar a pessoa do contexto
 * para trocar uma bio é desnecessário. Ver design/05-perfil-e-cargos.md.
 */

export type AbaDoPerfil = 'perfil' | 'conta' | 'avisos';

interface DialogoState {
  aberto: boolean;
  aba: AbaDoPerfil;
  abrir: (aba?: AbaDoPerfil) => void;
  fechar: () => void;
}

/**
 * Uma store só, porque o diálogo é aberto de vários lugares — do cartão de
 * perfil, do menu do rodapé, e um dia de um atalho. Passar um `onEditar` por
 * cinco níveis de props para chegar no mesmo diálogo seria pior.
 */
export const useDialogoDePerfil = create<DialogoState>((set) => ({
  aberto: false,
  aba: 'perfil',
  abrir: (aba = 'perfil') => set({ aberto: true, aba }),
  fechar: () => set({ aberto: false }),
}));

export function DialogoDePerfil() {
  const { show } = useToast();
  const aberto = useDialogoDePerfil((s) => s.aberto);
  const aba = useDialogoDePerfil((s) => s.aba);
  const fechar = useDialogoDePerfil((s) => s.fechar);
  const user = useAuth((s) => s.user);

  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const salvarRef = useRef<(() => Promise<void>) | null>(null);

  const registrarSalvar = useCallback((fn: (() => Promise<void>) | null) => {
    salvarRef.current = fn;
  }, []);

  const trocarAba = useDialogoDePerfil((s) => s.abrir);

  const fecharDeVerdade = useCallback(() => {
    setConfirmando(false);
    setSujo(false);
    salvarRef.current = null;
    fechar();
  }, [fechar]);

  /** Fechar com mudança pendente pergunta; sem mudança, fecha direto. */
  const tentarFechar = useCallback(() => {
    if (sujo) setConfirmando(true);
    else fecharDeVerdade();
  }, [sujo, fecharDeVerdade]);

  async function salvar(): Promise<void> {
    const fn = salvarRef.current;
    if (!fn) return;
    setSalvando(true);
    try {
      await fn();
      show('Perfil salvo.', 'info');
      fecharDeVerdade();
    } catch {
      show('Não consegui salvar o perfil.', 'danger');
    } finally {
      setSalvando(false);
    }
  }

  if (!user) return null;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        if (!proximo) tentarFechar();
      }}
      title="Seu perfil"
      footer={
        aba === 'perfil' ? (
          <>
            <Button variant="ghost" onClick={tentarFechar}>
              Cancelar
            </Button>
            {/* Salvar desabilitado sem alteração: um botão que não faz nada
                ainda parece que faz. */}
            <Button disabled={!sujo || salvando} onClick={() => void salvar()}>
              Salvar
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={tentarFechar}>
            Fechar
          </Button>
        )
      }
    >
      <div className={styles.abas} role="tablist" aria-label="Seções do perfil">
        {(
          [
            ['perfil', 'Perfil'],
            ['avisos', 'Notificações'],
            ['conta', 'Conta e segurança'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            className={styles.abaBotao}
            data-ativa={aba === chave}
            onClick={() => trocarAba(chave)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {/* As duas abas ficam montadas, e a inativa apenas escondida. Trocar de
          aba desmontando descartaria em silêncio o que já estava escrito no
          campo — e é justamente esse estado que o aviso de "alterações não
          salvas" existe para proteger. */}
      <div hidden={aba !== 'perfil'}>
        <AbaPerfil
          // A chave amarra o estado dos campos ao usuário: trocar de conta na
          // mesma aba deixaria os campos com os dados de quem saiu.
          key={user.id}
          user={user}
          onSujo={setSujo}
          registrarSalvar={registrarSalvar}
        />
      </div>
      <div hidden={aba !== 'avisos'}>
        <AbaNotificacoes />
      </div>
      <div hidden={aba !== 'conta'}>
        <AbaSeguranca />
      </div>

      {confirmando ? (
        <div className={styles.confirmarSaida} role="alertdialog" aria-label="Descartar alterações">
          <p>Você tem alterações não salvas.</p>
          <div className={styles.acoesFoto}>
            <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)}>
              Continuar editando
            </Button>
            <Button variant="danger" size="sm" onClick={fecharDeVerdade}>
              Descartar
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
