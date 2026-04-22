//! Palette extraction for a photo, tuned for **subtractive
//! reconstruction** on a light board (Vrellis paradigm).
//!
//! Threads only SUBTRACT light. A thread as bright as the board sits
//! invisible against it, contributing zero contrast per crossing —
//! including one in the palette wastes a slot the solver can't
//! usefully spend. Bright regions of the image are rendered by the
//! *absence* of thread (bare cream board showing through gaps), not
//! by light thread. Midtones come from dark threads drawn at lower
//! density so the board still peeks through between crossings.
//! Every palette entry should therefore be a **dark, saturated**
//! thread that differs from its neighbors by **hue**, not by how
//! much lighter it is.
//!
//! Algorithm — Tan et al. 2016 in spirit, approximated cheaply:
//!
//! 1. Downsample image to `SAMPLE_DIM × SAMPLE_DIM` in linear RGB.
//! 2. Reject samples too close to board brightness (they add no
//!    contrast) and samples with negligible chroma that don't fall
//!    well below board (gray near-board noise). What's left is the
//!    eligible pool of hue candidates, all darker than board.
//! 3. FPS (Gonzalez 1985) in linear RGB. Slot 0 = sample with
//!    maximum contrast against board; each subsequent slot = sample
//!    with maximum minimum distance to the already-picked set. FPS
//!    provably picks hull vertices of the image's darker-than-board
//!    color cone, which is what a full convex-hull simplification
//!    converges to.
//!
//! If the image is entirely brighter than board (everything bare),
//! or has no dark chromatic content, the pool is empty and we fall
//! back to black for every slot — mono-on-cream at its rawest.
//!
//! k=1 is the aesthetic exception: palette-of-one returns pure black
//! `#111111`, the single-thread Vrellis-style monochrome baseline.
//!
//! The palette is returned ordered ascending in Rec.709 luminance
//! (darkest first). Darkest threads lay down first so they establish
//! the deepest shadows; lighter-dark threads stack on top for
//! midtone hue.

use crate::solver::palette::srgb_to_linear;
use crate::solver::weight::FaceBox;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;

/// sRGB of the default black thread. Mono mode (k=1) returns this
/// verbatim — single dark thread on cream board is the canonical
/// Vrellis-style portrait baseline.
const BLACK_SRGB: [u8; 3] = [0x11, 0x11, 0x11];

/// Rec.709 luminance of the board, precomputed so palette extraction
/// shares the solver's "what counts as usefully dark?" threshold.
/// Mirrors `solver::mod::BOARD_LUMINANCE` by convention.
const BOARD_LUMINANCE: f32 = 0.212_6 * 0.904_587_8 + 0.715_2 * 0.862_741_3 + 0.072_2 * 0.784_452_6;

/// Minimum Rec.709 luminance gap between a sample and the board for
/// it to qualify as a palette vertex. Below this the thread is too
/// close to board brightness to add visible contrast per crossing.
const MIN_BOARD_CONTRAST: f32 = 0.15;

/// Public entry point. `face` is accepted for future face-aware
/// variants but is currently unused — palette extraction spans the
/// full image gamut so color diversity is preserved on portraits.
/// Subject focus is enforced by `solver::weight`, not here.
pub fn extract_palette_bytes(
    rgba: &[u8],
    size: usize,
    k: usize,
    seed: u64,
    face: Option<FaceBox>,
) -> Result<Vec<u8>, &'static str> {
    if rgba.len() != size * size * 4 {
        return Err("rgba length must equal width * height * 4");
    }
    if !(1..=MAX_K).contains(&k) {
        return Err("palette size must be in 1..=8");
    }
    if k == 1 {
        return Ok(BLACK_SRGB.to_vec());
    }
    let _ = face;

    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        return Ok(BLACK_SRGB.repeat(k));
    }

    let pool = darker_than_board(&samples);
    if pool.is_empty() {
        // Everything in the image is at or above board brightness —
        // no usable darker-than-board content. Fall back to black for
        // every slot so a mostly-white source still produces visible
        // detail where there's any darker-than-board content at all.
        return Ok(BLACK_SRGB.repeat(k));
    }

    let picks = farthest_point_sampling(&pool, k);
    let ordered = order_for_build(picks);
    let _ = seed;
    Ok(linear_to_srgb_bytes(&ordered))
}

