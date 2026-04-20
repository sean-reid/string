use wasm_bindgen::prelude::*;

/// Returns the semantic version of the solver crate.
///
/// A tiny export that confirms the WASM module is reachable from the
/// front-end during Phase 0 bootstrap.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Placeholder for the pin-sequence solver. Real implementation lands in Phase 2.
#[wasm_bindgen]
pub fn solver_ready() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_cargo_pkg() {
        assert_eq!(version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn solver_reports_ready() {
        assert!(solver_ready());
    }
}
