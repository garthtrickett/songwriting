//! Rig supplies provider contracts; our bounded task runner journals effects
//! through the same Rust session worker as the desktop view.
pub mod audio;
pub mod provider;
pub mod runner;
pub mod runtime;
