use wasm_bindgen::prelude::*;

pub mod preprocess;

use preprocess::Params;

/// Returns the semantic version of the solver crate.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Placeholder for the pin-sequence solver. Real implementation lands in Phase 2.
#[wasm_bindgen]
pub fn solver_ready() -> bool {
    true
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct PreprocessParams {
    pub bilateral_sigma_color: f32,
    pub bilateral_sigma_space: f32,
    pub clahe_clip: f32,
    pub clahe_tiles: u32,
    pub unsharp_sigma: f32,
    pub unsharp_amount: f32,
    pub gamma: f32,
    pub mask_circular: bool,
}

#[wasm_bindgen]
impl PreprocessParams {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PreprocessParams {
        let defaults = Params::default();
        PreprocessParams {
            bilateral_sigma_color: defaults.bilateral_sigma_color,
            bilateral_sigma_space: defaults.bilateral_sigma_space,
            clahe_clip: defaults.clahe_clip,
            clahe_tiles: defaults.clahe_tiles,
            unsharp_sigma: defaults.unsharp_sigma,
            unsharp_amount: defaults.unsharp_amount,
            gamma: defaults.gamma,
            mask_circular: defaults.mask_circular,
        }
    }
}

impl Default for PreprocessParams {
    fn default() -> Self {
        Self::new()
    }
}

impl From<PreprocessParams> for Params {
    fn from(p: PreprocessParams) -> Self {
        Params {
            bilateral_sigma_color: p.bilateral_sigma_color,
            bilateral_sigma_space: p.bilateral_sigma_space,
            clahe_clip: p.clahe_clip,
            clahe_tiles: p.clahe_tiles,
            unsharp_sigma: p.unsharp_sigma,
            unsharp_amount: p.unsharp_amount,
            gamma: p.gamma,
            mask_circular: p.mask_circular,
        }
    }
}

/// Runs the preprocessing pipeline on an RGBA8 square bitmap and returns a
/// new RGBA8 grayscale bitmap (R=G=B=luminance).
///
/// `rgba` must be exactly `width * height * 4` bytes. The alpha channel on
/// output is always 255.
#[wasm_bindgen]
pub fn preprocess(rgba: &[u8], width: u32, height: u32, params: PreprocessParams) -> Box<[u8]> {
    preprocess::run(rgba, width as usize, height as usize, params.into()).into_boxed_slice()
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

    #[test]
    fn preprocess_accepts_rgba_and_returns_rgba() {
        let w = 16u32;
        let h = 16u32;
        let rgba = vec![128u8; (w * h * 4) as usize];
        let params = PreprocessParams::new();
        let out = preprocess(&rgba, w, h, params);
        assert_eq!(out.len(), (w * h * 4) as usize);
    }
}
