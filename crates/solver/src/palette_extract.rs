//! Palette extraction for a photo. Given that threads physically ADD light
//! on a dark board, a useful palette is one whose colors span the image's
//! color gamut — interior pixels should be reachable as non-negative
//! combinations of the palette. K-means centroids sit *inside* the color
//! cloud, so their combinations can't reach extreme pixels (a brown-face
//! photo yields brown-on-brown output).
//!
//! This module picks palette entries via **brightness-anchored
//! farthest-point sampling** in OkLab — slot 0 is the top-1% luminance
//! mean (a robust "highlight" anchor), each subsequent slot is the pixel
//! whose minimum distance to the already-picked set is maximum
//! (Gonzalez 1985 k-center, 2-approximation of the optimal convex-hull
//! sampling). A short k-means polish in linear RGB denoises the picks
//! and settles them on the local cluster means while keeping their
//! extreme positions.
//!
//! Color space: samples are stored in linear sRGB (threads sum there);
//! distance comparisons are in OkLab (perceptually uniform so picks
//! spread visually, not just in raw linear coordinates).
//!
//! Runtime for the default sample budget at 128×128 downsample (~4k
//! samples) + k ≤ 6 + 2 k-means iterations: under 5 ms in wasm.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;

use crate::solver::palette::srgb_to_linear;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;
/// Polish after farthest-point sampling with a short k-means pass to
/// denoise single-pixel anchors and settle each palette entry on the
/// local cluster mean without moving it away from the gamut edge.
const POLISH_ITERS: u32 = 2;
/// Percentile of the brightest pixels averaged to form slot 0. A single
/// brightest pixel is usually a JPEG artifact or a specular highlight;
/// averaging the top 1% gives a robust "image highlight color".
const HIGHLIGHT_PERCENTILE: f32 = 0.01;
/// sRGB of the classic cream thread we fall back to when k=1 and as the
/// mono default across the app. Keeping it in one place avoids drift
/// between the solver, the rail default, and the mono golden test.
const CREAM_SRGB: [u8; 3] = [0xF4, 0xEF, 0xE5];

/// Public entry point. Returns `k * 3` sRGB bytes; returns `Err` on invalid
/// input rather than panicking so the wasm boundary is well-behaved.
pub fn extract_palette_bytes(
    rgba: &[u8],
    size: usize,
    k: usize,
    seed: u64,
) -> Result<Vec<u8>, &'static str> {
    if rgba.len() != size * size * 4 {
        return Err("rgba length must equal width * height * 4");
    }
    if !(1..=MAX_K).contains(&k) {
        return Err("palette size must be in 1..=8");
    }
    if k == 1 {
        // Palette-of-one always means "the monochrome cream thread" — it
        // is what the solver renders in mono mode, what the mono golden
        // test pins, and what the UI uses as the default. Returning the
        // image mean here would give a muddy swatch for most photos.
        return Ok(CREAM_SRGB.to_vec());
    }
    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        return Ok(CREAM_SRGB.repeat(k));
    }
    let picks = farthest_point_sampling(&samples, k, seed);
    let polished = polish_kmeans(&samples, picks);
    Ok(linear_to_srgb_bytes(&polished))
}

/// Downsample the image to SAMPLE_DIM × SAMPLE_DIM by averaging each tile,
/// then convert each RGB component to linear space. Keeps runtime bounded
/// regardless of input resolution.
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
                    // Skip fully-transparent pixels so masked corners don't
                    // pull clusters toward black.
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

