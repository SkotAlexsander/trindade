import { create } from 'zustand';

/**
 * O diálogo de convite é aberto de dois lugares — do menu do servidor e da
 * página de pessoas — e é sempre o mesmo. Uma store evita passar um `onAbrir`
 * por níveis de props até chegar no mesmo componente.
 */
interface ConviteState {
  aberto: boolean;
  abrir: () => void;
  fechar: () => void;
}

export const useDialogoDeConvite = create<ConviteState>((set) => ({
  aberto: false,
  abrir: () => set({ aberto: true }),
  fechar: () => set({ aberto: false }),
}));
