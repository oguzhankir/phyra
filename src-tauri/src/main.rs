#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod assistant;
mod cad;
mod execution;
mod platform;
mod project;
mod results;
#[cfg(test)]
mod tests;
mod verification;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|value| value == "--mcp-read-only") {
        if args.len() != 4 {
            eprintln!("Phyra MCP requires its desktop-issued session and consent identities");
            std::process::exit(2);
        }
        if let Err(error) = assistant::mcp::stdio(&args[2], &args[3]) {
            eprintln!("Phyra read-only MCP stopped: {error}");
            std::process::exit(1);
        }
        return;
    }
    application::run();
}
