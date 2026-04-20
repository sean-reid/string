//! Image preprocessing pipeline for the string-art solver.
//!
//! Stages run in order on a square luminance buffer:
//!   Rec.709 luminance -> circular mask -> bilateral -> CLAHE
//!   -> unsharp -> gamma.
//!
//! Inputs and outputs are RGBA8. Internally the pipeline works on f32
//! single-channel luminance in `[0.0, 1.0]`. `expand_rgba` broadcasts the
//! final luminance back to R=G=B=luminance at the end.

pub mod bilateral;
pub mod clahe;
pub mod gamma;
pub mod luminance;
pub mod mask;
pub mod unsharp;

use self::{
    bilateral::bilateral, clahe::clahe, gamma::apply_gamma, luminance::rec709, mask::circular_mask,
    unsharp::unsharp_mask,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Params {
    pub bilateral_sigma_color: f32,
    pub bilateral_sigma_space: f32,
    pub clahe_clip: f32,
    pub clahe_tiles: u32,
    pub unsharp_sigma: f32,
    pub unsharp_amount: f32,
    pub gamma: f32,
    pub mask_circular: bool,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            bilateral_sigma_color: 25.0 / 255.0,
            bilateral_sigma_space: 5.0,
            clahe_clip: 2.0,
            clahe_tiles: 8,
            unsharp_sigma: 1.5,
            unsharp_amount: 0.7,
            gamma: 1.3,
            mask_circular: true,
        }
    }
}

pub fn run(rgba: &[u8], width: usize, height: usize, params: Params) -> Vec<u8> {
    assert_eq!(
        rgba.len(),
        width * height * 4,
        "rgba length must equal w*h*4"
    );

    let mut lum = rec709(rgba, width, height);
    if params.mask_circular {
        circular_mask(&mut lum, width, height);
    }
    if params.bilateral_sigma_color > 0.0 && params.bilateral_sigma_space > 0.0 {
        let filtered = bilateral(
            &lum,
            width,
            height,
            params.bilateral_sigma_color,
            params.bilateral_sigma_space,
        );
        lum = filtered;
    }
    if params.clahe_clip > 0.0 && params.clahe_tiles > 0 {
        clahe(
            &mut lum,
            width,
            height,
            params.clahe_tiles as usize,
            params.clahe_clip,
        );
    }
    if params.unsharp_amount > 0.0 && params.unsharp_sigma > 0.0 {
        unsharp_mask(
            &mut lum,
            width,
            height,
            params.unsharp_sigma,
            params.unsharp_amount,
        );
    }
    if (params.gamma - 1.0).abs() > f32::EPSILON {
        apply_gamma(&mut lum, params.gamma);
    }

    expand_rgba(&lum, width, height)
}

fn expand_rgba(lum: &[f32], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0u8; width * height * 4];
    for (i, &l) in lum.iter().enumerate() {
        let g = (l.clamp(0.0, 1.0) * 255.0).round() as u8;
        let base = i * 4;
        out[base] = g;
        out[base + 1] = g;
        out[base + 2] = g;
        out[base + 3] = 255;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_rgba(width: usize, height: usize, r: u8, g: u8, b: u8) -> Vec<u8> {
        let mut v = vec![0u8; width * height * 4];
        for i in 0..width * height {
            v[i * 4] = r;
            v[i * 4 + 1] = g;
            v[i * 4 + 2] = b;
            v[i * 4 + 3] = 255;
        }
        v
    }

    #[test]
    fn pipeline_output_is_in_u8_range() {
        // A small random-ish pattern exercises every stage with real entropy.
        let w = 32;
        let h = 32;
        let mut rgba = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let base = (y * w + x) * 4;
                let v = (((x * 7 + y * 13) % 256) as u8).saturating_add(20);
                rgba[base] = v;
                rgba[base + 1] = v.saturating_sub(5);
                rgba[base + 2] = v.saturating_add(10);
                rgba[base + 3] = 255;
            }
        }
        let out = run(&rgba, w, h, Params::default());
        assert_eq!(out.len(), w * h * 4);
        for chunk in out.chunks_exact(4) {
            assert_eq!(chunk[3], 255);
        }
    }

    #[test]
    fn pipeline_output_is_grayscale() {
        let rgba = solid_rgba(16, 16, 200, 50, 10);
        let out = run(&rgba, 16, 16, Params::default());
        for chunk in out.chunks_exact(4) {
            assert_eq!(chunk[0], chunk[1], "R != G");
            assert_eq!(chunk[1], chunk[2], "G != B");
            assert_eq!(chunk[3], 255, "alpha not opaque");
        }
    }
}
