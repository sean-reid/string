//! Palette extraction for a photo, tuned for **additive reconstruction**
//! on a dark board.
//!
//! The extraction is **Tan et al. 2016** ("Decomposing Images into
//! Layers via RGB-space Geometry") in spirit: the palette is a small
//! set of vertices whose convex hull encloses the image's pixel
//! distribution in linear RGB. We approximate full hull-simplification
//! with **farthest-point sampling** (Gonzalez 1985) — slot 0 is the
//! brightest image sample, each subsequent slot is the sample with
//! maximum minimum-distance to the already-picked set. FPS provably
//! picks hull vertices, which is what Tan's convex-hull simplification
//! converges to; running it in linear RGB means every pick is a real
//! image color.
//!
//! Palette extraction is deliberately **not face-weighted**. The job of
//! the palette is to span the image's gamut so the additive combination
//! of threads can reconstruct any pixel. Face-biasing the palette
//! collapses it to a single hue on portraits (all warm-skin variations),
//! losing the chromatic diversity needed to paint shadows, lips, eyes,
//! and other off-hue regions. Concentrating strings on the face is a
//! **budget-allocation** problem, handled in `solver::weight` by
//! suppressing non-face importance — so palette diversity and subject
//! focus are orthogonal concerns, solved independently.
//!
//! k=1 is an aesthetic exception: palette-of-one returns the
//! traditional `#f4efe5` cream verbatim regardless of image content.
//!
//! The palette is returned ordered ascending in Rec.709 luminance. The
//! solver processes colors sequentially, so dark threads get laid down
//! first and bright highlights stack on top — standard practice on a
//! dark board.

use crate::solver::palette::srgb_to_linear;
use crate::solver::weight::FaceBox;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;

/// sRGB of the classic cream thread. Mono mode (k=1) returns this
/// verbatim — matches the warm off-white cotton a hand-built piece
/// tends to use.
const CREAM_SRGB: [u8; 3] = [0xF4, 0xEF, 0xE5];

/// Rec.709 luminance of the dark disc the threads sit on. Samples at
/// or near this luminance contribute no usable light.
const BOARD_LUMINANCE: f32 = 0.003_631;
/// Minimum linear-luminance margin above the board for a sample to be
/// eligible as a palette vertex.
const MIN_PALETTE_MARGIN: f32 = 0.05;

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
        return Ok(CREAM_SRGB.to_vec());
    }
    let _ = face;

    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        return Ok(CREAM_SRGB.repeat(k));
    }

    let pool = above_board_or_all(&samples);
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

fn above_board_or_all(samples: &[[f32; 3]]) -> Vec<[f32; 3]> {
    let threshold = BOARD_LUMINANCE + MIN_PALETTE_MARGIN;
    let filtered: Vec<[f32; 3]> = samples
        .iter()
        .copied()
        .filter(|c| rec709(*c) > threshold)
        .collect();
    if filtered.is_empty() {
        samples.to_vec()
    } else {
        filtered
    }
}

