/**
 * Ícones no traço da Lucide: 1.5px, `currentColor`, tamanhos 16 / 18 / 20.
 *
 * Desenhados à mão em vez de instalar a biblioteca inteira: uma dependência
 * de 1400 ícones para usar vinte é peso morto no bundle. Quando passarem de
 * trinta, troque por `lucide-react`.
 */
import type { SVGProps } from 'react';

type IconeProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: IconeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const X = (p: IconeProps) => (
  <Base {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Base>
);

export const Check = (p: IconeProps) => (
  <Base {...p}>
    <path d="m20 6-11 11-5-5" />
  </Base>
);

export const ChevronDown = (p: IconeProps) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const Eye = (p: IconeProps) => (
  <Base {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const EyeOff = (p: IconeProps) => (
  <Base {...p}>
    <path d="M10.7 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 13s3.5 7 10 7a9.8 9.8 0 0 0 4.5-1.1" />
    <path d="m2 2 20 20" />
  </Base>
);

export const Trash = (p: IconeProps) => (
  <Base {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Base>
);

export const Sun = (p: IconeProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);

export const Moon = (p: IconeProps) => (
  <Base {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Base>
);

export const Monitor = (p: IconeProps) => (
  <Base {...p}>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Base>
);

export const Hash = (p: IconeProps) => (
  <Base {...p}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </Base>
);

export const Volume = (p: IconeProps) => (
  <Base {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </Base>
);

export const Mic = (p: IconeProps) => (
  <Base {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </Base>
);

/** Barra diagonal, não só a cor: daltonismo. */
export const MicOff = (p: IconeProps) => (
  <Base {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    <path d="m3 3 18 18" />
  </Base>
);

export const Headphones = (p: IconeProps) => (
  <Base {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <path d="M2 16a2 2 0 0 1 2-2h1v6H4a2 2 0 0 1-2-2ZM22 16a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2Z" />
  </Base>
);

export const HeadphonesOff = (p: IconeProps) => (
  <Base {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <path d="M2 16a2 2 0 0 1 2-2h1v6H4a2 2 0 0 1-2-2ZM22 16a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2Z" />
    <path d="m3 3 18 18" />
  </Base>
);

export const Settings = (p: IconeProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
  </Base>
);

export const Search = (p: IconeProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const Pin = (p: IconeProps) => (
  <Base {...p}>
    <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
  </Base>
);

export const Notes = (p: IconeProps) => (
  <Base {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
    <path d="M14 3v6h6M8 13h8M8 17h5" />
  </Base>
);

export const Tasks = (p: IconeProps) => (
  <Base {...p}>
    <path d="M3 6h2l1.5 1.5L9 5M3 12h2l1.5 1.5L9 11M3 18h2l1.5 1.5L9 17M13 6h8M13 12h8M13 18h8" />
  </Base>
);

export const Plus = (p: IconeProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const Grid = (p: IconeProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Base>
);

export const Mark = (p: IconeProps) => (
  <Base {...p} strokeWidth="2">
    <path d="M12 3 4 8v8l8 5 8-5V8l-8-5Z" />
    <path d="M12 12v9M12 12 4 8M12 12l8-4" />
  </Base>
);

export const ChevronLeft = (p: IconeProps) => (
  <Base {...p}>
    <path d="m15 18-6-6 6-6" />
  </Base>
);
