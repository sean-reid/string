//! Palette extraction for a photo, tuned for **additive reconstruction**
//! on a dark board. Threads physically add light; the palette must be a
//! basis whose non-negative combinations can reach every target pixel.
//!
//! The failure mode that cluster-center methods (k-means, MMCQ, FPS on
//! the image alone) all fall into: a warm photo has all its samples in
//! the warm sliver of linear-RGB space, so any selection of image
//! samples shares roughly the same hue direction. Six image-derived
//! "extremes" on a face photo are six slight variations of the same
//! salmon. Mathematically, no combination of collinear vectors can
//! reach pixels outside that line — so shadow regions that lean cool,
//! or eye/iris highlights with real blue, cannot be reconstructed.
//!
//! Correct approach for this context: the palette must span hue
//! directions the image *could* use, even if those directions aren't
//! heavily represented in the image's pixel distribution. This is the
//! convex-hull-of-the-image idea from Tan et al. 2016 approximated by
//! a cheap heuristic:
//!
//! 1. **Slot 0 is cream (k=1) or a brightness anchor (k≥2)** — in the
//!    multi-color case, the sample whose OkLab L is closest to the
//!    top-1% luminance mean. That's the image's own bright color.
//! 2. **Slots 1..k come from pre-defined hue directions in linear RGB**
//!    (red, blue, green, yellow, magenta, cyan, in that order of
//!    priority). For each target direction we find the image sample
//!    that projects furthest along it. If the best projection is
//!    strong (sample has meaningful content in that hue), we use that
//!    image sample. If the image has nothing in that direction, we
//!    **fall back to the saturated primary** itself — the user needs
//!    a thread there to reconstruct shadows or reflections that lean
//!    that way, even when the direct subject doesn't.
//! 3. Every slot is **saturation-boosted** toward its own channel
//!    extreme so a dim picked sample still contributes real linear
//!    magnitude per line.
//!
//! This guarantees gamut coverage (six threads in six different hue
//! directions) while still pulling the picks from the image whenever
//! the image has meaningful content in that direction. No convex-hull
//! computation or archetypal analysis — just N dot products against
//! pre-chosen directions.
//!
//! Runtime at 128×128 downsample + k ≤ 6: under 3 ms in wasm.

use crate::solver::palette::srgb_to_linear;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;
/// sRGB of the classic cream thread. Mono mode (k=1) returns this
/// verbatim — matches the warm off-white cotton a hand-built piece
/// tends to use.
const CREAM_SRGB: [u8; 3] = [0xF4, 0xEF, 0xE5];
/// Percentile of the brightest samples averaged into the slot-0
/// brightness anchor. The top 1% resists single-pixel specular or
/// JPEG-artifact noise; the closest actual sample to that mean is
/// taken as slot 0 so the anchor is always an image-derived color.
const HIGHLIGHT_PERCENTILE: f32 = 0.01;
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

/// Hue directions the multi-color auto palette tries to populate, in
/// priority order. The algorithm picks the image sample that best
/// points in each direction, falling back to the synthetic primary
/// when the image has no sample with a strong enough alignment.
///
/// Order matches "most useful thread to have first" — cream/L is
/// slot 0 separately, so these fill slots 1..k. Red before blue
/// because warm threads carry skin / wood / most-portrait tones;
/// blue before green because shadows + sky lean blue; green last
/// because most photos have green only in specific subjects.
const HUE_DIRECTIONS: &[[f32; 3]] = &[
    [1.0, 0.0, 0.0], // red
    [0.0, 0.0, 1.0], // blue
    [0.0, 1.0, 0.0], // green
    [1.0, 1.0, 0.0], // yellow
    [1.0, 0.0, 1.0], // magenta
    [0.0, 1.0, 1.0], // cyan
];

