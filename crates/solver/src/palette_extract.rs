//! Palette extraction for a photo, tuned for **additive reconstruction**
//! on a dark board. Threads physically add light; the palette must be a
//! non-negative basis whose cone in linear RGB encloses every target
//! pixel. Two pitfalls the naive "pick dominant image colors" approach
//! runs into:
//!
//! - **No luminance carrier.** If every palette entry is dim (e.g. all
//!   skin tones on a face photo), each thread lifts the canvas by very
//!   little per line and no combination can reach bright image regions.
//! - **Collinear hues.** Skin tones all point in roughly the same RGB
//!   direction; three of them span a sliver, not a cone. Target pixels
//!   off that sliver are unreachable by any non-negative combination.
//!
//! Strategy:
//!
//! 1. Slot 0 is **always cream** (≈ `#f4efe5`, near-white). That
//!    guarantees a luminance carrier regardless of the image.
//! 2. Slots 1..k come from **farthest-point sampling** (Gonzalez 1985
//!    k-center) anchored at cream, in OkLab — each new slot is the
//!    image sample whose minimum distance to the already-picked set is
//!    maximum. This picks hues that are as far from cream *and* from
//!    each other as possible, spreading the palette's cone rather than
//!    collapsing it.
//! 3. Slots 1..k are **saturation-boosted** toward their hue's channel
//!    extreme (largest channel scaled to ~1). Preserves each pick's hue
//!    direction but restores the magnitude lost by picking a dim image
//!    pixel. A faint-brown extract becomes a vivid brown thread; the
//!    per-line contribution scales by the same factor.
//! 4. A short k-means polish in linear RGB denoises single-pixel
//!    anchors, holding slot 0 fixed so cream never drifts.
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
/// sRGB of the classic cream thread. Slot 0 of every auto palette and
/// the fallback single thread in mono mode. Keeping it in one place
/// avoids drift between the solver, the rail default, and the mono
/// golden test.
const CREAM_SRGB: [u8; 3] = [0xF4, 0xEF, 0xE5];
/// Target linear magnitude for saturation-boosted hue entries. 1.0
/// would push each slot to its own channel's maximum; we leave a touch
/// of headroom so boosted colors still look like thread (not neon).
const HUE_BOOST_TARGET: f32 = 0.95;

/// Rec.709 luminance of the dark disc the threads sit on. Every palette
/// entry must exceed this by at least `MIN_PALETTE_MARGIN` — a thread
/// with the same luminance as the board contributes no light and would
/// occupy a slot the solver can't use.
const BOARD_LUMINANCE: f32 = 0.003_631;
/// Minimum linear-luminance margin above the board. Below this a thread
/// can't add enough light per crossing to measurably lift the residual,
/// even under tight coverage.
const MIN_PALETTE_MARGIN: f32 = 0.05;

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
    let cream_linear = srgb_to_linear_triple(CREAM_SRGB);
    if k == 1 {
        // Palette-of-one always means the mono cream thread — byte-equal
        // to the legacy mono default, keeps the mono golden test stable.
        return Ok(CREAM_SRGB.to_vec());
    }
    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        // No usable samples (fully transparent image). Pad with cream.
        return Ok(CREAM_SRGB.repeat(k));
    }

    // Slot 0: cream, unconditional luminance carrier.
    let mut palette = Vec::with_capacity(k);
    palette.push(cream_linear);

    // Slots 1..k: image-derived hues, chosen by FPS *anchored at cream*
    // so the first pick is the image sample furthest from cream, the
    // second is furthest from {cream, pick_1}, and so on. This spreads
    // the hue cone instead of collapsing it.
    let hue_pool = above_board_or_all(&samples);
    let hue_picks = farthest_point_sampling_seeded(&hue_pool, k - 1, cream_linear, seed);

    // Light k-means polish on the hue picks with cream pinned, so a
    // single noisy anchor pixel settles on its local cluster mean but
    // the luminance carrier doesn't drift toward image hue.
    let mut working = palette.clone();
    working.extend(hue_picks);
    let polished = polish_kmeans_fixed_first(&hue_pool, working);

    // Saturation-boost slots 1..k toward each entry's channel-maximum.
    // Preserves hue direction (the cluster the picker found) while
    // restoring the linear magnitude lost by picking a dim image pixel.
    let boosted = boost_hue_slots(polished);
    Ok(linear_to_srgb_bytes(&boosted))
}

fn srgb_to_linear_triple(bytes: [u8; 3]) -> [f32; 3] {
    [
        srgb_to_linear(bytes[0] as f32 / 255.0),
        srgb_to_linear(bytes[1] as f32 / 255.0),
        srgb_to_linear(bytes[2] as f32 / 255.0),
    ]
}

fn above_board_or_all(samples: &[[f32; 3]]) -> Vec<[f32; 3]> {
    let filtered = filter_above_board(samples);
    // If the image is entirely dark (every sample sits at or below the
    // board), fall back to the full set so we still return k colors.
    if filtered.is_empty() {
        samples.to_vec()
    } else {
        filtered
    }
}

/// Pushes each entry's largest channel up to HUE_BOOST_TARGET while
/// preserving the entry's direction in linear RGB. Entry 0 (cream) is
/// left untouched. A black entry maps to black (no meaningful hue to
/// boost).
fn boost_hue_slots(palette: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    palette
        .into_iter()
        .enumerate()
        .map(|(i, c)| if i == 0 { c } else { boost_entry(c) })
        .collect()
}

