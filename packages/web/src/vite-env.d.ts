/// <reference types="vite/client" />

declare global {
  interface Window {
    /**
     * Onde o Excalidraw procura as próprias fontes.
     *
     * Sem isto ele as busca em `esm.sh`, do navegador de cada pessoa — uma
     * requisição externa que a CSP recusa e que o produto não faz em lugar
     * nenhum. O diretório é preenchido por
     * `packages/web/scripts/fontes-do-quadro.mjs` antes de `dev` e de `build`.
     */
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export {};
