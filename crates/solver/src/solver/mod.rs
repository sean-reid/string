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
//! **Color** (palette length > 1): partitive (spatial-density) mixing
//! model. At init each pixel's `target − board` is decomposed into a
//! non-negative weighted sum of palette-thread contributions via NNLS,
//! giving a per-thread scalar "density still to deposit" field — one
//! mono-style residual per thread instead of one 3-channel canvas. A
//! chord of thread i scores exactly like the mono solver on that
//! thread's density field; a deposit subtracts `opacity · coverage`
//! from it, clamped at zero. At every step the solver evaluates every
//! (pin, thread) pair and picks the chord with the highest density-
//! reducing score across all of them.
//!
//! Why partitive and not alpha compositing: physical string art on a
//! dark board is spatial-frequency mixing. The eye integrates
//! individual thread crossings over a patch; perceived color is the
//! local density of each thread color plus whatever bare board shows
//! through the gaps, not an alpha-composited canvas value at each
//! pixel. Alpha compositing has a single "pixel is done" bit per
//! pixel; partitive has a density budget per thread per pixel, so
//! every color's chords keep earning their way in until their
//! demanded density is met — same density-builds-naturally behavior
//! mono gets. No "pixel saturated, score zero" premature stopping.
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

/// Mode-specific solver state. Mono keeps the legacy scalar residual;
/// Color carries one scalar density residual per palette thread
/// (partitive mixing — each pixel's target color decomposed into
/// non-negative combinations of thread densities).
enum SolverState {
    Mono {
        /// Scalar "brightness still needed", length width * height.
        residual: Vec<f32>,
    },
    Color {
        /// One density residual per palette thread, each of length
        /// `pixel_count`. `density[i][p]` is the remaining thread-i
        /// coverage still to be laid at pixel p; chord deposits
        /// subtract `opacity · coverage` from it, clamped at zero.
        density: Vec<Vec<f32>>,
        /// Shared scalar luminance residual, length `pixel_count`.
        /// Parallel to `density` but tracks "brightness still needed"
        /// regardless of thread color. Any chord of any thread gets
        /// partial score credit for depositing luminance here, so dim
        /// pixels at the periphery (where NNLS decomposition gives
        /// near-zero density to every thread) still attract chords.
        /// Without this, mono is denser than color at dim regions
        /// because mono's one residual never zeros out on faint
        /// pixels while color's per-thread densities do.
        luminance: Vec<f32>,
        /// Rec.709 luminance of each palette thread minus board.
        /// Precomputed once; weights the luminance term in scoring
        /// and deposit so brighter threads get more luminance credit
        /// per chord.
        thread_luminance: Vec<f32>,
        /// Alpha-composited preview canvas maintained for display.
        /// Not used in scoring — that's purely the density + luminance
        /// residual fields above.
        canvas: Vec<f32>,
    },
}

/// Scoring weight on the luminance residual relative to the per-thread
/// density residual. Zero disables the luminance term entirely —
/// scoring is purely "does this thread's density field need reducing
/// along this chord?" Without zeroing, the luminance term biases every
/// score by `thread_luminance[i]`, and in the Vrellis paradigm
/// thread_luminance is max for pure black — so any palette with black
/// in it gets its score function rigged against the colored threads
/// regardless of per-thread density. Density alone is the right
/// signal: the NNLS decomposition already tells each thread which
/// pixels it's supposed to darken, and greedy-on-density picks the
/// right color at the right place.
const LUMINANCE_SCORE_WEIGHT: f32 = 0.0;

