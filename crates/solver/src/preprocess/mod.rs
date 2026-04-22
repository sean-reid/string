//! Image preprocessing pipeline for the string-art solver.
//!
//! Stages run in order on each working channel:
//!   circular mask -> bilateral -> CLAHE -> unsharp -> gamma.
//!
//! Inputs and outputs are RGBA8. When `params.grayscale` is `true` (the
//! default) the pipeline collapses to Rec.709 luminance up-front and the
//! output RGBA has R=G=B=luminance. When `grayscale` is `false` each R/G/B
//! channel is preprocessed independently so chroma is preserved — used by
//! color-mode solves where the solver picks from a thread palette.

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
    /// `true` collapses the image to luminance up front (the default for
    /// monochrome solves); `false` keeps chroma by running the filter stack
    /// per R/G/B channel.
    pub grayscale: bool,
}

impl Default for Params {
    fn default() -> Self {
        // The goal of preprocessing is to keep the tonal field intact so the
        // solver can concentrate lines in bright regions and leave dark
        // regions alone. Aggressive CLAHE flattens the histogram and leads
        // to uniform noise; heavy unsharp amplifies skin texture into high-
        // frequency lines. Lighter touch everywhere.
        Self {
            bilateral_sigma_color: 20.0 / 255.0,
            bilateral_sigma_space: 3.0,
            clahe_clip: 0.0, // off; re-enable per-image only if needed
            clahe_tiles: 0,
            unsharp_sigma: 1.0,
            unsharp_amount: 0.25,
            gamma: 1.0,
            mask_circular: true,
            grayscale: true,
        }
    }
}

pub fn run(rgba: &[u8], width: usize, height: usize, params: Params) -> Vec<u8> {
    assert_eq!(
        rgba.len(),
        width * height * 4,
        "rgba length must equal w*h*4"
    );

    if params.grayscale {
        let mut lum = rec709(rgba, width, height);
        filter_channel(&mut lum, width, height, &params);
        expand_rgba(&lum, width, height)
    } else {
        let mut channels = split_channels(rgba, width, height);
        for chan in channels.iter_mut() {
            filter_channel(chan, width, height, &params);
        }
        merge_channels(&channels, width, height)
    }
}

fn filter_channel(buf: &mut Vec<f32>, width: usize, height: usize, params: &Params) {
    if params.mask_circular {
        circular_mask(buf, width, height);
    }
    if params.bilateral_sigma_color > 0.0 && params.bilateral_sigma_space > 0.0 {
        *buf = bilateral(
            buf,
            width,
            height,
            params.bilateral_sigma_color,
            params.bilateral_sigma_space,
        );
    }
    if params.clahe_clip > 0.0 && params.clahe_tiles > 0 {
        clahe(
            buf,
            width,
            height,
            params.clahe_tiles as usize,
            params.clahe_clip,
        );
    }
    if params.unsharp_amount > 0.0 && params.unsharp_sigma > 0.0 {
        unsharp_mask(
            buf,
            width,
            height,
            params.unsharp_sigma,
            params.unsharp_amount,
        );
    }
    if (params.gamma - 1.0).abs() > f32::EPSILON {
        apply_gamma(buf, params.gamma);
    }
}

fn split_channels(rgba: &[u8], width: usize, height: usize) -> [Vec<f32>; 3] {
    let n = width * height;
    let mut r = Vec::with_capacity(n);
    let mut g = Vec::with_capacity(n);
    let mut b = Vec::with_capacity(n);
    for i in 0..n {
        let base = i * 4;
        r.push(rgba[base] as f32 / 255.0);
        g.push(rgba[base + 1] as f32 / 255.0);
        b.push(rgba[base + 2] as f32 / 255.0);
    }
    [r, g, b]
}

fn merge_channels(chans: &[Vec<f32>; 3], width: usize, height: usize) -> Vec<u8> {
    let n = width * height;
    let mut out = vec![0u8; n * 4];
    for i in 0..n {
        out[i * 4] = (chans[0][i].clamp(0.0, 1.0) * 255.0).round() as u8;
        out[i * 4 + 1] = (chans[1][i].clamp(0.0, 1.0) * 255.0).round() as u8;
        out[i * 4 + 2] = (chans[2][i].clamp(0.0, 1.0) * 255.0).round() as u8;
        out[i * 4 + 3] = 255;
    }
    out
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

    #[test]
    fn color_mode_preserves_channels() {
        let rgba = solid_rgba(16, 16, 200, 50, 10);
        let params = Params {
            grayscale: false,
            ..Params::default()
        };
        let out = run(&rgba, 16, 16, params);
        // Within a solid block, the channel separation should survive;
        // unsharp + mask can trim edge pixels, so sample an interior pixel.
        let base = (8 * 16 + 8) * 4;
        assert!(out[base] > 150, "R channel crushed: {}", out[base]);
        assert!(out[base + 1] < 100, "G leaked up: {}", out[base + 1]);
        assert!(out[base + 2] < 50, "B leaked up: {}", out[base + 2]);
        assert_eq!(out[base + 3], 255);
    }
}