/// Farthest-point sampling in OkLab, seeded by a brightness-anchored slot 0.
/// This is the Gonzalez 1985 k-center heuristic — for each new slot pick
/// the sample whose minimum distance to the already-picked set is maximum.
/// Approximates the convex hull vertices of the color cloud without
/// computing a full hull.
fn farthest_point_sampling(samples: &[[f32; 3]], k: usize, seed: u64) -> Vec<[f32; 3]> {
    debug_assert!(k >= 2);
    let mut rng = ChaCha8Rng::seed_from_u64(seed);

    // Precompute OkLab for every sample once. Cheaper than reconverting
    // inside the inner-loop distance check.
    let labs: Vec<[f32; 3]> = samples.iter().map(|&c| linear_rgb_to_oklab(c)).collect();

    let mut picks: Vec<usize> = Vec::with_capacity(k);
    // Slot 0: mean of the top-HIGHLIGHT_PERCENTILE brightest samples in
    // OkLab `L`. Averaging the top 1% resists single-pixel noise and
    // guarantees at least one bright thread in the palette.
    picks.push(highlight_anchor_index(&labs));
    // Distances to the already-picked set, in OkLab units. Initialized
    // to the distance from slot 0.
    let mut dists = vec![f32::INFINITY; samples.len()];
    for (i, l) in labs.iter().enumerate() {
        let d = sq_dist(l, &labs[picks[0]]);
        if d < dists[i] {
            dists[i] = d;
        }
    }

    while picks.len() < k {
        // Pick the sample whose min-distance to the set is maximum. When
        // there is a tie, break it deterministically via the RNG — keeps
        // seed-stability without biasing toward low indices.
        let mut best = 0usize;
        let mut best_d = f32::NEG_INFINITY;
        let mut tied = 0u32;
        for (i, &d) in dists.iter().enumerate() {
            if d > best_d {
                best_d = d;
                best = i;
                tied = 1;
            } else if (d - best_d).abs() < 1e-6 {
                tied += 1;
                // Reservoir-sample among ties.
                if rng.gen_range(0..tied) == 0 {
                    best = i;
                }
            }
        }
        if best_d <= 0.0 {
            // All remaining samples are duplicates of existing picks. Pad
            // with the last pick so the palette still has the expected
            // length; the UI will dedupe or the user can edit in manual.
            while picks.len() < k {
                picks.push(*picks.last().expect("non-empty"));
            }
            break;
        }
        picks.push(best);
        let new_lab = labs[best];
        for (i, l) in labs.iter().enumerate() {
            let d = sq_dist(l, &new_lab);
            if d < dists[i] {
                dists[i] = d;
            }
        }
    }

    picks.into_iter().map(|i| samples[i]).collect()
}

