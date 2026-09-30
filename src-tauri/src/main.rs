#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod application;
mod execution;
mod platform;
mod project;
mod results;
#[cfg(test)]
mod tests;
mod verification;

fn main() {
    application::run();
}
