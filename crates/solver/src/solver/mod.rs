//! Stochastic greedy string-art solver.
//!
//! State machine the front-end polls:
//!   1. `new` allocates residual + pin positions from a preprocessed RGBA.
//!   2. `step_many(n)` picks up to `n` next pins; returns their indices
//!      in order drawn. Empty result means the solver is finished.
//!   3. `is_done()` flips true when the line budget is reached.

pub mod chord;
pub mod palette;
pub mod weight;

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

use self::chord::{draw_chord, Endpoints};
use self::palette::{Mode, Palette};
use self::weight::{with_face_emphasis, FaceBox};

#[derive(Clone, Copy, Debug)]
pub struct SolverConfig {
    pub pin_count: u16,
    pub line_budget: u32,
    pub opacity: f32,
    pub min_chord_skip: u16,
    pub ban_window: u16,
    pub temperature_start: f32,
    pub temperature_end: f32,
}

impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            pin_count: 288,
            line_budget: 3500,
            opacity: 0.10,
            min_chord_skip: 12,
            ban_window: 20,
            temperature_start: 0.008,
            temperature_end: 0.0008,
        }
    }
}

pub struct Solver {
    width: usize,
    height: usize,
    pins_x: Vec<f32>,
    pins_y: Vec<f32>,
    residual: Vec<f32>,
    weights: Vec<f32>,
    config: SolverConfig,
    palette: Palette,
    mode: Mode,
    last_batch_len: usize,
    rng: ChaCha8Rng,
    current: u16,
    ban_queue: VecDeque<u16>,
    lines_drawn: u32,
}

impl Solver {
    pub fn new(
        preprocessed_rgba: &[u8],
        size: usize,
        config: SolverConfig,
        palette: Palette,
        seed: u64,
        face: Option<FaceBox>,
        face_emphasis: f32,
    ) -> Result<Self, &'static str> {
        if preprocessed_rgba.len() != size * size * 4 {
            return Err("preprocessed buffer size does not match width*height*4");
        }
        if config.pin_count < 8 {
            return Err("pin_count must be at least 8");
        }
        let mode = match palette.len() {
            0 => return Err("palette must have at least one color"),
            1 => Mode::Mono,
            _ => return Err("multi-color palettes not yet supported (PR 3)"),
        };
        let pixel_count = size * size;
        let mut residual = Vec::with_capacity(pixel_count);
        for i in 0..pixel_count {
            // The canvas is dark wood and the thread is light, so each line
            // adds brightness. Residual tracks brightness still needed at
            // each pixel, starting from the preprocessed luminance.
            let luminance = preprocessed_rgba[i * 4] as f32 / 255.0;
            residual.push(luminance);
        }

        let (pins_x, pins_y) = uniform_pins(size, config.pin_count as usize);
        let weights = with_face_emphasis(size, face, face_emphasis.max(0.0), 1.2);