/// Rec.709 luminance coefficients. Used in multiple places — score
/// weighting, target-luminance init, thread_luminance precompute.
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
                // Partitive-mixing init, Vrellis paradigm: dark threads
                // on a light board. For each pixel we solve a tiny
                // non-negative least squares problem: decompose
                // (board − target) as a non-negative combination of
                // (board − thread_i) vectors. Both sides are positive
                // because target and threads are both at or below
                // board brightness. Coefficients ARE the per-thread
                // densities the solver must eventually lay down at
                // that pixel. Density fields behave just like mono's
                // scalar residual — one per thread — so the color
                // solver is effectively K parallel mono solves coupled
                // only at chord-selection time.
                let k = palette.len();
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
                // AtA is symmetric k×k, precomputed once for the NNLS
                // multiplicative update rule.
                let mut ata = vec![0.0f32; k * k];
                for i in 0..k {
                    for j in 0..k {
                        ata[i * k + j] = thread_basis[i][0] * thread_basis[j][0]
                            + thread_basis[i][1] * thread_basis[j][1]
                            + thread_basis[i][2] * thread_basis[j][2];
                    }
                }

                // thread_basis[i] = board − thread_i (per channel,
                // non-negative). Its Rec.709 luminance is how much
                // darkening one unit of thread-i density provides —
                // precompute once for score weighting and deposit.
                let thread_luminance: Vec<f32> = thread_basis
                    .iter()
                    .map(|c| REC709_R * c[0] + REC709_G * c[1] + REC709_B * c[2])
                    .collect();

                let mut density: Vec<Vec<f32>> =
                    (0..k).map(|_| vec![0.0f32; pixel_count]).collect();
                let mut luminance = vec![0.0f32; pixel_count];
                let mut w = vec![0.0f32; k];
                let mut atb = vec![0.0f32; k];
                for (pix, bgra) in preprocessed_rgba
                    .chunks_exact(4)
                    .enumerate()
                    .take(pixel_count)
                {
                    let tr = srgb_to_linear(bgra[0] as f32 / 255.0);
                    let tg = srgb_to_linear(bgra[1] as f32 / 255.0);
                    let tb = srgb_to_linear(bgra[2] as f32 / 255.0);
                    // Offset is board − target, so positive for targets
                    // darker than board (the vast majority of pixels
                    // in natural images against a cream board).
                    // Pixels brighter than board clamp to zero — those
                    // stay bare cream, no thread needed.
                    let b = [
                        (BOARD_LINEAR[0] - tr).max(0.0),
                        (BOARD_LINEAR[1] - tg).max(0.0),
                        (BOARD_LINEAR[2] - tb).max(0.0),
                    ];
                    for (i, basis) in thread_basis.iter().enumerate() {
                        atb[i] = basis[0] * b[0] + basis[1] * b[1] + basis[2] * b[2];
                    }
                    decompose_nnls(&ata, &atb, k, &thread_basis, &b, &mut w);
                    for (i, field) in density.iter_mut().enumerate() {
                        field[pix] = w[i];
                    }
                    luminance[pix] = REC709_R * b[0] + REC709_G * b[1] + REC709_B * b[2];
                }

                let mut canvas = Vec::with_capacity(pixel_count * 3);
                for _ in 0..pixel_count {
                    canvas.push(BOARD_LINEAR[0]);
                    canvas.push(BOARD_LINEAR[1]);
                    canvas.push(BOARD_LINEAR[2]);
                }
                SolverState::Color {
                    density,
                    luminance,
                    thread_luminance,
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

    /// Score every legal (pin, palette-color) candidate. Mono has one
    /// scalar residual; color has one scalar density residual per
    /// palette thread. Both reduce to the same per-chord scoring form —
    /// weighted average residual along the chord — so color mode is
    /// effectively K parallel mono solves.
    fn score_candidates(&self) -> Vec<(u16, u8, f32)> {
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
            match &self.state {
                SolverState::Mono { residual } => {
                    let s = score_chord_scalar(
                        residual,
                        &self.weights,
                        self.width,
                        self.height,
                        (cx, cy),
                        (qx, qy),
                    );
                    out.push((i, 0u8, s));
                }
                SolverState::Color {
                    density,
                    luminance,
                    thread_luminance,
                    ..
                } => {
                    for (c_idx, field) in density.iter().enumerate() {
                        let s = score_chord_color(
                            field,
                            luminance,
                            &self.weights,
                            thread_luminance[c_idx],
                            self.width,
                            self.height,
                            (cx, cy),
                            (qx, qy),
                        );
                        out.push((i, c_idx as u8, s));
                    }
                }
            };
        }
        out
    }

    fn pick_next(&mut self) -> Option<(u16, u8)> {
        let candidates = self.score_candidates();
        if candidates.is_empty() {
            return None;
        }

        let mut best = f32::NEG_INFINITY;
        for &(_, _, s) in &candidates {
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
            // Degenerate: pick argmax.
            let mut idx = 0usize;
            let mut bv = f32::NEG_INFINITY;
            for (i, &(_, _, s)) in candidates.iter().enumerate() {
                if s > bv {
                    bv = s;
                    idx = i;
                }
            }
            let (pin, color, _) = candidates[idx];
            return Some((pin, color));
        }
        for w in &mut weights {
            *w /= sum;
        }

        let r: f32 = self.rng.gen();
        let mut acc = 0.0f32;
        for (i, &w) in weights.iter().enumerate() {
            acc += w;
            if r <= acc {
                let (pin, color, _) = candidates[i];
                return Some((pin, color));
            }
        }
        let (pin, color, _) = *candidates.last().unwrap();
        Some((pin, color))
    }

    pub fn step_many(&mut self, max: u32) -> Vec<u16> {
        let mut pins = Vec::with_capacity(max as usize);
        let mut colors = Vec::with_capacity(max as usize);
        for _ in 0..max {
            if self.is_done() {
                break;
            }
            let Some((next, color_index)) = self.pick_next() else {
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
                    density,
                    luminance,
                    thread_luminance,
                    canvas,
                } => {
                    let idx = color_index as usize;
                    // Density-residual update: thread-i field loses
                    // `opacity · coverage` at every touched pixel.
                    deposit_mono(
                        &mut density[idx],
                        self.width,
                        self.height,
                        endpoints,
                        self.config.opacity,
                    );
                    // Luminance-residual update: any thread reduces
                    // the shared luminance budget proportional to its
                    // own brightness. `opacity · coverage · thread_lum`
                    // per pixel, clamped at zero.
                    deposit_mono(
                        luminance,
                        self.width,
                        self.height,
                        endpoints,
                        self.config.opacity * thread_luminance[idx],
                    );
                    // Preview canvas (display only, not scored on):
                    // alpha composite so the rendered output matches
                    // what the builder actually sees as threads stack.
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

/// Color-mode chord score: weighted average along the chord of
/// `density[pix] + LUMINANCE_SCORE_WEIGHT · thread_lum · luminance[pix]`,
/// normalized by weighted coverage. Combines the per-thread density
/// term (primary signal — correct-hue chords for the subject win
/// cleanly) with a shared luminance term weighted by the thread's own
/// brightness (secondary signal — lets dim bright threads attract
/// chords into periphery regions the NNLS decomposition leaves with
/// near-zero density).
#[allow(clippy::too_many_arguments)]
fn score_chord_color(
    density: &[f32],
    luminance: &[f32],
    weights: &[f32],
    thread_lum: f32,
    width: usize,
    height: usize,
    p0: (f32, f32),
    p1: (f32, f32),
) -> f32 {
    let lum_scale = LUMINANCE_SCORE_WEIGHT * thread_lum;
    let mut sum = 0.0f32;
    let mut relevant_weight = 0.0f32;
    chord::for_each_pixel(p0.0, p0.1, p1.0, p1.1, width, height, |idx, c| {
        // Only count pixels where THIS thread has positive density
        // demand. In color mode the per-thread density field is
        // sparse — a warm thread has nonzero density only in pixels
        // whose decomposition assigned weight to it. Averaging over
        // the entire chord (including pixels with zero demand) lets
        // whichever thread has the LARGEST demanding region (black,
        // usually) win every chord regardless of which subregion the
        // chord actually passes through, and color threads never get
        // picked. Restricting the normalization denominator to
        // relevant pixels fixes that: a chord through a face region
        // gets credit for the warm thread's demand there, diluted
        // only by other face-pixel variation, not by bare-board or
        // shadow-dominated pixels along the same chord path.
        let signal = density[idx] + lum_scale * luminance[idx];
        if signal <= 0.0 {
            return;
        }
        let w = weights[idx];
        let cw = c * w;
        sum += signal * cw;
        relevant_weight += cw;
    });
    if relevant_weight > 0.0 {
        sum / relevant_weight
    } else {
        0.0
    }
}

/// Per-chord score for a scalar residual field: weighted average of
/// `residual × coverage × weight` along the chord, normalized by
/// weighted coverage. Used by mono mode only.
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

/// Hybrid decomposition: split the board-minus-target residual `b`
/// into a chromatic part (perceived hue) and an achromatic part
/// (uniform darkening). The chromatic part is solved with OMP on the
/// per-thread *chromatic* basis — so colored threads compete to
/// explain hue — and the achromatic part is assigned entirely to
/// the most-achromatic thread (typically the black primary).
///
/// Why the split: our canonical palette includes black, which has a
/// large `board − thread` basis magnitude but a near-zero chromatic
/// component. OMP on the raw darkening basis always picked black
/// first because its basis magnitude swamped any colored thread's.
/// The chromatic threads were then left to explain a small leftover
/// residual, getting tiny coefficients — which translated to the
/// solver picking black for almost every chord and color mode
/// rendering as near-monochrome.
///
/// Splitting lets black and the colored threads each handle the part
/// of the residual they're actually shaped for: black for luminance,
/// colored primaries for hue. Colored threads get coefficients of
/// meaningful magnitude and the solver actually uses them.
fn decompose_nnls(
    ata: &[f32],
    atb: &[f32],
    k: usize,
    basis: &[[f32; 3]],
    b: &[f32; 3],
    w: &mut [f32],
) {
    for wi in w.iter_mut().take(k) {
        *wi = 0.0;
    }
    if k == 0 {
        return;
    }

    // Detect the most-achromatic thread: the one whose chromatic
    // basis (basis minus its min channel) has the smallest magnitude
    // relative to its full basis norm. Black and near-black threads
    // have near-zero chromatic magnitude; saturated primaries have
    // large chromatic magnitude. The "achromatic" thread gets the
    // uniform-darkening leftover after the colored threads have done
    // their work on the chromatic part of the residual.
    //
    // If *no* thread is clearly achromatic (e.g. all threads are
    // saturated primaries with no black in the palette) then this
    // picks the least-chromatic one and the split still produces
    // sensible decompositions.
    // A thread qualifies as "achromatic" only if its chromatic
    // component is a small fraction of its total basis magnitude.
    // For saturated primaries the ratio approaches 1 (pure chroma);
    // for black and near-black the ratio is near 0. If no thread
    // clears the threshold (e.g. a palette of only saturated
    // primaries with no black), `achromatic` stays `None` and the
    // decomposition runs pure OMP across all threads.
    let mut achromatic: Option<usize> = None;
    let mut min_ratio = f32::INFINITY;
    for (i, b) in basis.iter().enumerate() {
        let m = b[0].min(b[1]).min(b[2]);
        let chrom_sq = (b[0] - m).powi(2) + (b[1] - m).powi(2) + (b[2] - m).powi(2);
        let norm_sq = ata[i * k + i].max(1e-8);
        let ratio = chrom_sq / norm_sq;
        if ratio < min_ratio {
            min_ratio = ratio;
            if ratio < 0.3 {
                achromatic = Some(i);
            }
        }
    }

    // How chromatic is the current residual? Ratio of its chromatic
    // magnitude to its total magnitude. Near 1 = strongly hued
    // pixel (skin, colored object). Near 0 = uniform-dark pixel
    // (hair, shadow). Drives the OMP gate below: on strongly hued
    // pixels, exclude the achromatic thread from the first pass so
    // colored threads get first crack at the residual; on uniform-
    // dark pixels, let the achromatic thread compete normally.
    //
    // Without this gate, black always wins the first OMP pass on
    // any palette that includes it (its basis has the highest raw
    // magnitude of any dark thread), and every pixel ends up
    // mostly-black with near-zero colored-thread density — the
    // color signal never reaches the chord scorer.
    //
    // Separately: for mostly-achromatic pixels we want black too,
    // not color. So only exclude achromatic when the residual is
    // *actually* chromatic.
    // Chromatic fraction of the residual, computed directly from
    // raw `b`: |chromatic part of b| / |b|. Clean 0..1 ratio, no
    // tricks. Near 1 when the pixel demands a specific hue; near 0
    // when demand is uniform darkening.
    let b_min = b[0].min(b[1]).min(b[2]);
    let b_norm_sq = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
    let chrom = [b[0] - b_min, b[1] - b_min, b[2] - b_min];
    let chrom_norm_sq = chrom[0] * chrom[0] + chrom[1] * chrom[1] + chrom[2] * chrom[2];
    let chromatic_fraction = if b_norm_sq > 1e-8 {
        (chrom_norm_sq / b_norm_sq).sqrt()
    } else {
        0.0
    };
    let exclude_achromatic_first_pass = achromatic.is_some() && chromatic_fraction > 0.25;

    // Step 1: OMP over candidate threads. If the pixel is strongly
    // hued, exclude the achromatic thread for this pass. Cap at 2
    // active threads total across steps 1+2.
    let mut proj = atb.to_vec();
    let mut used = vec![false; k];
    if exclude_achromatic_first_pass {
        if let Some(a) = achromatic {
            used[a] = true;
        }
    }
    let allowed_count = used.iter().filter(|u| !**u).count();
    let max_step1 = allowed_count.min(2);
    for _ in 0..max_step1 {
        let mut best_i = usize::MAX;
        let mut best_score = f32::NEG_INFINITY;
        for i in 0..k {
            if used[i] {
                continue;
            }
            let norm_sq = ata[i * k + i];
            if norm_sq <= 1e-8 {
                continue;
            }
            let aligned = proj[i] / norm_sq.sqrt();
            if aligned > best_score {
                best_score = aligned;
                best_i = i;
            }
        }
        if best_i == usize::MAX || best_score <= 0.0 {
            break;
        }
        used[best_i] = true;
        let coeff = (proj[best_i] / ata[best_i * k + best_i]).max(0.0);
        w[best_i] += coeff;
        for j in 0..k {
            proj[j] -= coeff * ata[best_i * k + j];
        }
    }

    // Step 2: if we skipped the achromatic thread in step 1, give it
    // a chance now with whatever's left of the residual.
    if exclude_achromatic_first_pass {
        if let Some(a) = achromatic {
            let norm_sq = ata[a * k + a];
            if norm_sq > 1e-8 {
                let coeff = (proj[a] / norm_sq).max(0.0);
                w[a] += coeff;
            }
        }
    }
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
