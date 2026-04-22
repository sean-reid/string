//! Palette extraction for a photo, tuned for **additive reconstruction**
//! on a dark board.
//!
//! The problem a naive "dominant image colors" method runs into on
//! a portrait with a sky background: the sky is a huge fraction of
//! pixels, so k-means / quantization / any volume-based method ranks
//! blue near the top. That produces a "blue thread", and the solver
//! — seeing lots of blue pixels to cover — spends a huge share of
//! its line budget on the sky while the face goes under-represented.
//!
//! The fix is to treat palette extraction as a **subject-aware**
//! operation. When a face box is known, samples outside the face get
//! heavily down-weighted before any extrema search happens; the sky
//! samples are still in the pool, but their importance is near zero,
//! so they cannot win hull vertices in the simplification.
//!
//! The extraction itself is **Tan et al. 2016** ("Decomposing Images
//! into Layers via RGB-space Geometry") in spirit: the palette is a
//! small set of vertices whose convex hull encloses the image's
//! relevant pixel distribution in linear RGB. We approximate the
//! full hull-simplification with a cheap and well-known substitute —
//! **farthest-point sampling** (Gonzalez 1985) on the weighted
//! sample cloud. Slot 0 is the brightest weighted sample; each
//! subsequent slot is the sample that maximizes
//! `min_euclidean_distance_to_picked * importance`. FPS provably
//! picks hull vertices, which is exactly what Tan's algorithm
//! converges to; running it in linear RGB means every pick is a
//! real image color (no synthetic primaries to drift off-hue).
//!
//! Applied on the face-weighted pool, this yields a palette whose
//! non-negative combinations reproduce the **face**'s gamut — blue
//! sky thread only appears if blue is present in the face region
//! (eye irises, rim light, shadow, jewelry), which is when the user
//! actually wants it.
//!
//! k=1 is a deliberate exception: palette-of-one is the aesthetic
//! mono path and returns the traditional `#f4efe5` cream verbatim
//! regardless of image content.

use crate::solver::palette::srgb_to_linear;
use crate::solver::weight::FaceBox;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;

/// sRGB of the classic cream thread. Mono mode (k=1) returns this
/// verbatim — matches the warm off-white cotton a hand-built piece
/// tends to use.
const CREAM_SRGB: [u8; 3] = [0xF4, 0xEF, 0xE5];

/// Target linear magnitude for saturation-boosted palette entries. We
/// leave a touch of headroom below 1.0 so boosted colors still look
/// like thread rather than digital neon.
const HUE_BOOST_TARGET: f32 = 0.95;

/// Rec.709 luminance of the dark disc the threads sit on. Samples at
/// or near this luminance contribute no usable light.
const BOARD_LUMINANCE: f32 = 0.003_631;
/// Minimum linear-luminance margin above the board for a sample to be
/// eligible as a palette vertex.
const MIN_PALETTE_MARGIN: f32 = 0.05;

/// Importance floor for samples outside the face gaussian. Non-zero so
/// the pool is never empty on a portrait where the face detection is
/// slightly off; small enough that a sky or background pixel can't
/// outrun a face-region pick on the `dist * importance` score.
const BACKGROUND_FLOOR: f32 = 0.03;
/// Peak importance (face center) when a face box is provided.
const FACE_PEAK: f32 = 1.0;
/// Gaussian radius multiplier for palette sampling. Tighter than the
/// solver's scoring gaussian (1.2× there) because palette extraction
/// needs a strong inside-vs-outside separation: a saturated outlier
/// like a blue sky has ~4× the color-space distance of any
/// inside-face vertex, so even a modestly-high weight just outside
/// the face is enough for it to outrank real face vertices. A 0.6×
/// sigma keeps the falloff mostly inside the face box.
const FACE_SIGMA_MUL: f32 = 0.6;