fn boost_entry(c: [f32; 3]) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    if max <= 1e-4 {
        return c;
    }
    let scale = HUE_BOOST_TARGET / max;
    // Clamp to valid linear range; a pre-boost entry already near 1.0
    // stays near 1.0 (scale ≈ HUE_BOOST_TARGET ≈ 0.95, a small pull
    // inward) rather than overshooting.
    [
        (c[0] * scale).min(HUE_BOOST_TARGET),
        (c[1] * scale).min(HUE_BOOST_TARGET),
        (c[2] * scale).min(HUE_BOOST_TARGET),
    ]
}

/// Drop samples whose Rec.709 luminance is within `MIN_PALETTE_MARGIN` of
/// the board. Returned samples are the "usefully-bright" pool the palette
/// picker should actually consider.
fn filter_above_board(samples: &[[f32; 3]]) -> Vec<[f32; 3]> {
    let threshold = BOARD_LUMINANCE + MIN_PALETTE_MARGIN;
    samples
        .iter()
        .copied()
        .filter(|c| rec709(*c) > threshold)
        .collect()
}

/// Rec.709 relative luminance of a linear-RGB triple.
fn rec709(c: [f32; 3]) -> f32 {
    0.212_6 * c[0] + 0.715_2 * c[1] + 0.072_2 * c[2]
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

/// Farthest-point sampling in OkLab, anchored at an explicit seed color
/// (typically cream). Gonzalez 1985 k-center: each new pick is the image
/// sample whose minimum OkLab distance to the already-picked set is
/// maximum. Returns `k` samples drawn from the input pool.
fn farthest_point_sampling_seeded(
    samples: &[[f32; 3]],
    k: usize,
    anchor_linear: [f32; 3],
    seed: u64,
) -> Vec<[f32; 3]> {
    if k == 0 || samples.is_empty() {
        return Vec::new();
    }
    let mut rng = ChaCha8Rng::seed_from_u64(seed);

    let anchor_lab = linear_rgb_to_oklab(anchor_linear);
    let labs: Vec<[f32; 3]> = samples.iter().map(|&c| linear_rgb_to_oklab(c)).collect();

    // Distances to the anchor seed initialize the working set.
    let mut dists: Vec<f32> = labs.iter().map(|l| sq_dist(l, &anchor_lab)).collect();
    let mut picks: Vec<usize> = Vec::with_capacity(k);

    while picks.len() < k {
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
                // Reservoir-sample among ties for seed stability.
                if rng.gen_range(0..tied) == 0 {
                    best = i;
                }
            }
        }
        if best_d <= 0.0 {
            // Remaining samples are duplicates of existing picks or the
            // anchor. Pad with the last pick so the caller always gets
            // `k` entries.
            while picks.len() < k {
                picks.push(*picks.last().unwrap_or(&best));
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

/// Short k-means polish with slot 0 pinned. Every iteration reassigns
/// samples to their nearest palette entry in linear RGB, then recomputes
/// the non-first centroids from the current clusters. The first centroid
/// (the cream anchor) is left untouched so it doesn't drift into image
/// hue.
fn polish_kmeans_fixed_first(samples: &[[f32; 3]], init: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    if init.is_empty() {
        return init;
    }
    let mut centroids = init;
    let k = centroids.len();
    let mut assignments = vec![0usize; samples.len()];
    for _ in 0..POLISH_ITERS {
        if !assign_to_nearest(samples, &centroids, &mut assignments) {
            break;
        }
        let fresh = recompute_centroids(samples, &assignments, &centroids, k);
        // Pin slot 0; let the hue slots move.
        centroids
            .iter_mut()
            .enumerate()
            .skip(1)
            .for_each(|(i, c)| *c = fresh[i]);
    }
    centroids
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
    fn three_panels_with_k_four_yields_cream_plus_rgb() {
        // k=4 gives cream (slot 0) plus three image-derived hues. On an
        // R/G/B panel image FPS-after-cream picks one pixel per primary,
        // and the saturation boost pushes each to near-max on its strong
        // channel.
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
        let out = extract_palette_bytes(&rgba, size, 4, 13).unwrap();
        assert_eq!(out.len(), 12);
        let colors: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        assert_eq!(
            colors[0], CREAM_SRGB,
            "slot 0 must be cream: {:?}",
            colors[0]
        );
        let mut has_red = false;
        let mut has_green = false;
        let mut has_blue = false;
        for c in &colors[1..] {
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
    fn cream_is_always_slot_zero() {
        // Even on a warm-toned image the auto palette must begin with
        // cream so the solver always has a luminance carrier.
        let rgba = rgb_image(64, |_, _| [150, 60, 40]);
        let out = extract_palette_bytes(&rgba, 64, 3, 42).unwrap();
        assert_eq!(out.len(), 9);
        assert_eq!(&out[..3], &CREAM_SRGB[..]);
    }

    #[test]
    fn hue_slots_are_saturation_boosted() {
        // A dim brown image would previously return dim brown threads;
        // after the boost each hue slot should have its strongest channel
        // well above the raw image value.
        let rgba = rgb_image(64, |_, _| [60, 30, 15]); // dark warm brown
        let out = extract_palette_bytes(&rgba, 64, 2, 1).unwrap();
        let hue = &out[3..6];
        let max_channel = *hue.iter().max().unwrap();
        assert!(
            max_channel > 180,
            "hue slot not boosted, max channel = {max_channel}",
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