/// Farthest-point sampling in linear RGB. Slot 0 is the brightest
/// sample (Rec.709 luminance); each subsequent slot is the sample
/// with maximum minimum-distance to the already-picked set. FPS
/// provably picks hull vertices, giving a k-simplex that encloses
/// the image's gamut.
fn farthest_point_sampling(pool: &[[f32; 3]], k: usize) -> Vec<[f32; 3]> {
    if pool.is_empty() {
        return Vec::new();
    }
    let mut picks: Vec<[f32; 3]> = Vec::with_capacity(k);
    let mut min_dist: Vec<f32> = vec![f32::INFINITY; pool.len()];

    let mut slot0 = 0usize;
    let mut best_lum = f32::NEG_INFINITY;
    for (i, c) in pool.iter().enumerate() {
        let lum = rec709(*c);
        if lum > best_lum {
            best_lum = lum;
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
        assert_eq!(out, CREAM_SRGB.to_vec());
        let cool = rgb_image(64, |_, _| [10, 40, 200]);
        let out = extract_palette_bytes(&cool, 64, 1, 7, None).unwrap();
        assert_eq!(out, CREAM_SRGB.to_vec());
    }

    #[test]
    fn three_panels_with_k_three_picks_all_primaries() {
        // Tan-style FPS on an R/G/B panel image picks one vertex per
        // primary; after saturation boost each palette entry is a
        // near-saturated primary.
        let size = 96;
        let rgba = rgb_image(size, |x, _| {
            if x < size / 3 {
                [220, 20, 20]
            } else if x < 2 * size / 3 {
                [20, 200, 20]
            } else {
                [20, 20, 220]
            }
        });
        let out = extract_palette_bytes(&rgba, size, 3, 13, None).unwrap();
        assert_eq!(out.len(), 9);
        let colors: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut has_red = false;
        let mut has_green = false;
        let mut has_blue = false;
        for c in &colors {
            if c[0] > 150 && c[1] < 100 && c[2] < 100 {
                has_red = true;
            }
            if c[1] > 150 && c[0] < 100 && c[2] < 100 {
                has_green = true;
            }
            if c[2] > 150 && c[0] < 100 && c[1] < 100 {
                has_blue = true;
            }
        }
        assert!(
            has_red && has_green && has_blue,
            "missing a primary: {colors:?}"
        );
    }

    #[test]
    fn palette_spans_gamut_including_background_extremes() {
        // A portrait with warm face + saturated sky. The palette must
        // include both extremes as hull vertices so the solver has a
        // thread for each; subject focus is the solver's weight map's
        // job, not the palette's.
        let size = 96;
        let face_x = 24.0f32;
        let face_y = 24.0f32;
        let face_w = 48.0f32;
        let face_h = 48.0f32;
        let rgba = rgb_image(size, |x, y| {
            let in_face = (x as f32) >= face_x
                && (x as f32) < face_x + face_w
                && (y as f32) >= face_y
                && (y as f32) < face_y + face_h;
            if in_face {
                [230, 170, 130]
            } else {
                [20, 20, 240]
            }
        });
        let out = extract_palette_bytes(&rgba, size, 3, 0, None).unwrap();
        let has_blue = out.chunks_exact(3).any(|c| c[2] > 150 && c[0] < 80);
        let has_warm = out.chunks_exact(3).any(|c| c[0] > 150 && c[2] < 150);
        assert!(has_blue, "palette missing sky hull vertex: {out:?}");
        assert!(has_warm, "palette missing face hull vertex: {out:?}");
    }

    #[test]
    fn multi_color_slot_zero_is_image_derived() {
        // Slot 0 is the brightness anchor of the weighted pool, not a
        // hardcoded color — a warm photo yields a warm anchor.
        let warm = rgb_image(64, |_, _| [200, 120, 80]);
        let out = extract_palette_bytes(&warm, 64, 3, 42, None).unwrap();
        let slot0 = [out[0], out[1], out[2]];
        assert!(
            slot0[0] >= slot0[2],
            "warm slot 0 should lean warm: {slot0:?}"
        );
        let cool = rgb_image(64, |_, _| [80, 120, 200]);
        let out = extract_palette_bytes(&cool, 64, 3, 42, None).unwrap();
        let slot0 = [out[0], out[1], out[2]];
        assert!(
            slot0[2] >= slot0[0],
            "cool slot 0 should lean cool: {slot0:?}"
        );
    }

    #[test]
    fn palette_preserves_image_luminance() {
        // A dim image should yield dim threads. We deliberately do not
        // boost saturation or luminance — a dark shadow must stay dark
        // so the build's luminance order reflects the image, and so
        // the user can match each slot to a real thread they can buy.
        let rgba = rgb_image(64, |_, _| [60, 30, 15]);
        let out = extract_palette_bytes(&rgba, 64, 2, 1, None).unwrap();
        for entry in out.chunks_exact(3) {
            let max = *entry.iter().max().unwrap();
            assert!(
                max <= 100,
                "palette brightened beyond source: max channel = {max}"
            );
        }
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
