//! Independently owned local CAD jobs. Numerical leases and results are separate.
pub(crate) mod commands;
pub(crate) mod worker;
#[derive(Default)]
pub(crate) struct CadState(pub(crate) crate::execution::state::EngineState);
