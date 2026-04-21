use wasm_bindgen::prelude::*;

pub mod preprocess;
pub mod solver;

use preprocess::Params;
use solver::{weight::FaceBox, Solver as GreedySolver, SolverConfig};

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

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct SolverParams {
    pub pin_count: u32,
    pub line_budget: u32,
    pub opacity: f32,
    pub min_chord_skip: u32,
    pub ban_window: u32,
    pub temperature_start: f32,
    pub temperature_end: f32,
    /// Face region in image coordinates. Zero width/height disables face bias.
    pub face_x: f32,
    pub face_y: f32,
    pub face_w: f32,
    pub face_h: f32,
    pub face_emphasis: f32,
}

#[wasm_bindgen]
impl SolverParams {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SolverParams {
        let d = SolverConfig::default();
        SolverParams {
            pin_count: d.pin_count as u32,
            line_budget: d.line_budget,
            opacity: d.opacity,
            min_chord_skip: d.min_chord_skip as u32,
            ban_window: d.ban_window as u32,
            temperature_start: d.temperature_start,
            temperature_end: d.temperature_end,
            face_x: 0.0,
            face_y: 0.0,
            face_w: 0.0,
            face_h: 0.0,
            face_emphasis: 0.0,
        }
    }
}

impl Default for SolverParams {
    fn default() -> Self {
        Self::new()
    }
}

impl From<SolverParams> for SolverConfig {
    fn from(p: SolverParams) -> Self {
        SolverConfig {
            pin_count: p.pin_count.min(u16::MAX as u32) as u16,
            line_budget: p.line_budget,
            opacity: p.opacity,
            min_chord_skip: p.min_chord_skip.min(u16::MAX as u32) as u16,
            ban_window: p.ban_window.min(u16::MAX as u32) as u16,
            temperature_start: p.temperature_start,
            temperature_end: p.temperature_end,
        }
    }
}

/// Streaming string-art solver exposed to JS.
#[wasm_bindgen]
pub struct Solver {
    inner: GreedySolver,
    size: u32,
}

#[wasm_bindgen]
impl Solver {
    #[wasm_bindgen(constructor)]
    pub fn new(
        preprocessed_rgba: &[u8],
        size: u32,
        params: SolverParams,
        seed: u64,
    ) -> Result<Solver, JsValue> {
        let face = if params.face_w > 0.0 && params.face_h > 0.0 {
            Some(FaceBox {
                x: params.face_x,
                y: params.face_y,
                w: params.face_w,
                h: params.face_h,
            })
        } else {
            None
        };
        let inner = GreedySolver::new(
            preprocessed_rgba,
            size as usize,
            params.into(),
            seed,
            face,
            params.face_emphasis,
        )
        .map_err(JsValue::from_str)?;
        Ok(Solver { inner, size })
    }

    /// Advance up to `max` lines. Returns the pin indices reached, in order.
    /// Empty result indicates the solver has finished.
    #[wasm_bindgen(js_name = stepMany)]
    pub fn step_many(&mut self, max: u32) -> Vec<u16> {
        self.inner.step_many(max)
    }

    #[wasm_bindgen(js_name = isDone)]
    pub fn is_done(&self) -> bool {
        self.inner.is_done()
    }

    #[wasm_bindgen(js_name = linesDrawn)]
    pub fn lines_drawn(&self) -> u32 {
        self.inner.lines_drawn()
    }

    #[wasm_bindgen(js_name = lineBudget)]
    pub fn line_budget(&self) -> u32 {
        self.inner.line_budget()
    }

    #[wasm_bindgen(js_name = pinCount)]
    pub fn pin_count(&self) -> u16 {
        self.inner.pin_count()
    }

    /// Returns a flat [x0, y0, x1, y1, ...] array of pin positions in image
    /// coordinates (origin top-left, same resolution as the input buffer).
    #[wasm_bindgen(js_name = pinPositions)]
    pub fn pin_positions(&self) -> Vec<f32> {
        let n = self.inner.pin_count() as usize;
        let mut out = Vec::with_capacity(n * 2);
        for i in 0..n {
            let (x, y) = self.inner.pin_position(i as u16);
            out.push(x);
            out.push(y);
        }
        out
    }

    /// Convenience: the image side length (same as constructor `size`).
    #[wasm_bindgen(js_name = imageSize)]
    pub fn image_size(&self) -> u32 {
        self.size
    }
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