        Ok(Self {
            width: size,
            height: size,
            pins_x,
            pins_y,
            residual,
            weights,
            config,
            palette,
            mode,
            last_batch_len: 0,
            rng: ChaCha8Rng::seed_from_u64(seed),
            current: 0,
            ban_queue: VecDeque::with_capacity(config.ban_window as usize),
            lines_drawn: 0,
        })
    }

    pub fn palette_size(&self) -> u8 {
        self.palette.len() as u8
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Returns the palette index assigned to each pin in the most recent
    /// `step_many` call. Mono mode always returns a run of zeros.
    pub fn last_batch_colors(&self) -> Vec<u8> {
        vec![0u8; self.last_batch_len]
    }

    pub fn pin_count(&self) -> u16 {
        self.config.pin_count
    }

    pub fn pin_position(&self, index: u16) -> (f32, f32) {
        let i = index as usize;
        (self.pins_x[i], self.pins_y[i])
    }

    pub fn lines_drawn(&self) -> u32 {
        self.lines_drawn
    }

    pub fn line_budget(&self) -> u32 {
        self.config.line_budget
    }

    pub fn is_done(&self) -> bool {
        self.lines_drawn >= self.config.line_budget
    }

    fn temperature(&self) -> f32 {
        let progress = self.lines_drawn as f32 / self.config.line_budget.max(1) as f32;
        let start = self.config.temperature_start;
        let end = self.config.temperature_end;
        start + (end - start) * progress.clamp(0.0, 1.0)
    }

    fn is_banned(&self, pin: u16) -> bool {
        self.ban_queue.iter().any(|&p| p == pin)
    }

    fn circular_distance(&self, a: u16, b: u16) -> u16 {
        let n = self.config.pin_count;
        let d = (a as i32 - b as i32).unsigned_abs() as u16;
        d.min(n - d)
    }

    fn pick_next(&mut self) -> Option<u16> {
        let n = self.config.pin_count;
        let mut scores = Vec::with_capacity(n as usize);
        let mut candidates = Vec::with_capacity(n as usize);
        let (cx, cy) = self.pin_position(self.current);

        let mut best = f32::NEG_INFINITY;
        for i in 0..n {
            if i == self.current
                || self.circular_distance(self.current, i) < self.config.min_chord_skip
                || self.is_banned(i)
            {
                continue;
            }
            let (qx, qy) = self.pin_position(i);
            let s = score_chord_weighted(
                &self.residual,
                &self.weights,
                self.width,
                self.height,
                (cx, cy),
                (qx, qy),
            );
            candidates.push(i);
            scores.push(s);
            if s > best {
                best = s;
            }
        }
        if candidates.is_empty() {
            return None;
        }

        let t = self.temperature().max(1e-6);
        let mut weights: Vec<f32> = scores.iter().map(|&s| ((s - best) / t).exp()).collect();
        let sum: f32 = weights.iter().sum();
        if sum <= 0.0 || !sum.is_finite() {
            // Degenerate: pick argmax.
            let mut idx = 0usize;
            let mut bv = f32::NEG_INFINITY;
            for (i, &s) in scores.iter().enumerate() {
                if s > bv {
                    bv = s;
                    idx = i;
                }
            }
            return Some(candidates[idx]);
        }
        for w in &mut weights {
            *w /= sum;
        }

        let r: f32 = self.rng.gen();
        let mut acc = 0.0f32;
        for (i, &w) in weights.iter().enumerate() {
            acc += w;
            if r <= acc {
                return Some(candidates[i]);
            }
        }
        candidates.last().copied()
    }

    pub fn step_many(&mut self, max: u32) -> Vec<u16> {
        let mut out = Vec::with_capacity(max as usize);
        for _ in 0..max {
            if self.is_done() {
                break;
            }
            let Some(next) = self.pick_next() else {
                break;
            };
            let (cx, cy) = self.pin_position(self.current);
            let (qx, qy) = self.pin_position(next);
            draw_chord(
                &mut self.residual,
                self.width,
                self.height,
                Endpoints {
                    x0: cx,
                    y0: cy,
                    x1: qx,
                    y1: qy,
                },
                self.config.opacity,
            );
            if self.ban_queue.len() >= self.config.ban_window as usize {
                self.ban_queue.pop_front();
            }
            self.ban_queue.push_back(self.current);
            self.current = next;
            self.lines_drawn += 1;
            out.push(next);
        }
        self.last_batch_len = out.len();
        out
    }
}

/// Score a chord weighted per-pixel by an importance map. Falls back to the
/// unweighted score_chord signature semantics when all weights are 1.
fn score_chord_weighted(
    residual: &[f32],
    weights: &[f32],
    width: usize,
    height: usize,
    p0: (f32, f32),
    p1: (f32, f32),
) -> f32 {
    let mut sum = 0.0f32;
    let mut weight_sum = 0.0f32;
    chord::for_each_pixel(p0.0, p0.1, p1.0, p1.1, width, height, |idx, c| {
        let w = weights[idx];
        sum += residual[idx] * c * w;
        weight_sum += c * w;
    });
    if weight_sum > 0.0 {
        sum / weight_sum
    } else {
        0.0
    }
}

