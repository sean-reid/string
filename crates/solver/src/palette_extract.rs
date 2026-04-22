//! k-means palette extraction for a photo. Used by the UI to propose a
//! small set of thread colors that represent the image well.
//!
//! The input is an arbitrary-resolution square RGBA buffer. We downsample
//! to a 128×128 sample grid so the cluster pass is bounded; then run
//! k-means++ init + 30 Lloyd iterations in linear RGB. The output is a
//! flat `k * 3` sRGB byte buffer ordered by descending cluster population
//! (most-used color first), so the UI can present the dominant thread
//! first in the swatch row.

use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;

use crate::solver::palette::srgb_to_linear;

const SAMPLE_DIM: usize = 128;
const MAX_ITERS: u32 = 30;
const MAX_K: usize = 8;

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
    let samples = downsample_linear_rgb(rgba, size);
    if k == 1 {
        // k-means with k=1 degenerates to the mean. Compute directly and
        // skip the iteration loop — cheaper and deterministic.
        let mean = mean_linear_rgb(&samples);
        return Ok(linear_to_srgb_bytes(&[mean]));
    }
    let centroids = kmeans(&samples, k, seed);
    Ok(linear_to_srgb_bytes(&centroids))
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

fn mean_linear_rgb(samples: &[[f32; 3]]) -> [f32; 3] {
    if samples.is_empty() {
        return [0.0, 0.0, 0.0];
    }
    let mut acc = [0.0f32; 3];
    for s in samples {
        acc[0] += s[0];
        acc[1] += s[1];
        acc[2] += s[2];
    }
    let inv = 1.0 / samples.len() as f32;
    [acc[0] * inv, acc[1] * inv, acc[2] * inv]
}

fn kmeans(samples: &[[f32; 3]], k: usize, seed: u64) -> Vec<[f32; 3]> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut centroids = kmeans_pp_init(samples, k, &mut rng);
    let mut assignments = vec![0usize; samples.len()];
    for _ in 0..MAX_ITERS {
        let changed = assign_to_nearest(samples, &centroids, &mut assignments);
        let new_centroids = recompute_centroids(samples, &assignments, &centroids, k);
        let converged = !changed;
        centroids = new_centroids;
        if converged {
            break;
        }
    }
    sort_by_population(samples, &assignments, centroids, k)
}

fn kmeans_pp_init(samples: &[[f32; 3]], k: usize, rng: &mut ChaCha8Rng) -> Vec<[f32; 3]> {
    let mut centroids = Vec::with_capacity(k);
    if samples.is_empty() {
        return vec![[0.0; 3]; k];
    }
    let first = rng.gen_range(0..samples.len());
    centroids.push(samples[first]);
    let mut dists = vec![f32::INFINITY; samples.len()];
    while centroids.len() < k {
        let last = *centroids.last().expect("centroids non-empty");
        let mut total = 0.0f32;
        for (i, s) in samples.iter().enumerate() {
            let d = sq_dist(s, &last);
            if d < dists[i] {
                dists[i] = d;
            }
            total += dists[i];
        }
        if !total.is_finite() || total <= 0.0 {
            // Degenerate (all samples coincident); pad with the last picked
            // centroid so downstream doesn't deal with a short palette.
            while centroids.len() < k {
                centroids.push(last);
            }
            break;
        }
        let pick = rng.gen::<f32>() * total;
        let mut cumulative = 0.0f32;
        let mut chosen = samples.len() - 1;
        for (i, &d) in dists.iter().enumerate() {
            cumulative += d;
            if cumulative >= pick {
                chosen = i;
                break;
            }
        }
        centroids.push(samples[chosen]);
    }
    centroids
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
    fn single_color_extracts_to_that_color() {
        let rgba = rgb_image(64, |_, _| [200, 50, 80]);
        let out = extract_palette_bytes(&rgba, 64, 1, 0).unwrap();
        assert_eq!(out.len(), 3);
        for (actual, expected) in out.iter().zip([200u8, 50, 80].iter()) {
            assert!(
                (*actual as i16 - *expected as i16).abs() <= 2,
                "channel drifted: got {actual}, expected ~{expected}",
            );
        }
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