/// Orders a palette for a physical build: ascending Rec.709 luminance.
/// The darker the thread, the sooner it's wound onto the pins so the
/// visible detail (highlights, faces, letterforms) lands on top rather
/// than under six layers of dark threads. Stable for deterministic
/// sequences across runs.
fn order_for_build(mut palette: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    palette.sort_by(|a, b| {
        rec709(*a)
            .partial_cmp(&rec709(*b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    palette
}

/// Tile-average the input to `SAMPLE_DIM × SAMPLE_DIM` in linear RGB.
fn downsample_linear_rgb(rgba: &[u8], size: usize) -> Vec<[f32; 3]> {
    let tile = size.max(SAMPLE_DIM) / SAMPLE_DIM;
    let dim = (size / tile).max(1);
    let mut out = Vec::with_capacity(dim * dim);
    for ty in 0..dim {
        for tx in 0..dim {
            let mut sum = [0.0f32; 3];
            let mut n = 0u32;
            let y_start = ty * tile;
            let x_start = tx * tile;
            for y in y_start..(y_start + tile).min(size) {
                for x in x_start..(x_start + tile).min(size) {
                    let base = (y * size + x) * 4;
                    if rgba[base + 3] < 8 {
                        continue;
                    }
                    sum[0] += srgb_to_linear(rgba[base] as f32 / 255.0);
                    sum[1] += srgb_to_linear(rgba[base + 1] as f32 / 255.0);
                    sum[2] += srgb_to_linear(rgba[base + 2] as f32 / 255.0);
                    n += 1;
                }
            }
            if n > 0 {
                let inv = 1.0 / n as f32;
                out.push([sum[0] * inv, sum[1] * inv, sum[2] * inv]);
            }
        }
    }
    out
}

/// Samples eligible to anchor a palette slot: meaningfully darker
/// than the board (so each crossing adds visible contrast). Near-
/// board-brightness samples are rejected because a thread at board
/// luminance is invisible on the canvas — including it wastes a
/// palette slot.
fn darker_than_board(samples: &[[f32; 3]]) -> Vec<[f32; 3]> {
    samples
        .iter()
        .copied()
        .filter(|c| {
            let lum = rec709(*c);
            BOARD_LUMINANCE - lum >= MIN_BOARD_CONTRAST
        })
        .collect()
}

/// Farthest-point sampling in linear RGB. Slot 0 is the sample with
/// maximum contrast against board (darkest); each subsequent slot is
/// the sample with the maximum minimum-distance to the already-picked
/// set. Seeding with the darkest sample matters because the pool is
/// already filtered to darker-than-board — we want the palette's
/// first anchor to be the deepest shadow available so hull vertices
/// fan out from there.
fn farthest_point_sampling(pool: &[[f32; 3]], k: usize) -> Vec<[f32; 3]> {
    if pool.is_empty() {
        return Vec::new();
    }
    let mut picks: Vec<[f32; 3]> = Vec::with_capacity(k);
    let mut min_dist: Vec<f32> = vec![f32::INFINITY; pool.len()];

    let mut slot0 = 0usize;
    let mut darkest = f32::INFINITY;
    for (i, c) in pool.iter().enumerate() {
        let lum = rec709(*c);
        if lum < darkest {
            darkest = lum;
            slot0 = i;
        }
    }
    picks.push(pool[slot0]);
    update_min_dist(pool, pool[slot0], &mut min_dist);

    while picks.len() < k {
        let mut best = 0usize;
        let mut best_score = f32::NEG_INFINITY;
        for (i, _) in pool.iter().enumerate() {
            if min_dist[i] > best_score {
                best_score = min_dist[i];
                best = i;
            }
        }
        if best_score <= 0.0 {
            // Pool exhausted (duplicate samples or k > unique colors).
            picks.push(*picks.last().unwrap());
            continue;
        }
        picks.push(pool[best]);
        update_min_dist(pool, pool[best], &mut min_dist);
    }
    picks
}

fn update_min_dist(pool: &[[f32; 3]], picked: [f32; 3], min_dist: &mut [f32]) {
    for (i, c) in pool.iter().enumerate() {
        let d = sq_distance(*c, picked);
        if d < min_dist[i] {
            min_dist[i] = d;
        }
    }
}

fn sq_distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dr = a[0] - b[0];
    let dg = a[1] - b[1];
    let db = a[2] - b[2];
    dr * dr + dg * dg + db * db
}

fn rec709(c: [f32; 3]) -> f32 {
    0.212_6 * c[0] + 0.715_2 * c[1] + 0.072_2 * c[2]
}

fn linear_to_srgb_bytes(centroids: &[[f32; 3]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(centroids.len() * 3);
    for c in centroids {
        out.push(linear_component_to_u8(c[0]));
        out.push(linear_component_to_u8(c[1]));
        out.push(linear_component_to_u8(c[2]));
    }
    out
}

fn linear_component_to_u8(u: f32) -> u8 {
    let v = u.clamp(0.0, 1.0);
    let s = if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb_image(size: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Vec<u8> {
        let mut v = vec![0u8; size * size * 4];
        for y in 0..size {
            for x in 0..size {
                let base = (y * size + x) * 4;
                let [r, g, b] = f(x, y);
                v[base] = r;
                v[base + 1] = g;
                v[base + 2] = b;
                v[base + 3] = 255;
            }
        }
        v
    }

    #[test]
    fn k_of_one_always_returns_cream() {
        let warm = rgb_image(64, |_, _| [200, 50, 80]);
        let out = extract_palette_bytes(&warm, 64, 1, 0, None).unwrap();
        assert_eq!(out, BLACK_SRGB.to_vec());
        let cool = rgb_image(64, |_, _| [10, 40, 200]);
        let out = extract_palette_bytes(&cool, 64, 1, 7, None).unwrap();
        assert_eq!(out, BLACK_SRGB.to_vec());
    }

    #[test]
    fn three_panels_with_k_three_picks_all_primaries() {
        // On an R/G/B panel image all three primaries are darker than
        // the cream board, so FPS should pick one of each. No boost —
        // picks are returned as the raw image-derived hues.
        let size = 96;
        let rgba = rgb_image(size, |x, _| {
            if x < size / 3 {
                [180, 20, 20]
            } else if x < 2 * size / 3 {
                [20, 160, 20]
            } else {
                [20, 20, 180]
            }
        });
        let out = extract_palette_bytes(&rgba, size, 3, 13, None).unwrap();
        assert_eq!(out.len(), 9);
        let colors: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut has_red = false;
        let mut has_green = false;
        let mut has_blue = false;
        for c in &colors {
            if c[0] > 100 && c[1] < 60 && c[2] < 60 {
                has_red = true;
            }
            if c[1] > 100 && c[0] < 60 && c[2] < 60 {
                has_green = true;
            }
            if c[2] > 100 && c[0] < 60 && c[1] < 60 {
                has_blue = true;
            }
        }
        assert!(
            has_red && has_green && has_blue,
            "missing a primary: {colors:?}"
        );
    }

    #[test]
    fn every_palette_entry_is_dark_enough_to_see_on_cream_board() {
        // Palette threads must be meaningfully darker than the cream
        // board so each crossing adds visible contrast. A mid-bright
        // source can still produce palette entries — the filter keeps
        // only samples whose luminance gap from board exceeds the
        // contrast threshold.
        let rgba = rgb_image(64, |_, _| [60, 30, 15]);
        let out = extract_palette_bytes(&rgba, 64, 3, 1, None).unwrap();
        for entry in out.chunks_exact(3) {
            let rn = entry[0] as f32 / 255.0;
            let gn = entry[1] as f32 / 255.0;
            let bn = entry[2] as f32 / 255.0;
            let lum = 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;
            assert!(
                lum < 0.8,
                "palette entry too close to board brightness: {entry:?} (lum={lum})"
            );
        }
    }

    #[test]
    fn nearly_white_image_falls_back_to_black_on_multi_slot() {
        // If the image is essentially the board color (no
        // darker-than-board content), the palette falls back to black
        // for every slot so the solver at least has one usable dark
        // thread to place anywhere the image deviates from board.
        let rgba = rgb_image(64, |_, _| [245, 240, 230]);
        let out = extract_palette_bytes(&rgba, 64, 3, 0, None).unwrap();
        assert_eq!(out, BLACK_SRGB.repeat(3));
    }

    #[test]
    fn rejects_bad_inputs() {
        let rgba = vec![0u8; 4];
        assert!(extract_palette_bytes(&rgba, 2, 1, 0, None).is_err());
        let rgba = rgb_image(4, |_, _| [0, 0, 0]);
        assert!(extract_palette_bytes(&rgba, 4, 0, 0, None).is_err());
        assert!(extract_palette_bytes(&rgba, 4, MAX_K + 1, 0, None).is_err());
    }

    #[test]
    fn palette_is_ordered_dark_to_light_for_physical_build() {
        // Three distinct vertices — dark shadow, mid, bright — expect
        // the output to be sorted ascending in luminance so the
        // builder lays dark first, bright last.
        let size = 96;
        let rgba = rgb_image(size, |x, _| {
            if x < size / 3 {
                [30, 30, 30] // shadow
            } else if x < 2 * size / 3 {
                [150, 90, 70] // mid
            } else {
                [230, 200, 180] // highlight
            }
        });
        let out = extract_palette_bytes(&rgba, size, 3, 7, None).unwrap();
        let lums: Vec<f32> = out
            .chunks_exact(3)
            .map(|c| {
                let rn = c[0] as f32 / 255.0;
                let gn = c[1] as f32 / 255.0;
                let bn = c[2] as f32 / 255.0;
                0.2126 * rn + 0.7152 * gn + 0.0722 * bn
            })
            .collect();
        assert!(
            lums.windows(2).all(|w| w[0] <= w[1] + 1e-3),
            "palette not ordered dark to light: {lums:?}"
        );
    }

    #[test]
    fn seeded_determinism() {
        let rgba = rgb_image(96, |x, y| {
            if (x + y) % 17 < 8 {
                [180, 60, 90]
            } else {
                [30, 140, 200]
            }
        });
        let a = extract_palette_bytes(&rgba, 96, 4, 42, None).unwrap();
        let b = extract_palette_bytes(&rgba, 96, 4, 42, None).unwrap();
        assert_eq!(a, b, "same seed should produce same palette");
    }
}