fn uniform_pins(size: usize, pin_count: usize) -> (Vec<f32>, Vec<f32>) {
    let cx = (size as f32 - 1.0) * 0.5;
    let cy = (size as f32 - 1.0) * 0.5;
    let radius = ((size as f32) * 0.5) - 1.5;
    let mut xs = Vec::with_capacity(pin_count);
    let mut ys = Vec::with_capacity(pin_count);
    for i in 0..pin_count {
        // Pin 0 at 12 o'clock, numbering clockwise.
        let t = (i as f32 / pin_count as f32) * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
        xs.push(cx + radius * t.cos());
        ys.push(cy + radius * t.sin());
    }
    (xs, ys)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba_gradient(size: usize) -> Vec<u8> {
        let mut v = vec![0u8; size * size * 4];
        for y in 0..size {
            for x in 0..size {
                let g = ((x + y) * 255 / (2 * size)) as u8;
                let base = (y * size + x) * 4;
                v[base] = g;
                v[base + 1] = g;
                v[base + 2] = g;
                v[base + 3] = 255;
            }
        }
        v
    }

    #[test]
    fn pin_positions_ring_around_center() {
        let (xs, ys) = uniform_pins(100, 8);
        let cx = 49.5f32;
        let cy = 49.5f32;
        for (x, y) in xs.iter().zip(ys.iter()) {
            let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            assert!((d - 48.5).abs() < 1.0, "pin distance off: {d}");
        }
        // Pin 0 is at 12 o'clock (y minimal).
        assert!(ys[0] < cy, "pin 0 should be above center");
    }

    fn mono_palette() -> Palette {
        Palette::from_srgb_bytes(&[0xF4, 0xEF, 0xE5]).unwrap()
    }

    #[test]
    fn solver_progresses_and_terminates() {
        let size = 64;
        let rgba = rgba_gradient(size);
        let config = SolverConfig {
            pin_count: 48,
            line_budget: 50,
            ..Default::default()
        };
        let mut solver =
            Solver::new(&rgba, size, config, mono_palette(), 42, None, 0.0).expect("solver init");
        let mut drawn = 0u32;
        while !solver.is_done() {
            let batch = solver.step_many(10);
            if batch.is_empty() {
                break;
            }
            drawn += batch.len() as u32;
            assert_eq!(
                solver.last_batch_colors().len(),
                batch.len(),
                "color batch matches pin batch length"
            );
            assert!(
                solver.last_batch_colors().iter().all(|&c| c == 0),
                "mono mode emits color index 0 for every line"
            );
        }
        assert_eq!(drawn, config.line_budget);
        assert_eq!(solver.lines_drawn(), config.line_budget);
    }

    #[test]
    fn solver_is_seeded_and_deterministic() {
        let size = 64;
        let rgba = rgba_gradient(size);
        let config = SolverConfig {
            pin_count: 48,
            line_budget: 30,
            ..Default::default()
        };
        let run = |seed: u64| -> Vec<u16> {
            let mut s = Solver::new(&rgba, size, config, mono_palette(), seed, None, 0.0).unwrap();
            s.step_many(config.line_budget)
        };
        assert_eq!(run(7), run(7), "same seed should produce same sequence");
        assert_ne!(run(7), run(11), "different seeds should differ");
    }

    #[test]
    fn solver_rejects_multi_color_palettes_for_now() {
        let size = 32;
        let rgba = rgba_gradient(size);
        let palette = Palette::from_srgb_bytes(&[255, 0, 0, 0, 0, 255]).unwrap();
        let result = Solver::new(&rgba, size, SolverConfig::default(), palette, 0, None, 0.0);
        match result {
            Ok(_) => panic!("multi-color palette should be rejected in PR 2"),
            Err(msg) => assert!(msg.contains("PR 3"), "error mentions PR 3 landing: {msg}"),
        }
    }

    /// Golden test: monochrome path is byte-identical to pre-refactor for a
    /// fixed fixture + seed. Guards every later PR against accidentally
    /// changing the legacy behavior.
    #[test]
    fn mono_golden_sequence_matches_vhead() {
        let size = 64usize;
        let rgba = rgba_gradient(size);
        let config = SolverConfig {
            pin_count: 48,
            line_budget: 40,
            ..Default::default()
        };
        let mut s = Solver::new(&rgba, size, config, mono_palette(), 42, None, 0.0).unwrap();
        let mut pins = Vec::new();
        while !s.is_done() {
            let batch = s.step_many(40);
            if batch.is_empty() {
                break;
            }
            pins.extend(batch);
        }
        assert_eq!(pins, GOLDEN_MONO_SEQUENCE_SEED42);
    }

    // Captured against the mono (pre-multi-color) solver at commit
    // feat/solver-palette-plumbing: 64x64 gradient, seed 42, 48 pins, 40 lines.
    // Any change to this sequence must be justified by an intended algorithm
    // change; accidental drift during a refactor is the bug this test catches.
    const GOLDEN_MONO_SEQUENCE_SEED42: &[u16] = &[
        17, 29, 14, 26, 13, 25, 11, 23, 10, 22, 9, 21, 7, 19, 6, 24, 12, 27, 15, 28, 16, 30, 18, 5,
        20, 8, 26, 14, 31, 13, 29, 11, 32, 17, 4, 21, 6, 23, 9, 24,
    ];
}