/// Minimum cosine alignment between a sample's **chromatic vector**
/// (sample with the achromatic gray component subtracted) and a hue
/// direction. 0.7 corresponds to a ~45° spread; a sample within 45° of
/// the target direction is "close enough" to carry it. Must operate on
/// the chromatic vector because a bright gray sample like
/// `[0.9, 0.9, 0.9]` has cosine 0.577 with every primary axis — using
/// raw samples would let near-white pixels masquerade as blue/green.
const HUE_ALIGNMENT_THRESHOLD: f32 = 0.7;

/// Minimum chromatic magnitude (linear RGB) an image sample must have
/// to be considered for a hue slot. Below this the sample is
/// effectively gray; its hue direction is numerical noise and we'd
/// rather fall back to the synthetic primary.
const MIN_CHROMA: f32 = 0.03;

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
        // Palette-of-one keeps the traditional cream thread — this is
        // the mono path and stays visually compatible with hand-built
        // pieces that use off-white cotton.
        return Ok(CREAM_SRGB.to_vec());
    }
    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        // No usable samples (fully transparent image). Manual mode
        // lets the user pick something that makes sense.
        return Ok(CREAM_SRGB.repeat(k));
    }

    let pool = above_board_or_all(&samples);

    // Slot 0: image-derived brightness anchor. Not a hardcoded color —
    // the sample closest to the top-1% luminance mean, so a warm photo
    // gets a warm anchor and a cool photo a cool one.
    let anchor_idx = highlight_anchor_index(&pool);
    let anchor = pool[anchor_idx];

    // Slots 1..k: pick one sample per hue direction in
    // HUE_DIRECTIONS priority order, or fall back to the synthetic
    // primary when the image has no meaningful content in that
    // direction. Guarantees gamut coverage on any image.
    let mut working = Vec::with_capacity(k);
    working.push(anchor);
    for &direction in HUE_DIRECTIONS.iter().take(k - 1) {
        working.push(pick_hue_or_fallback(&pool, direction, anchor));
    }

    // Saturation-boost every slot toward its own channel-maximum so
    // dim picked samples still contribute real linear magnitude per
    // drawn line.
    let boosted = boost_palette(working);
    // Silence unused-seed warning; retained in signature for future
    // per-image deterministic tie-breaking.
    let _ = seed;
    Ok(linear_to_srgb_bytes(&boosted))
}

/// Return the image sample whose chromatic direction best aligns with
/// `target` in linear RGB. Chromatic direction = sample minus its
/// achromatic (gray) component; this prevents bright gray samples from
/// being mistaken for any primary since they have zero chromatic
/// magnitude. If no sample passes the alignment+chroma thresholds we
/// fall back to the synthetic primary. `avoid` is excluded so the
/// brightness anchor isn't returned twice.
fn pick_hue_or_fallback(pool: &[[f32; 3]], target: [f32; 3], avoid: [f32; 3]) -> [f32; 3] {
    let t_base = target[0].min(target[1]).min(target[2]);
    let t_chr = [target[0] - t_base, target[1] - t_base, target[2] - t_base];
    let t_mag = (t_chr[0] * t_chr[0] + t_chr[1] * t_chr[1] + t_chr[2] * t_chr[2]).sqrt();
    if t_mag <= 0.0 {
        return target;
    }
    let t_unit = [t_chr[0] / t_mag, t_chr[1] / t_mag, t_chr[2] / t_mag];

    let mut best: Option<[f32; 3]> = None;
    let mut best_score = 0.0f32;
    for s in pool {
        if s == &avoid {
            continue;
        }
        let base = s[0].min(s[1]).min(s[2]);
        let chr = [s[0] - base, s[1] - base, s[2] - base];
        let mag = (chr[0] * chr[0] + chr[1] * chr[1] + chr[2] * chr[2]).sqrt();
        if mag < MIN_CHROMA {
            continue;
        }
        let alignment = (chr[0] * t_unit[0] + chr[1] * t_unit[1] + chr[2] * t_unit[2]) / mag;
        if alignment < HUE_ALIGNMENT_THRESHOLD {
            continue;
        }
        // Combine alignment (how cleanly the chroma points at the
        // target) with chroma magnitude (how saturated the sample is).
        // A strongly saturated sample with decent alignment beats a
        // perfectly-aligned but barely-chromatic one.
        let score = alignment * mag;
        if score > best_score {
            best_score = score;
            best = Some(*s);
        }
    }
    best.unwrap_or(target)
}

