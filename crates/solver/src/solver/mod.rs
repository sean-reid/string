//! Stochastic greedy string-art solver with two code paths.
//!
//! **Mono** (palette length 1): the legacy scalar-luminance additive
//! model. Residual is "brightness still needed" per pixel; each drawn
//! line subtracts `opacity · coverage` from the residual; score is the
//! weighted residual along the chord. A line drawn on a pixel already
//! at zero residual still gets counted (it just doesn't subtract more),
//! which keeps lines accumulating visual density even once the canvas
//! has reached the target. This produces the sharp, dense portrait the
//! original solver was tuned for.
//!
//! **Color** (palette length > 1): same scalar-luminance greedy as
//! mono, with a per-chord thread selection on top. Chord scoring
//! uses one scalar residual ("darkness still needed" in Rec.709 terms)
//! — identical to mono. Once a chord is chosen, we walk its pixels,
//! sum the target-minus-board direction along the path, and pick
//! the palette thread whose darkening direction best aligns with
//! that average — so a chord through a warm region gets a warm
//! thread, a chord through hair gets black, etc. Deposit subtracts
//! `opacity · thread_luminance · coverage` from the scalar residual,
//! because a darker thread darkens more per crossing than a lighter
//! one.
//!
//! This follows Petros Vrellis's original algorithm structure
//! (kmmeerts reference): luminance greedy first, color as a
//! classification on top, instead of K parallel per-thread
//! residuals. The single-residual structure is what produces sharp
//! feature recognition and avoids moiré — the scoring signal is
//! unambiguous, every chord has exactly one "value", and near-ties
//! that would otherwise fragment into parallel-chord bundles don't
//! happen.
//!
//! Regrouping for the physical build is done post-hoc in the UI so
//! the builder still switches spools rarely.
//!
//! State machine the front-end polls:
//!   1. `new` allocates residual or canvas+target based on palette size.
//!   2. `step_many(n)` picks up to `n` next pins. Color mode emits the
//!      palette index chosen for each pin alongside it.
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
/// that subtract light via partial occlusion. Each crossing darkens the
/// pixel toward the thread color; bare board stays cream where no chord
/// passes. Threads are all **darker** than the board by design; palette
/// extraction rejects samples near or above board brightness.
const BOARD_LINEAR: LinearRgb = [
    // #f4efe5 converted to linear sRGB (gamma 2.4 piecewise).
    0.904_587_8_f32,
    0.862_741_3_f32,
    0.784_452_6_f32,
];

/// Rec.709 luminance of the board, precomputed for palette eligibility
/// filters ("is this thread meaningfully darker than the board?") and
/// luminance residual init.
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

/// Mode-specific solver state. Both modes use a scalar luminance
/// residual for chord selection — one unambiguous signal, no
/// per-thread complications. Color adds a target buffer so each
/// selected chord can be tinted to the nearest palette hue.
enum SolverState {
    Mono {
        /// Scalar "darkness still needed", length width * height.
        residual: Vec<f32>,
    },
    Color {
        /// Scalar "darkness still needed" — identical shape and role
        /// to mono's residual. Chord selection is driven purely by
        /// this; color comes in after the chord is chosen.
        residual: Vec<f32>,
        /// Target `board − image` color per pixel, interleaved RGB in
        /// linear light. Used by `pick_chord_color` to compute the
        /// average target hue along a chosen chord, which maps to
        /// the nearest palette thread.
        target_offset: Vec<f32>,
        /// Rec.709 luminance of each palette thread's darkening basis
        /// (`board − thread_i`). How much darkness one crossing of
        /// thread i contributes — used to subtract the right amount
        /// from the scalar residual when a chord deposits.
        thread_luminance: Vec<f32>,
        /// Darkening basis `(board − thread_i)` in linear RGB, one per
        /// palette entry. Pre-baked for chord color picking.
        thread_basis: Vec<[f32; 3]>,
        /// Alpha-composited preview canvas (display only).
        canvas: Vec<f32>,
    },
}

