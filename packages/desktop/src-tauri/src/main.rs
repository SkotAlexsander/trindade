// Sem console no Windows em release: um programa de mesa que abre uma janela
// preta atrás da sua parece defeito.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    trindade_lib::run()
}