fn highlight_anchor_index(samples: &[[f32; 3]]) -> usize {
    if samples.is_empty() {
        return 0;
    }
    // Sort indices by OkLab L, descending, via partial sort to find
    // the top HIGHLIGHT_PERCENTILE slice.
    let labs: Vec<f32> = samples.iter().map(|&c| linear_rgb_to_oklab(c)[0]).collect();
    let count = ((samples.len() as f32) * HIGHLIGHT_PERCENTILE).ceil() as usize;
    let count = count.max(1).min(samples.len());
    let mut idx: Vec<usize> = (0..samples.len()).collect();
    idx.select_nth_unstable_by(samples.len() - count, |&a, &b| {
        labs[a]
            .partial_cmp(&labs[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let top = &idx[samples.len() - count..];
    // Return the sample closest to the OkLab mean of the top slice so
    // the anchor is robust to a single noisy specular highlight.
    let mut mean_l = 0.0f32;
    for &i in top {
        mean_l += labs[i];
    }
    let target_l = mean_l / top.len() as f32;
    let mut best = top[0];
    let mut best_d = f32::INFINITY;
    for &i in top {
        let d = (labs[i] - target_l).abs();
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
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
/// preserving the entry's direction in linear RGB. A black entry maps
/// to black (no meaningful hue to boost). Applied to every slot,
/// including slot 0 — the brightness anchor should hit near-white
/// regardless of how dim the image's brightest region is.
fn boost_palette(palette: Vec<[f32; 3]>) -> Vec<[f32; 3]> {
    palette.into_iter().map(boost_entry).collect()
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

/// Convert linear sRGB (0..1) to OkLab. Only `L` is used now (the
/// brightness anchor step), but keeping the full transform makes the
/// function handy if we layer perceptual distance back on later.
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
    fn three_panels_with_k_three_picks_all_primaries() {
        // On an R/G/B panel image, k=3 lets FPS pick one pixel per
        // primary (after brightness-anchor + sat boost, each ends up
        // near-saturated on its strong channel). No slot is hardcoded;
        // every palette entry comes from the image.
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
    fn mono_palette_returns_cream() {
        // k=1 is the aesthetic mono path: always cream regardless of
        // image content. No algorithmic pick here; the value is a
        // deliberate backward-compat choice.
        let warm = rgb_image(64, |_, _| [150, 60, 40]);
        assert_eq!(
            extract_palette_bytes(&warm, 64, 1, 42).unwrap(),
            CREAM_SRGB.to_vec()
        );
        let cool = rgb_image(64, |_, _| [20, 60, 150]);
        assert_eq!(
            extract_palette_bytes(&cool, 64, 1, 42).unwrap(),
            CREAM_SRGB.to_vec()
        );
    }

    #[test]
    fn multi_color_slot_zero_is_image_derived_not_forced() {
        // On a warm image slot 0 should be a warm highlight color; on a
        // cool image, a cool highlight. The algorithm picks the
        // brightest region, not a hardcoded anchor.
        let warm = rgb_image(64, |_, _| [200, 120, 80]);
        let out = extract_palette_bytes(&warm, 64, 3, 42).unwrap();
        assert_eq!(out.len(), 9);
        let slot0 = [out[0], out[1], out[2]];
        assert!(
            slot0[0] >= slot0[2],
            "warm slot 0 should lean warm: {slot0:?}"
        );
        let cool = rgb_image(64, |_, _| [80, 120, 200]);
        let out = extract_palette_bytes(&cool, 64, 3, 42).unwrap();
        let slot0 = [out[0], out[1], out[2]];
        assert!(
            slot0[2] >= slot0[0],
            "cool slot 0 should lean cool: {slot0:?}"
        );
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