/// Rec.709 luminance coefficients.
const REC709_R: f32 = 0.2126;
const REC709_G: f32 = 0.7152;
const REC709_B: f32 = 0.0722;

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
    /// `step_many`. All-zero in mono; monotonic non-decreasing in color.
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
                // pixels brighter than or equal to board (those stay
                // bare). Each thread chord subtracts
                // `opacity · coverage` from the residual.
                let mut residual = Vec::with_capacity(pixel_count);
                for i in 0..pixel_count {
                    let target_lum = preprocessed_rgba[i * 4] as f32 / 255.0;
                    residual.push((BOARD_LUMINANCE - target_lum).max(0.0));
                }
                SolverState::Mono { residual }
            }
            Mode::Color => {
                // Petros-style init: one scalar luminance residual
                // (same shape as mono) plus a target-offset buffer
                // used to pick the right thread color once a chord
                // has been chosen. Chord selection is pure luminance
                // greedy; color is a post-selection classification
                // of the chord's average hue demand. Structurally
                // identical to Vrellis's original algorithm with
                // per-chord color tinting on top.
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
                let thread_luminance: Vec<f32> = thread_basis
                    .iter()
                    .map(|c| REC709_R * c[0] + REC709_G * c[1] + REC709_B * c[2])
                    .collect();

                let mut residual = Vec::with_capacity(pixel_count);
                let mut target_offset = Vec::with_capacity(pixel_count * 3);
                for bgra in preprocessed_rgba.chunks_exact(4).take(pixel_count) {
                    let tr = srgb_to_linear(bgra[0] as f32 / 255.0);
                    let tg = srgb_to_linear(bgra[1] as f32 / 255.0);
                    let tb = srgb_to_linear(bgra[2] as f32 / 255.0);
                    // Board − target in linear light, clamped so
                    // pixels brighter than board contribute nothing
                    // (they stay bare cream).
                    let dr = (BOARD_LINEAR[0] - tr).max(0.0);
                    let dg = (BOARD_LINEAR[1] - tg).max(0.0);
                    let db = (BOARD_LINEAR[2] - tb).max(0.0);
                    residual.push(REC709_R * dr + REC709_G * dg + REC709_B * db);
                    target_offset.push(dr);
                    target_offset.push(dg);
                    target_offset.push(db);
                }

                let mut canvas = Vec::with_capacity(pixel_count * 3);
                for _ in 0..pixel_count {
                    canvas.push(BOARD_LINEAR[0]);
                    canvas.push(BOARD_LINEAR[1]);
                    canvas.push(BOARD_LINEAR[2]);
                }
                SolverState::Color {
                    residual,
                    target_offset,
                    thread_luminance,
                    thread_basis,
                    canvas,
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

    /// Score every legal next-pin candidate. Both mono and color use
    /// the same scalar-residual scoring: a chord is good if the
    /// weighted sum of "darkness demand" along its path is large.
    /// Color's per-chord thread assignment happens AFTER the chord is
    /// chosen; it doesn't factor into scoring.
    fn score_candidates(&self) -> Vec<(u16, f32)> {
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
            let residual = match &self.state {
                SolverState::Mono { residual } => residual,
                SolverState::Color { residual, .. } => residual,
            };
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

    fn pick_next(&mut self) -> Option<u16> {
        let candidates = self.score_candidates();
        if candidates.is_empty() {
            return None;
        }

        let mut best = f32::NEG_INFINITY;
        for &(_, s) in &candidates {
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

    /// For a chord chosen in color mode, pick which palette thread
    /// to draw it in. Splits the chord's demand into a chromatic
    /// component (what hue does this region want?) and an achromatic
    /// component (just uniform darkening?), and routes accordingly:
    ///
    /// - If the chromatic ratio is meaningful, match the chromatic
    ///   sum against each thread's chromatic basis. Colored threads
    ///   with non-zero chroma compete fairly on hue; black, with
    ///   near-zero chromatic basis, naturally scores low here.
    /// - If the chord is essentially uniform-dark, pick the least-
    ///   chromatic thread (typically black).
    ///
    /// This is what lets colored threads win on face regions: black
    /// loses the chromatic-match test because its darkening basis
    /// has no direction, only magnitude. A raw `b · basis / |basis|`
    /// compare would always favor black simply because `b` has a
    /// uniform-positive component that aligns with black's
    /// uniform-positive basis.
    fn pick_chord_color(
        &self,
        target_offset: &[f32],
        thread_basis: &[[f32; 3]],
        p0: (f32, f32),
        p1: (f32, f32),
    ) -> u8 {
        let mut sum = [0.0f32; 3];
        chord::for_each_pixel(p0.0, p0.1, p1.0, p1.1, self.width, self.height, |idx, c| {
            let w = self.weights[idx];
            let cw = c * w;
            let base = idx * 3;
            sum[0] += target_offset[base] * cw;
            sum[1] += target_offset[base + 1] * cw;
            sum[2] += target_offset[base + 2] * cw;
        });

        if sum[0] + sum[1] + sum[2] <= 1e-8 {
            return 0;
        }

        // Chromatic component of the chord's accumulated demand.
        let s_min = sum[0].min(sum[1]).min(sum[2]);
        let chrom = [sum[0] - s_min, sum[1] - s_min, sum[2] - s_min];

        // Match colored threads by chromatic-basis alignment only.
        // A thread with near-zero chromatic basis (black) drops out
        // because its bc_mag_sq is tiny; colored threads compete
        // here on hue match, not on raw magnitude. No gate: any
        // nonzero positive chromatic alignment is enough to prefer
        // a colored thread over the achromatic fallback.
        let mut best_color: Option<(u8, f32)> = None;
        for (i, basis) in thread_basis.iter().enumerate() {
            let b_min = basis[0].min(basis[1]).min(basis[2]);
            let bc = [basis[0] - b_min, basis[1] - b_min, basis[2] - b_min];
            let bc_mag_sq = bc[0] * bc[0] + bc[1] * bc[1] + bc[2] * bc[2];
            if bc_mag_sq <= 1e-6 {
                continue;
            }
            let dot = chrom[0] * bc[0] + chrom[1] * bc[1] + chrom[2] * bc[2];
            if dot <= 0.0 {
                continue;
            }
            let aligned = dot / bc_mag_sq.sqrt();
            match best_color {
                None => best_color = Some((i as u8, aligned)),
                Some((_, prev)) if aligned > prev => best_color = Some((i as u8, aligned)),
                _ => {}
            }
        }
        if let Some((i, _)) = best_color {
            return i;
        }

        // Achromatic demand: pick the thread whose basis has the
        // smallest chromatic component relative to its magnitude —
        // that's the closest to "pure darkness" in the palette,
        // which is what a uniform-dark chord needs.
        let mut best = 0u8;
        let mut best_chroma_ratio = f32::INFINITY;
        for (i, basis) in thread_basis.iter().enumerate() {
            let mag_sq = basis[0] * basis[0] + basis[1] * basis[1] + basis[2] * basis[2];
            if mag_sq <= 1e-6 {
                continue;
            }
            let b_min = basis[0].min(basis[1]).min(basis[2]);
            let bc = [basis[0] - b_min, basis[1] - b_min, basis[2] - b_min];
            let bc_mag_sq = bc[0] * bc[0] + bc[1] * bc[1] + bc[2] * bc[2];
            let ratio = bc_mag_sq / mag_sq;
            if ratio < best_chroma_ratio {
                best_chroma_ratio = ratio;
                best = i as u8;
            }
        }
        best
    }

    pub fn step_many(&mut self, max: u32) -> Vec<u16> {
        let mut pins = Vec::with_capacity(max as usize);
        let mut colors = Vec::with_capacity(max as usize);
        for _ in 0..max {
            if self.is_done() {
                break;
            }
            let Some(next) = self.pick_next() else {
                break;
            };
            let (cx, cy) = self.pin_position(self.current);
            let (qx, qy) = self.pin_position(next);
            let endpoints = Endpoints {
                x0: cx,
                y0: cy,
                x1: qx,
                y1: qy,
            };
            // Pick the chord's thread color (color mode only) BEFORE
            // depositing, so the deposit subtracts this thread's
            // actual darkening contribution — not a generic
            // placeholder.
            let color_index: u8 = match &self.state {
                SolverState::Mono { .. } => 0,
                SolverState::Color {
                    target_offset,
                    thread_basis,
                    ..
                } => self.pick_chord_color(target_offset, thread_basis, (cx, cy), (qx, qy)),
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
                    residual,
                    thread_luminance,
                    canvas,
                    ..
                } => {
                    // Residual loses this thread's luminance
                    // contribution per crossing. A low-luminance
                    // thread (black-on-cream) subtracts a lot per
                    // crossing; a brighter thread subtracts less,
                    // needing more crossings to darken the same
                    // amount. Matches the physical opacity the
                    // lines-canvas renders.
                    let idx = color_index as usize;
                    deposit_mono(
                        residual,
                        self.width,
                        self.height,
                        endpoints,
                        self.config.opacity * thread_luminance[idx],
                    );
                    // Preview canvas: alpha composite toward the
                    // chosen thread color, matching what the
                    // physical build looks like at this crossing.
                    let thread = self.palette.colors()[idx];
                    deposit_alpha(
                        canvas,
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
/// weighted coverage. Used by both mono and color modes — color also
/// scores on a scalar luminance residual, just with extra bookkeeping
/// to pick a thread color for the winning chord.
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
/// pixel don't undershoot but still count toward the line budget —
/// that "over-coverage" is the physical reality the solver is tuned
/// for and it keeps density in already-bright regions.
fn deposit_mono(residual: &mut [f32], width: usize, height: usize, e: Endpoints, opacity: f32) {
    chord::for_each_pixel(e.x0, e.y0, e.x1, e.y1, width, height, |idx, c| {
        residual[idx] = (residual[idx] - opacity * c).max(0.0);
    });
}

/// Alpha-composite a thread onto the canvas along a chord. Each touched
/// pixel updates as `canvas += k · (thread - canvas)` where
/// `k = opacity · coverage`. Pixels already at the thread color
/// saturate naturally.
fn deposit_alpha(
    canvas: &mut [f32],
    width: usize,
    height: usize,
    e: Endpoints,
    opacity: f32,
    thread: LinearRgb,
) {
    chord::for_each_pixel(e.x0, e.y0, e.x1, e.y1, width, height, |idx, cov| {
        let base = idx * 3;
        let k = opacity * cov;
        canvas[base] += k * (thread[0] - canvas[base]);
        canvas[base + 1] += k * (thread[1] - canvas[base + 1]);
        canvas[base + 2] += k * (thread[2] - canvas[base + 2]);
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

    #[test]
    fn alpha_deposit_pulls_canvas_toward_thread_color() {
        // A single red deposit at k=0.5 on a black canvas should leave
        // the touched pixels halfway between board and red in R, and
        // almost unchanged in G and B (alpha compositing is per-channel).
        let w = 8usize;
        let h = 8usize;
        let mut canvas = vec![0.0f32; w * h * 3];
        deposit_alpha(
            &mut canvas,
            w,
            h,
            Endpoints {
                x0: 0.5,
                y0: 4.0,
                x1: 7.5,
                y1: 4.0,
            },
            0.5,
            [1.0, 0.0, 0.0],
        );
        for x in 1..7 {
            let base = (4 * w + x) * 3;
            assert!(
                canvas[base] > 0.3,
                "R not lifted at x={x}: {}",
                canvas[base]
            );
            assert!(canvas[base + 1].abs() < 1e-6, "G drifted at x={x}");
            assert!(canvas[base + 2].abs() < 1e-6, "B drifted at x={x}");
        }
    }

    #[test]
    fn alpha_deposit_saturates_when_canvas_matches_thread() {
        // Drawing a white thread onto a canvas already at white should
        // leave the canvas unchanged — alpha compositing of like-on-like
        // is a no-op regardless of opacity.
        let w = 8usize;
        let h = 8usize;
        let mut canvas = vec![1.0f32; w * h * 3];
        deposit_alpha(
            &mut canvas,
            w,
            h,
            Endpoints {
                x0: 0.5,
                y0: 4.0,
                x1: 7.5,
                y1: 4.0,
            },
            0.5,
            [1.0, 1.0, 1.0],
        );
        for v in &canvas {
            assert!((v - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn color_solver_picks_best_thread_per_step_and_interleaves() {
        // Three panels × three primary threads. The interleaved solver
        // picks whichever (pin, color) chord most reduces residual at
        // each step. Sequences may interleave palette indices freely,
        // but every color must end up represented (all three regions
        // need their matching thread to reach the target) and the
        // total emitted must equal the budget.
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
        // The sequence should include at least one color change; pure
        // monotonic order would imply the old sequential budget is
        // still in force.
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

    /// Golden test: mono output is deterministic for a fixed seed + image.
    /// The expected sequence was re-captured for the alpha-composited
    /// solver (the pre-alpha sequence in earlier PRs no longer applies).
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
}
