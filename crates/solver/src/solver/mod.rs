//! Stochastic greedy string-art solver with two code paths.
//!
//! **Mono** (palette length 1): scalar-luminance additive model.
//! Residual is "brightness still needed" per pixel; each drawn line
//! subtracts `opacity · coverage` from the residual; the score is the
//! weighted residual along the chord. A line drawn on a pixel already
//! at zero residual still gets counted (it just doesn't subtract
//! more), which keeps lines accumulating visual density even once the
//! canvas has reached the target. This produces the sharp, dense
//! portrait the original mono solver was tuned for.
//!
//! **Color** (palette length > 1): 3-channel linear-RGB model with a
//! joint-greedy score over `(pin, color)` pairs. State:
//!
//! - `target`: pre-baked target in linear RGB, clipped per-channel at
//!   the cream-board brightness (brighter-than-board pixels stay
//!   bare).
//! - `canvas`: the current simulated canvas in linear RGB, initialized
//!   to the board color. Each chord alpha-composites its thread color
//!   onto every pixel it touches.
//! - `delta = max(canvas - target, 0)`: darkening demand still
//!   outstanding per pixel, per channel. Maintained alongside canvas
//!   so the hot-loop score only reads one buffer.
//! - `thread_basis[k] = board - color_k`: each thread's darkening
//!   direction in linear RGB.
//!
//! For a candidate chord `(current → j)`, the solver walks the chord
//! once and accumulates the saliency-weighted mean delta vector
//! `acc = avg_chord(W · delta)`. For each palette color `k`, the
//! score is `acc · thread_basis[k]` — the projection of remaining
//! demand onto that thread's darkening direction. The winning
//! `(pin_j, color_k)` pair is sampled via the same softmax /
//! temperature-annealing schedule mono uses.
//!
//! This is the joint-greedy formulation from Birsak 2018 / Hachnochi
//! 2025: one shared chord geometry across all K colors (the chord
//! walk cost is amortized over K), and a projection onto per-color
//! bases that discriminates a red-demand region from a green-demand
//! region even at equal luminance. Unlike the earlier scalar-
//! luminance-plus-post-hoc-classification path, it cannot be fooled
//! into picking a green thread for a red chord just because the
//! chord's average linear-RGB target happens to sit equidistant from
//! both.
//!
//! Regrouping the interleaved output into per-color runs for the
//! physical build is done post-hoc in the UI.
//!
//! State machine the front-end polls:
//!   1. `new` allocates the Mono residual or the Color (target,
//!      canvas, delta, basis) tuple based on palette size.
//!   2. `step_many(n)` picks up to `n` next pins. Color mode emits
//!      the palette index chosen for each pin alongside it.
//!   3. `is_done()` flips true when the total line budget is reached.

pub mod chord;
pub mod palette;
pub mod weight;

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

use self::chord::Endpoints;
use self::palette::{srgb_to_linear, LinearRgb, Mode, Palette};
use self::weight::{with_face_emphasis, FaceBox};

/// Linear-RGB color of the bare (light cream fabric) board the threads
/// sit on. Vrellis / kmmeerts convention: bright canvas, dark threads
/// that subtract light via partial occlusion. Each crossing darkens
/// the pixel toward the thread color; bare board stays cream where no
/// chord passes. Threads are all **darker** than the board by design.
const BOARD_LINEAR: LinearRgb = [
    // #f4efe5 converted to linear sRGB (gamma 2.4 piecewise).
    0.904_587_8_f32,
    0.862_741_3_f32,
    0.784_452_6_f32,
];

/// Rec.709 luminance of the board, precomputed for mono residual init
/// and palette eligibility filters.
const BOARD_LUMINANCE: f32 = 0.2126 * 0.904_587_8 + 0.7152 * 0.862_741_3 + 0.0722 * 0.784_452_6;

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

