//! Trindade no Windows.
//!
//! # A decisão que governa este arquivo inteiro
//!
//! **O aplicativo carrega o servidor. Ele não embrulha uma cópia do front.**
//!
//! A tentação é empacotar o `dist` do `@trindade/web` dentro do binário — é o
//! que a maioria dos tutoriais de Tauri mostra. Aqui isso quebraria a sessão, e
//! o motivo é o mesmo que faz o produto ser seguro no navegador: o token de
//! atualização mora num cookie `httpOnly; SameSite=Strict`, preso à origem da
//! API. Com o front rodando em `tauri://localhost`, toda chamada à API viraria
//! *cross-site*, o cookie não seria enviado, e a sessão morreria no primeiro
//! vencimento do token de acesso — quinze minutos depois de entrar, sem
//! mensagem de erro que explicasse.
//!
//! Carregando o servidor direto, tudo continua sendo mesma origem: o desenho de
//! autenticação inteiro segue valendo sem uma linha de exceção, a CSP continua
//! sendo a do Caddy, e o aplicativo nunca fica numa versão diferente da que
//! está publicada.
//!
//! O que se perde é abrir sem rede. Para um produto que é um servidor de
//! conversa, isso não é perda.
//!
//! O que a casca nativa acrescenta — que é o que faz dele um programa e não uma
//! aba — vem nas fatias seguintes: ícone na bandeja, fechar sem encerrar,
//! atalho global de mudo, notificação do sistema e atualização automática.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Abaixo disto o shell do produto vira gaveta, e um programa de mesa que abre
/// em modo telefone parece quebrado.
const LARGURA_MINIMA: f64 = 940.0;
const ALTURA_MINIMA: f64 = 600.0;

#[derive(Debug, Serialize, Deserialize, Default)]
struct Config {
    /// A origem do servidor: `https://trindade.exemplo.com`.
    servidor: Option<String>,
}

fn caminho_da_config(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("servidor.json"))
}

fn ler_config(app: &tauri::AppHandle) -> Config {
    caminho_da_config(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn gravar_config(app: &tauri::AppHandle, config: &Config) -> Result<(), String> {
    let caminho = caminho_da_config(app).ok_or("sem pasta de configuração")?;
    let texto = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(caminho, texto).map_err(|e| e.to_string())
}

/// Aceita só `http` e `https`, e devolve a origem sem caminho.
///
/// O valor vai virar a URL que a janela carrega. Um esquema como `file:` ou
/// `javascript:` aqui seria a porta mais larga que este programa poderia ter.
fn origem_valida(bruto: &str) -> Option<String> {
    let bruto = bruto.trim();
    let texto = if bruto.contains("://") {
        bruto.to_string()
    } else {
        // Quem digita `trindade.exemplo.com` quer https, não um erro.
        format!("https://{bruto}")
    };

    let url = url::Url::parse(&texto).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    url.host_str()?;
    Some(url.origin().ascii_serialization())
}

#[tauri::command]
fn servidor_atual(app: tauri::AppHandle) -> Option<String> {
    ler_config(&app).servidor
}

/// Grava o endereço e leva a janela para ele.
#[tauri::command]
fn definir_servidor(app: tauri::AppHandle, endereco: String) -> Result<String, String> {
    let origem = origem_valida(&endereco).ok_or("endereço inválido")?;
    gravar_config(&app, &Config { servidor: Some(origem.clone()) })?;

    if let Some(janela) = app.get_webview_window("principal") {
        let url = url::Url::parse(&origem).map_err(|e| e.to_string())?;
        janela.navigate(url).map_err(|e| e.to_string())?;
    }
    Ok(origem)
}

/// Volta para a tela de escolher servidor — para trocar de espaço ou quando o
/// endereço guardado deixou de responder.
#[tauri::command]
fn esquecer_servidor(app: tauri::AppHandle) -> Result<(), String> {
    gravar_config(&app, &Config { servidor: None })?;
    if let Some(janela) = app.get_webview_window("principal") {
        janela
            .navigate(url::Url::parse("tauri://localhost/index.html").map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Abrir o programa duas vezes traz a janela que já existe para a
        // frente. Sem isto, dois processos disputam o mesmo cookie e a mesma
        // conexão de WebSocket, e a segunda janela derruba a primeira.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(janela) = app.get_webview_window("principal") {
                let _ = janela.unminimize();
                let _ = janela.show();
                let _ = janela.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            servidor_atual,
            definir_servidor,
            esquecer_servidor
        ])
        .setup(|app| {
            let config = ler_config(app.handle());

            // Com servidor guardado, a janela nasce apontando para ele: quem já
            // configurou não deve ver a tela de configuração nunca mais.
            let destino = match config.servidor.as_deref().and_then(|s| url::Url::parse(s).ok()) {
                Some(url) => WebviewUrl::External(url),
                None => WebviewUrl::App("index.html".into()),
            };

            WebviewWindowBuilder::new(app, "principal", destino)
                .title("Trindade")
                .inner_size(1280.0, 840.0)
                .min_inner_size(LARGURA_MINIMA, ALTURA_MINIMA)
                .center()
                .resizable(true)
                // Tema escuro fixo: o produto não tem tema claro de servidor
                // para acompanhar, e uma janela que nasce clara e escurece
                // quando a página carrega pisca na cara de quem abriu.
                //
                // Isto **não** controla a cor da barra de título no Windows.
                // Quem manda ali é "mostrar cor de destaque nas barras de
                // título" nas configurações do sistema; com ela ligada, toda
                // janela da máquina usa a cor de destaque, e a nossa deve
                // respeitar isso como qualquer outra.
                .theme(Some(tauri::Theme::Dark))
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("o aplicativo não subiu");
}