fn highlight_anchor_index(labs: &[[f32; 3]]) -> usize {
    if labs.is_empty() {
        return 0;
    }
    let count = ((labs.len() as f32) * HIGHLIGHT_PERCENTILE).ceil() as usize;
    let count = count.max(1).min(labs.len());
    // Partial sort to find the top-`count` brightest in OkLab L.
    let mut idx: Vec<usize> = (0..labs.len()).collect();
    idx.select_nth_unstable_by(labs.len() - count, |&a, &b| {
        labs[a][0]
            .partial_cmp(&labs[b][0])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let top = &idx[labs.len() - count..];
    // Return the sample closest to the mean of the top-brightness cluster.
    let mut mean_l = 0.0f32;
    let mut mean_a = 0.0f32;
    let mut mean_b = 0.0f32;
    for &i in top {
        mean_l += labs[i][0];
        mean_a += labs[i][1];
        mean_b += labs[i][2];
    }
    let inv = 1.0 / top.len() as f32;
    let target = [mean_l * inv, mean_a * inv, mean_b * inv];
    let mut best = top[0];
    let mut best_d = f32::INFINITY;
    for &i in top {
        let d = sq_dist(&labs[i], &target);
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

/// Short k-means polish around the FPS picks. Assigns every sample to its
/// nearest pick in linear-RGB space, then re-computes each pick as the
/// cluster mean. Small number of iterations — enough to denoise a noisy
/// individual anchor pixel without dragging the picks off the gamut edge.
fn polish_kmeans(samples: &[[f32; 3]], init: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    let mut centroids = init;
    let mut assignments = vec![0usize; samples.len()];
    for _ in 0..POLISH_ITERS {
        if !assign_to_nearest(samples, &centroids, &mut assignments) {
            break;
        }
        centroids = recompute_centroids(samples, &assignments, &centroids, centroids.len());
    }
    sort_by_population(
        samples,
        &assignments,
        centroids,
        assignments_len(&assignments),
    )
}

fn assignments_len(assignments: &[usize]) -> usize {
    assignments
        .iter()
        .copied()
        .max()
        .map(|m| m + 1)
        .unwrap_or(0)
}

/// Convert linear sRGB (0..1) to OkLab. OkLab is nearly perceptually
/// uniform, so euclidean distances in it track visual color differences
/// far better than distances in linear RGB or gamma-encoded sRGB.
/// Constants truncated to f32-representable precision.
fn linear_rgb_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = rgb;
    let l = 0.412_221_47 * r + 0.536_332_54 * g + 0.051_445_994 * b;
    let m = 0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b;
    let s = 0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b;
    let l = l.max(0.0).cbrt();
    let m = m.max(0.0).cbrt();
    let s = s.max(0.0).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

fn assign_to_nearest(
    samples: &[[f32; 3]],
    centroids: &[[f32; 3]],
    assignments: &mut [usize],
) -> bool {
    let mut changed = false;
    for (i, s) in samples.iter().enumerate() {
        let mut best = 0usize;
        let mut best_d = f32::INFINITY;
        for (j, c) in centroids.iter().enumerate() {
            let d = sq_dist(s, c);
            if d < best_d {
                best_d = d;
                best = j;
            }
        }
        if assignments[i] != best {
            assignments[i] = best;
            changed = true;
        }
    }
    changed
}

fn recompute_centroids(
    samples: &[[f32; 3]],
    assignments: &[usize],
    previous: &[[f32; 3]],
    k: usize,
) -> Vec<[f32; 3]> {
    let mut sums = vec![[0.0f32; 3]; k];
    let mut counts = vec![0u32; k];
    for (i, &cluster) in assignments.iter().enumerate() {
        sums[cluster][0] += samples[i][0];
        sums[cluster][1] += samples[i][1];
        sums[cluster][2] += samples[i][2];
        counts[cluster] += 1;
    }
    let mut out = Vec::with_capacity(k);
    for (j, count) in counts.iter().enumerate() {
        if *count == 0 {
            // Empty cluster: keep the prior centroid so indices stay stable.
            out.push(previous[j]);
        } else {
            let inv = 1.0 / *count as f32;
            out.push([sums[j][0] * inv, sums[j][1] * inv, sums[j][2] * inv]);
        }
    }
    out
}

fn sort_by_population(
    samples: &[[f32; 3]],
    assignments: &[usize],
    centroids: Vec<[f32; 3]>,
    k: usize,
) -> Vec<[f32; 3]> {
    let mut counts = vec![0u32; k];
    for &a in assignments {
        counts[a] += 1;
    }
    let _ = samples; // counts already encode sample weight
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|&a, &b| counts[b].cmp(&counts[a]));
    order.into_iter().map(|i| centroids[i]).collect()
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

fn sq_dist(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let dr = a[0] - b[0];
    let dg = a[1] - b[1];
    let db = a[2] - b[2];
    dr * dr + dg * dg + db * db
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
        // k=1 is the mono path: the palette should match the legacy cream
        // thread regardless of the image, so the mono golden stays stable.
        let warm = rgb_image(64, |_, _| [200, 50, 80]);
        let out = extract_palette_bytes(&warm, 64, 1, 0).unwrap();
        assert_eq!(out, CREAM_SRGB.to_vec());

        let cool = rgb_image(64, |_, _| [10, 40, 200]);
        let out = extract_palette_bytes(&cool, 64, 1, 7).unwrap();
        assert_eq!(out, CREAM_SRGB.to_vec());
    }

    #[test]
    fn three_panels_extract_three_clusters() {
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
        let out = extract_palette_bytes(&rgba, size, 3, 13).unwrap();
        assert_eq!(out.len(), 9);
        // Each centroid should be dominated by one primary.
        let colors: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let mut has_red = false;
        let mut has_green = false;
        let mut has_blue = false;
        for c in &colors {
            if c[0] > 150 && c[1] < 80 && c[2] < 80 {
                has_red = true;
            }
            if c[1] > 150 && c[0] < 80 && c[2] < 80 {
                has_green = true;
            }
            if c[2] > 150 && c[0] < 80 && c[1] < 80 {
                has_blue = true;
            }
        }
        assert!(
            has_red && has_green && has_blue,
            "missing a primary: {colors:?}"
        );
    }

    #[test]
    fn rejects_bad_inputs() {
        let rgba = vec![0u8; 4];
        assert!(extract_palette_bytes(&rgba, 2, 1, 0).is_err());
        let rgba = rgb_image(4, |_, _| [0, 0, 0]);
        assert!(extract_palette_bytes(&rgba, 4, 0, 0).is_err());
        assert!(extract_palette_bytes(&rgba, 4, MAX_K + 1, 0).is_err());
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
        let a = extract_palette_bytes(&rgba, 96, 4, 42).unwrap();
        let b = extract_palette_bytes(&rgba, 96, 4, 42).unwrap();
        assert_eq!(a, b, "same seed should produce same palette");
    }
}