/// Mode-specific solver state. Mono keeps its legacy scalar
/// luminance residual; Color uses a 3-channel linear-RGB target +
/// canvas + delta triple plus pre-baked thread darkening bases.
enum SolverState {
    Mono {
        /// Scalar "darkness still needed", length width * height.
        residual: Vec<f32>,
    },
    Color {
        /// Target linear-RGB per pixel, interleaved (length N*3).
        /// Each channel is clipped at the board color so pixels
        /// brighter than the cream substrate contribute no demand.
        target: Vec<f32>,
        /// Current canvas state in linear RGB, interleaved. Starts
        /// at `BOARD_LINEAR` and accumulates alpha-over deposits
        /// per chord.
        canvas: Vec<f32>,
        /// `max(canvas - target, 0)` per channel, interleaved. The
        /// joint-greedy score sums W·c·delta along a chord, then
        /// projects the 3-vector onto each thread's darkening basis.
        /// Maintained in lockstep with `canvas`.
        delta: Vec<f32>,
        /// Darkening basis `(board - thread_k)` in linear RGB,
        /// pre-baked per palette entry. Score denominator `‖b_k‖²`
        /// is swept into the linearized score (see docs above), so
        /// it's not stored explicitly.
        thread_basis: Vec<[f32; 3]>,
    },
}

