//! Stochastic greedy string-art solver.
//!
//! State machine the front-end polls:
//!   1. `new` allocates residual + pin positions from a preprocessed RGBA.
//!   2. `step_many(n)` picks up to `n` next pins; returns their indices
//!      in order drawn. Empty result means the solver is finished.
//!   3. `is_done()` flips true when the line budget is reached.

pub mod chord;

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

use self::chord::{draw_chord, score_chord, Endpoints};

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
    config: SolverConfig,
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
        seed: u64,
    ) -> Result<Self, &'static str> {
        if preprocessed_rgba.len() != size * size * 4 {
            return Err("preprocessed buffer size does not match width*height*4");
        }
        if config.pin_count < 8 {
            return Err("pin_count must be at least 8");
        }
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

        Ok(Self {
            width: size,
            height: size,
            pins_x,
            pins_y,
            residual,
            config,
            rng: ChaCha8Rng::seed_from_u64(seed),
            current: 0,
            ban_queue: VecDeque::with_capacity(config.ban_window as usize),
            lines_drawn: 0,
        })
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
            let s = score_chord(&self.residual, self.width, self.height, cx, cy, qx, qy);
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
        out
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

    #[test]
    fn solver_progresses_and_terminates() {
        let size = 64;
        let rgba = rgba_gradient(size);
        let config = SolverConfig {
            pin_count: 48,
            line_budget: 50,
            ..Default::default()
        };
        let mut solver = Solver::new(&rgba, size, config, 42).expect("solver init");
        let mut drawn = 0u32;
        while !solver.is_done() {
            let batch = solver.step_many(10);
            if batch.is_empty() {
                break;
            }
            drawn += batch.len() as u32;
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
            let mut s = Solver::new(&rgba, size, config, seed).unwrap();
            let mut pins = Vec::new();
            while !s.is_done() {
                pins.extend(s.step_many(30));
                break;
            }
            pins
        };
        assert_eq!(run(7), run(7), "same seed should produce same sequence");
        assert_ne!(run(7), run(11), "different seeds should differ");
    }
}