/// Public entry point. `face` weights the sample pool so palette
/// picks come from the face region when one is known; pass `None` to
/// treat every sample equally.
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

    let weighted = downsample_weighted(rgba, size, face);
    if weighted.is_empty() {
        return Ok(CREAM_SRGB.repeat(k));
    }

    let pool = above_board_or_all(&weighted);
    let picks = farthest_point_sampling(&pool, k);
    let boosted = boost_palette(picks);
    // Build order: darkest thread first, brightest last. On a dark
    // board the builder lays the low-luminance threads down first so
    // the bright highlights stack on top and aren't obscured by
    // subsequent passes. Stable sort so ties (e.g. two similarly-dark
    // hues) keep the FPS-discovery order.
    let ordered = order_for_build(boosted);
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

/// One downsampled sample: color in linear RGB + an importance weight
/// from the face gaussian (or uniform when no face is known).
#[derive(Clone, Copy)]
struct WeightedSample {
    color: [f32; 3],
    weight: f32,
}

/// Tile-average the input to `SAMPLE_DIM × SAMPLE_DIM` and attach each
/// tile's mean face-importance weight. A face-weighted sample cloud
/// is what keeps sky pixels from dominating the subsequent FPS.
fn downsample_weighted(rgba: &[u8], size: usize, face: Option<FaceBox>) -> Vec<WeightedSample> {
    let tile = size.max(SAMPLE_DIM) / SAMPLE_DIM;
    let dim = (size / tile).max(1);
    let mut out = Vec::with_capacity(dim * dim);
    for ty in 0..dim {
        for tx in 0..dim {
            let mut sum = [0.0f32; 3];
            let mut wsum = 0.0f32;
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
                    wsum += sample_weight(face, x as f32, y as f32);
                    n += 1;
                }
            }
            if n > 0 {
                let inv = 1.0 / n as f32;
                out.push(WeightedSample {
                    color: [sum[0] * inv, sum[1] * inv, sum[2] * inv],
                    weight: wsum * inv,
                });
            }
        }
    }
    out
}

fn sample_weight(face: Option<FaceBox>, x: f32, y: f32) -> f32 {
    let Some(face) = face else {
        return FACE_PEAK;
    };
    let cx = face.x + face.w * 0.5;
    let cy = face.y + face.h * 0.5;
    let sx = (face.w * 0.5 * FACE_SIGMA_MUL).max(1.0);
    let sy = (face.h * 0.5 * FACE_SIGMA_MUL).max(1.0);
    let dx = (x - cx) / sx;
    let dy = (y - cy) / sy;
    let g = (-0.5 * (dx * dx + dy * dy)).exp();
    BACKGROUND_FLOOR + (FACE_PEAK - BACKGROUND_FLOOR) * g
}

fn above_board_or_all(samples: &[WeightedSample]) -> Vec<WeightedSample> {
    let threshold = BOARD_LUMINANCE + MIN_PALETTE_MARGIN;
    let filtered: Vec<WeightedSample> = samples
        .iter()
        .copied()
        .filter(|s| rec709(s.color) > threshold)
        .collect();
    if filtered.is_empty() {
        samples.to_vec()
    } else {
        filtered
    }
}