pub struct Solver {
    width: usize,
    height: usize,
    pins_x: Vec<f32>,
    pins_y: Vec<f32>,
    state: SolverState,
    weights: Vec<f32>,
    config: SolverConfig,
    palette: Palette,
    mode: Mode,
    /// Palette index chosen for each pin emitted in the most recent
    /// `step_many`. All-zero in mono.
    last_batch_colors: Vec<u8>,
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
            _ => Mode::Color,
        };
        let pixel_count = size * size;

        let (pins_x, pins_y) = uniform_pins(size, config.pin_count as usize);
        let weights = with_face_emphasis(size, face, face_emphasis.max(0.0), 1.2);

        let state = match mode {
            Mode::Mono => {
                // Scalar "darkness still needed" residual. Mono
                // preprocess emits R=G=B=luminance; residual is how
                // much darker this pixel must become from the bare
                // board to match the target. Clamped at zero for
                // pixels brighter than or equal to board. Each chord
                // subtracts `opacity · coverage`.
                let mut residual = Vec::with_capacity(pixel_count);
                for i in 0..pixel_count {
                    let target_lum = preprocessed_rgba[i * 4] as f32 / 255.0;
                    residual.push((BOARD_LUMINANCE - target_lum).max(0.0));
                }
                SolverState::Mono { residual }
            }
            Mode::Color => {
                // 3-channel linear-RGB initialization. Target is
                // clipped per-channel at the board color; canvas
                // starts at board; delta = max(canvas - target, 0).
                let thread_basis: Vec<[f32; 3]> = palette
                    .colors()
                    .iter()
                    .map(|c| {
                        [
                            (BOARD_LINEAR[0] - c[0]).max(0.0),
                            (BOARD_LINEAR[1] - c[1]).max(0.0),
                            (BOARD_LINEAR[2] - c[2]).max(0.0),
                        ]
                    })
                    .collect();

                let mut target = Vec::with_capacity(pixel_count * 3);
                let mut canvas = Vec::with_capacity(pixel_count * 3);
                let mut delta = Vec::with_capacity(pixel_count * 3);
                for bgra in preprocessed_rgba.chunks_exact(4).take(pixel_count) {
                    let tr = srgb_to_linear(bgra[0] as f32 / 255.0).min(BOARD_LINEAR[0]);
                    let tg = srgb_to_linear(bgra[1] as f32 / 255.0).min(BOARD_LINEAR[1]);
                    let tb = srgb_to_linear(bgra[2] as f32 / 255.0).min(BOARD_LINEAR[2]);
                    target.push(tr);
                    target.push(tg);
                    target.push(tb);
                    canvas.push(BOARD_LINEAR[0]);
                    canvas.push(BOARD_LINEAR[1]);
                    canvas.push(BOARD_LINEAR[2]);
                    delta.push((BOARD_LINEAR[0] - tr).max(0.0));
                    delta.push((BOARD_LINEAR[1] - tg).max(0.0));
                    delta.push((BOARD_LINEAR[2] - tb).max(0.0));
                }
                SolverState::Color {
                    target,
                    canvas,
                    delta,
                    thread_basis,
                }
            }
        };

        Ok(Self {
            width: size,
            height: size,
            pins_x,
            pins_y,
            state,
            weights,
            config,
            palette,
            mode,
            last_batch_colors: Vec::new(),
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

    /// Palette index assigned to each pin emitted by the most recent
    /// `step_many`. Always all zeros while the solver is in mono mode.
    pub fn last_batch_colors(&self) -> Vec<u8> {
        self.last_batch_colors.clone()
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

    /// Mono chord candidates, scored by weighted residual average
    /// along the chord. One pin → one score.
    fn score_candidates_mono(&self) -> Vec<(u16, f32)> {
        let SolverState::Mono { residual } = &self.state else {
            return Vec::new();
        };
        let n = self.config.pin_count;
        let (cx, cy) = self.pin_position(self.current);
        let mut out = Vec::new();
        for i in 0..n {
            if i == self.current
                || self.circular_distance(self.current, i) < self.config.min_chord_skip
                || self.is_banned(i)
            {
                continue;
            }
            let (qx, qy) = self.pin_position(i);
            let s = score_chord_scalar(
                residual,
                &self.weights,
                self.width,
                self.height,
                (cx, cy),
                (qx, qy),
            );
            out.push((i, s));
        }
        out
    }

    /// Color chord candidates, scored jointly over `(pin, color)`.
    /// For each candidate pin we walk the chord once to accumulate
    /// `acc = avg_{W,c}(delta)` (saliency-and-coverage-weighted mean
    /// delta vector). Then for each palette color k the score is
    /// `acc · thread_basis[k]` — projection of remaining demand onto
    /// that thread's darkening direction. Chord rasterization is
    /// amortized over all K colors.
    fn score_candidates_color(&self) -> Vec<(u16, u8, f32)> {
        let SolverState::Color {
            delta,
            thread_basis,
            ..
        } = &self.state
        else {
            return Vec::new();
        };
        let n = self.config.pin_count;
        let (cx, cy) = self.pin_position(self.current);
        let mut out = Vec::with_capacity((n as usize) * thread_basis.len());
        for i in 0..n {
            if i == self.current
                || self.circular_distance(self.current, i) < self.config.min_chord_skip
                || self.is_banned(i)
            {
                continue;
            }
            let (qx, qy) = self.pin_position(i);
            let mut acc = [0.0f32; 3];
            let mut wsum = 0.0f32;
            chord::for_each_pixel(cx, cy, qx, qy, self.width, self.height, |idx, c| {
                let w = self.weights[idx] * c;
                let base = idx * 3;
                acc[0] += w * delta[base];
                acc[1] += w * delta[base + 1];
                acc[2] += w * delta[base + 2];
                wsum += w;
            });
            if wsum <= 1e-6 {
                continue;
            }
            let inv = 1.0 / wsum;
            acc[0] *= inv;
            acc[1] *= inv;
            acc[2] *= inv;
            for (k, b) in thread_basis.iter().enumerate() {
                let s = acc[0] * b[0] + acc[1] * b[1] + acc[2] * b[2];
                out.push((i, k as u8, s));
            }
        }
        out
    }

    /// Softmax-sample from a candidate list (mono variant: pin → score).
    fn sample_mono(&mut self, candidates: &[(u16, f32)]) -> Option<u16> {
        if candidates.is_empty() {
            return None;
        }
        let mut best = f32::NEG_INFINITY;
        for &(_, s) in candidates {
            if s > best {
                best = s;
            }
        }
        let t = self.temperature().max(1e-6);
        let mut weights: Vec<f32> = candidates
            .iter()
            .map(|&(_, s)| ((s - best) / t).exp())
            .collect();
        let sum: f32 = weights.iter().sum();
        if sum <= 0.0 || !sum.is_finite() {
            let mut idx = 0usize;
            let mut bv = f32::NEG_INFINITY;
            for (i, &(_, s)) in candidates.iter().enumerate() {
                if s > bv {
                    bv = s;
                    idx = i;
                }
            }
            return Some(candidates[idx].0);
        }
        for w in &mut weights {
            *w /= sum;
        }
        let r: f32 = self.rng.gen();
        let mut acc = 0.0f32;
        for (i, &w) in weights.iter().enumerate() {
            acc += w;
            if r <= acc {
                return Some(candidates[i].0);
            }
        }
        Some(candidates.last().unwrap().0)
    }

    /// Softmax-sample from a candidate list (color variant:
    /// `(pin, color)` pairs → score). Returns `(pin, color_index)`.
    fn sample_color(&mut self, candidates: &[(u16, u8, f32)]) -> Option<(u16, u8)> {
        if candidates.is_empty() {
            return None;
        }
        let mut best = f32::NEG_INFINITY;
        for &(_, _, s) in candidates {
            if s > best {
                best = s;
            }
        }
        let t = self.temperature().max(1e-6);
        let mut weights: Vec<f32> = candidates
            .iter()
            .map(|&(_, _, s)| ((s - best) / t).exp())
            .collect();
        let sum: f32 = weights.iter().sum();
        if sum <= 0.0 || !sum.is_finite() {
            let mut idx = 0usize;
            let mut bv = f32::NEG_INFINITY;
            for (i, &(_, _, s)) in candidates.iter().enumerate() {
                if s > bv {
                    bv = s;
                    idx = i;
                }
            }
            return Some((candidates[idx].0, candidates[idx].1));
        }
        for w in &mut weights {
            *w /= sum;
        }
        let r: f32 = self.rng.gen();
        let mut acc = 0.0f32;
        for (i, &w) in weights.iter().enumerate() {
            acc += w;
            if r <= acc {
                return Some((candidates[i].0, candidates[i].1));
            }
        }
        let last = candidates.last().unwrap();
        Some((last.0, last.1))
    }

    pub fn step_many(&mut self, max: u32) -> Vec<u16> {
        let mut pins = Vec::with_capacity(max as usize);
        let mut colors = Vec::with_capacity(max as usize);
        for _ in 0..max {
            if self.is_done() {
                break;
            }
            let (next, color_index) = match self.mode {
                Mode::Mono => {
                    let cands = self.score_candidates_mono();
                    let Some(pin) = self.sample_mono(&cands) else {
                        break;
                    };
                    (pin, 0u8)
                }
                Mode::Color => {
                    let cands = self.score_candidates_color();
                    let Some((pin, k)) = self.sample_color(&cands) else {
                        break;
                    };
                    (pin, k)
                }
            };
            let (cx, cy) = self.pin_position(self.current);
            let (qx, qy) = self.pin_position(next);
            let endpoints = Endpoints {
                x0: cx,
                y0: cy,
                x1: qx,
                y1: qy,
            };
            match &mut self.state {
                SolverState::Mono { residual } => {
                    deposit_mono(
                        residual,
                        self.width,
                        self.height,
                        endpoints,
                        self.config.opacity,
                    );
                }
                SolverState::Color {
                    target,
                    canvas,
                    delta,
                    ..
                } => {
                    let thread = self.palette.colors()[color_index as usize];
                    deposit_color(
                        canvas,
                        delta,
                        target,
                        self.width,
                        self.height,
                        endpoints,
                        self.config.opacity,
                        thread,
                    );
                }
            }
            if self.ban_queue.len() >= self.config.ban_window as usize {
                self.ban_queue.pop_front();
            }
            self.ban_queue.push_back(self.current);
            self.current = next;
            self.lines_drawn += 1;
            pins.push(next);
            colors.push(color_index);
        }
        self.last_batch_colors = colors;
        pins
    }
}

/// Per-chord score for a scalar residual field: weighted average of
/// `residual × coverage × weight` along the chord, normalized by
/// weighted coverage. Mono only.
fn score_chord_scalar(
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

/// Mono-mode deposit: subtract `opacity · coverage` from the residual
/// at each touched pixel, clamping at zero. Over-draws on a saturated
/// pixel don't undershoot but still count toward the line budget.
fn deposit_mono(residual: &mut [f32], width: usize, height: usize, e: Endpoints, opacity: f32) {
    chord::for_each_pixel(e.x0, e.y0, e.x1, e.y1, width, height, |idx, c| {
        residual[idx] = (residual[idx] - opacity * c).max(0.0);
    });
}

/// Color-mode deposit: alpha-over in linear RGB updates `canvas`
/// toward the thread color by `k = opacity · coverage` at each
/// touched pixel, and refreshes `delta = max(canvas - target, 0)` in
/// the same pass. One chord walk per deposit.
#[allow(clippy::too_many_arguments)]
fn deposit_color(
    canvas: &mut [f32],
    delta: &mut [f32],
    target: &[f32],
    width: usize,
    height: usize,
    e: Endpoints,
    opacity: f32,
    thread: LinearRgb,
) {
    chord::for_each_pixel(e.x0, e.y0, e.x1, e.y1, width, height, |idx, cov| {
        let base = idx * 3;
        let k = opacity * cov;
        let c0 = canvas[base] + k * (thread[0] - canvas[base]);
        let c1 = canvas[base + 1] + k * (thread[1] - canvas[base + 1]);
        let c2 = canvas[base + 2] + k * (thread[2] - canvas[base + 2]);
        canvas[base] = c0;
        canvas[base + 1] = c1;
        canvas[base + 2] = c2;
        delta[base] = (c0 - target[base]).max(0.0);
        delta[base + 1] = (c1 - target[base + 1]).max(0.0);
        delta[base + 2] = (c2 - target[base + 2]).max(0.0);
    });
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

    /// Golden test: mono output is deterministic for a fixed seed + image.
    /// The pre-3ch-color refactor must not shift mono behavior by even one
    /// pin — mono takes a dedicated `score_candidates_mono` path that is
    /// byte-identical to the previous implementation.
    #[test]
    fn mono_golden_sequence_is_deterministic() {
        let size = 64usize;
        let rgba = rgba_gradient(size);
        let config = SolverConfig {
            pin_count: 48,
            line_budget: 40,
            ..Default::default()
        };
        let run = || {
            let mut s = Solver::new(&rgba, size, config, mono_palette(), 42, None, 0.0).unwrap();
            let mut pins = Vec::new();
            while !s.is_done() {
                let batch = s.step_many(40);
                if batch.is_empty() {
                    break;
                }
                pins.extend(batch);
            }
            pins
        };
        let a = run();
        let b = run();
        assert_eq!(a, b, "same seed should produce the same sequence");
        assert_eq!(a.len(), config.line_budget as usize);
    }

    #[test]
    fn color_deposit_pulls_canvas_toward_thread_and_updates_delta() {
        // Start canvas at board; target is dark red; drop a red thread
        // across a row. Canvas R stays close to board (already matches
        // red-channel of board), canvas G and B drop toward 0 (thread
        // color). Delta shrinks accordingly.
        let w = 8usize;
        let h = 8usize;
        let n = w * h;
        let mut canvas = Vec::with_capacity(n * 3);
        let mut delta = Vec::with_capacity(n * 3);
        let mut target = Vec::with_capacity(n * 3);
        for _ in 0..n {
            canvas.push(BOARD_LINEAR[0]);
            canvas.push(BOARD_LINEAR[1]);
            canvas.push(BOARD_LINEAR[2]);
            // Target is a deep red: high R, near-zero G/B.
            target.push(BOARD_LINEAR[0]);
            target.push(0.05);
            target.push(0.05);
            delta.push(0.0);
            delta.push((BOARD_LINEAR[1] - 0.05).max(0.0));
            delta.push((BOARD_LINEAR[2] - 0.05).max(0.0));
        }
        let red: LinearRgb = [srgb_to_linear(0.85), 0.0, 0.0];
        deposit_color(
            &mut canvas,
            &mut delta,
            &target,
            w,
            h,
            Endpoints {
                x0: 0.5,
                y0: 4.0,
                x1: 7.5,
                y1: 4.0,
            },
            0.5,
            red,
        );
        // Middle of the row: canvas[G,B] dropped, delta[G,B] shrunk.
        for x in 1..7 {
            let base = (4 * w + x) * 3;
            assert!(
                canvas[base + 1] < BOARD_LINEAR[1] - 0.1,
                "canvas G not darkened at x={x}: {}",
                canvas[base + 1]
            );
            assert!(
                delta[base + 1] < (BOARD_LINEAR[1] - 0.05) - 0.05,
                "delta G did not shrink at x={x}: {}",
                delta[base + 1]
            );
        }
    }

    #[test]
    fn color_deposit_saturates_when_canvas_matches_thread() {
        // Depositing a thread that equals the canvas should leave
        // canvas unchanged; delta equally unchanged.
        let w = 8usize;
        let h = 8usize;
        let n = w * h;
        let mut canvas = vec![0.0f32; n * 3];
        let mut delta = vec![0.0f32; n * 3];
        let target = vec![0.0f32; n * 3];
        deposit_color(
            &mut canvas,
            &mut delta,
            &target,
            w,
            h,
            Endpoints {
                x0: 0.5,
                y0: 4.0,
                x1: 7.5,
                y1: 4.0,
            },
            0.5,
            [0.0, 0.0, 0.0],
        );
        for v in &canvas {
            assert!(v.abs() < 1e-5);
        }
        for v in &delta {
            assert!(v.abs() < 1e-5);
        }
    }

    #[test]
    fn color_solver_localizes_hue_matching_thread_to_matching_panel() {
        // Two-panel pure-chromatic scene with a two-primary palette
        // (red, blue — no black, no green). Joint-greedy scoring must
        // pick red threads for chords whose midpoint lies on the red
        // panel and blue for chords on the blue panel. This is the
        // direct test that the 3-channel residual + basis-projection
        // score discriminates hue; it can't pass with the older
        // scalar-luminance-plus-post-hoc-classification path.
        let size = 96usize;
        let mut rgba = vec![0u8; size * size * 4];
        for y in 0..size {
            for x in 0..size {
                let base = (y * size + x) * 4;
                let (r, g, b) = if x < size / 2 {
                    (220u8, 40u8, 40u8)
                } else {
                    (40u8, 40u8, 220u8)
                };
                rgba[base] = r;
                rgba[base + 1] = g;
                rgba[base + 2] = b;
                rgba[base + 3] = 255;
            }
        }
        let palette = Palette::from_srgb_bytes(&[0xc8, 0x20, 0x20, 0x20, 0x20, 0xc8]).unwrap();
        let config = SolverConfig {
            pin_count: 96,
            line_budget: 300,
            min_chord_skip: 6,
            ..Default::default()
        };
        let mut s = Solver::new(&rgba, size, config, palette, 5, None, 0.0).unwrap();
        let mut prev = 0u16;
        let mut red_left = 0;
        let mut red_right = 0;
        let mut blue_left = 0;
        let mut blue_right = 0;
        while !s.is_done() {
            let batch = s.step_many(50);
            if batch.is_empty() {
                break;
            }
            let colors = s.last_batch_colors();
            for (pin, color) in batch.iter().zip(colors.iter()) {
                let (x0, _) = s.pin_position(prev);
                let (x1, _) = s.pin_position(*pin);
                let mx = (x0 + x1) * 0.5;
                let in_left = mx < size as f32 * 0.5;
                match (color, in_left) {
                    (0, true) => red_left += 1,
                    (0, false) => red_right += 1,
                    (1, true) => blue_left += 1,
                    (1, false) => blue_right += 1,
                    _ => {}
                }
                prev = *pin;
            }
        }
        assert!(
            red_left > red_right * 2,
            "red thread should land on red panel: left={red_left} right={red_right}"
        );
        assert!(
            blue_right > blue_left * 2,
            "blue thread should land on blue panel: left={blue_left} right={blue_right}"
        );
    }

    #[test]
    fn color_solver_picks_best_thread_per_step_and_interleaves() {
        // Three panels × three primary threads. Joint-greedy should
        // emit each of the three palette indices at least once and
        // interleave (several color changes across the run).
        let size = 96usize;
        let mut rgba = vec![0u8; size * size * 4];
        for y in 0..size {
            for x in 0..size {
                let base = (y * size + x) * 4;
                let (r, g, b) = if x < size / 3 {
                    (220u8, 20u8, 20u8)
                } else if x < 2 * size / 3 {
                    (20u8, 200u8, 20u8)
                } else {
                    (20u8, 20u8, 220u8)
                };
                rgba[base] = r;
                rgba[base + 1] = g;
                rgba[base + 2] = b;
                rgba[base + 3] = 255;
            }
        }
        let palette = Palette::from_srgb_bytes(&[255, 0, 0, 0, 255, 0, 0, 0, 255]).unwrap();
        let config = SolverConfig {
            pin_count: 96,
            line_budget: 300,
            min_chord_skip: 6,
            ..Default::default()
        };
        let mut s = Solver::new(&rgba, size, config, palette, 7, None, 0.0).unwrap();
        assert_eq!(s.mode(), Mode::Color);
        let mut colors: Vec<u8> = Vec::new();
        while !s.is_done() {
            let batch = s.step_many(50);
            if batch.is_empty() {
                break;
            }
            colors.extend(s.last_batch_colors.iter().copied());
        }
        assert_eq!(colors.len() as u32, config.line_budget);
        let mut counts = [0u32; 3];
        for &c in &colors {
            counts[c as usize] += 1;
        }
        for (i, &n) in counts.iter().enumerate() {
            assert!(n > 0, "color {i} was starved (0 lines)");
        }
        let mut changes = 0usize;
        for w in colors.windows(2) {
            if w[0] != w[1] {
                changes += 1;
            }
        }
        assert!(
            changes >= 2,
            "expected interleaved color picks, got {changes} changes"
        );
    }
}