/// Farthest-point sampling in linear RGB. Slot 0 is the weighted
/// brightness extreme (importance-scaled Rec.709 luminance); each
/// subsequent slot is the sample that maximizes
/// `min_distance_to_picked * importance`. This is Tan-simplification's
/// practical approximation: FPS provably converges to hull vertices,
/// and importance weighting keeps sky / background from winning any
/// slot when a face box is present.
fn farthest_point_sampling(pool: &[WeightedSample], k: usize) -> Vec<[f32; 3]> {
    if pool.is_empty() {
        return Vec::new();
    }
    let mut picks: Vec<[f32; 3]> = Vec::with_capacity(k);
    let mut min_dist: Vec<f32> = vec![f32::INFINITY; pool.len()];

    let mut slot0 = 0usize;
    let mut best_score = f32::NEG_INFINITY;
    for (i, s) in pool.iter().enumerate() {
        let score = rec709(s.color) * s.weight;
        if score > best_score {
            best_score = score;
            slot0 = i;
        }
    }
    picks.push(pool[slot0].color);
    update_min_dist(pool, pool[slot0].color, &mut min_dist);

    while picks.len() < k {
        let mut best = 0usize;
        let mut best_score = f32::NEG_INFINITY;
        for (i, s) in pool.iter().enumerate() {
            // Score uses linear distance, not squared. Squared distance
            // gives a saturated-primary outlier a quartic advantage
            // over a closer face-region vertex, which lets background
            // blues win even with 0.1× importance. Linear distance
            // keeps the `distance × importance` trade-off balanced.
            let score = min_dist[i].sqrt() * s.weight;
            if score > best_score {
                best_score = score;
                best = i;
            }
        }
        if best_score <= 0.0 {
            // Pool exhausted (duplicate samples or k > unique colors).
            // Pad with the last pick so callers still get k entries;
            // the saturation-boost step pulls each to its hue extreme.
            picks.push(*picks.last().unwrap());
            continue;
        }
        picks.push(pool[best].color);
        update_min_dist(pool, pool[best].color, &mut min_dist);
    }
    picks
}

fn update_min_dist(pool: &[WeightedSample], picked: [f32; 3], min_dist: &mut [f32]) {
    for (i, s) in pool.iter().enumerate() {
        let d = sq_distance(s.color, picked);
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

fn boost_palette(palette: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    palette.into_iter().map(boost_entry).collect()
}

fn boost_entry(c: [f32; 3]) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    if max <= 1e-4 {
        return c;
    }
    let scale = HUE_BOOST_TARGET / max;
    [
        (c[0] * scale).min(HUE_BOOST_TARGET),
        (c[1] * scale).min(HUE_BOOST_TARGET),
        (c[2] * scale).min(HUE_BOOST_TARGET),
    ]
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
    fn face_box_biases_palette_toward_face_colors() {
        // Background is saturated blue, face region spans two warm
        // hues (highlight + midtone). Without face weighting, FPS is
        // dominated by the background: slot 0 is the bright blue
        // extreme. With face weighting, slot 0 comes from the warm
        // face region instead — which is the critical property for
        // the solver's per-color budget to favor face over sky.
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
                if ((x + y) & 1) == 0 {
                    [230, 170, 130]
                } else {
                    [170, 90, 60]
                }
            } else {
                [20, 20, 240]
            }
        });

        // k=2 on the fixture: face has two hues, sky is one hue — a
        // total of three distinct vertices. The weighted palette must
        // pick its two slots from the face; the unweighted palette
        // will pick the two strongest hull extremes which includes
        // the saturated blue.
        let without_face = extract_palette_bytes(&rgba, size, 2, 0, None).unwrap();
        let with_face = extract_palette_bytes(
            &rgba,
            size,
            2,
            0,
            Some(FaceBox {
                x: face_x,
                y: face_y,
                w: face_w,
                h: face_h,
            }),
        )
        .unwrap();

        let has_blue = |bytes: &[u8]| bytes.chunks_exact(3).any(|c| c[2] > 150 && c[0] < 80);
        assert!(
            has_blue(&without_face),
            "sanity: unweighted palette should include the saturated blue: {without_face:?}"
        );
        assert!(
            !has_blue(&with_face),
            "face-weighted palette leaked background blue: {with_face:?}"
        );
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
    fn palette_entries_are_saturation_boosted() {
        // A dim brown image would previously return dim brown threads;
        // after the boost each slot should have its strongest channel
        // well above the raw image value.
        let rgba = rgb_image(64, |_, _| [60, 30, 15]);
        let out = extract_palette_bytes(&rgba, 64, 2, 1, None).unwrap();
        for entry in out.chunks_exact(3) {
            let max = *entry.iter().max().unwrap();
            assert!(max > 180, "slot not boosted, max channel = {max}");
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
