//! Palette extraction tuned for **subtractive reconstruction** on a
//! light board (Vrellis paradigm).
//!
//! Two entry points:
//!
//! - `extract_palette_bytes` picks `k` thread colors that best cover
//!   an image's gamut for color string-art reconstruction. Slot 0
//!   is always near-black (the universal shadow anchor), slots 1..k
//!   are data-driven chromatic centroids from saliency-weighted
//!   OKLab k-means. Centroids with OKLab chroma below
//!   `MUDDY_CHROMA_THRESHOLD` are rejected and the clustering re-
//!   runs for a smaller k — browns, greys, and the "muddy middle"
//!   collapse into a single warm-neutral wash on cream, so we
//!   actively keep them out of the palette.
//!
//! - `suggest_next_color` returns a single new color that best
//!   extends an existing partial palette's gamut coverage. Used by
//!   the UI `[+]` button.
//!
//! Fallback: if k-means can't produce enough chromatic centroids
//! (nearly greyscale images), we fall back to ranking a fixed
//! vocabulary of saturated thread primaries — the same approach the
//! pre-OKLab extractor used. That path is kept as
//! `primary_fallback_palette` so regression tests still cover it.

use crate::solver::palette::srgb_to_linear;
use crate::solver::weight::FaceBox;

const SAMPLE_DIM: usize = 96;
const MAX_K: usize = 8;

/// OKLab chroma below this value is treated as "muddy" — not a
/// productive thread color on a cream substrate. A brown or
/// desaturated skin-tone sits at ~0.04–0.08 chroma; saturated
/// primaries at ~0.12–0.30. Cream board + low-chroma thread looks
/// indistinguishable from cream board alone at viewing distance,
/// so we aggressively reject anything below clearly-saturated
/// territory and push centroids outward if the cluster is warm but
/// unsaturated. Raised from 0.10 after user reports of muddy
/// palette picks on skin-tone / landscape content — the boost
/// factor below was letting ~0.06 raw centroids whitewash through.
const MUDDY_CHROMA_THRESHOLD: f32 = 0.14;

/// When a raw k-means centroid is below `MUDDY_CHROMA_THRESHOLD`,
/// we try to "saturate" it by multiplying its (a, b) components by
/// this factor and keeping the original L. If the boosted result
/// still falls below threshold, the centroid is dropped. Tightened
/// from 1.8 to 1.3: an aggressive boost on a genuinely muddy cluster
/// ships a still-muddy thread that happens to clear the cutoff. At
/// 1.3 the boost only rescues clusters already close to saturated.
const CHROMA_BOOST_FACTOR: f32 = 1.3;

/// Minimum OKLab distance between two chromatic centroids for them
/// to be considered distinct. Below this, a candidate is rejected
/// as too close to an already-selected color — this is what
/// produces a gamut-diverse palette instead of three shades of
/// skin-tone brown. Empirically calibrated: ~0.12 is the smallest
/// perceptual gap a viewer can reliably distinguish on cream board
/// at Vrellis crossing densities; we enforce 0.18 so the palette
/// actually spans the wheel.
const GAMUT_DIVERSITY_MIN: f32 = 0.18;

/// Centroids brighter than `BOARD_LUMINANCE * BOARD_LIGHT_CAP_RATIO`
/// are rejected — a thread lighter than the cream board can't darken
/// the canvas. Without this cap, k-means on pale subjects (snow,
/// high-key portraits) can happily return a "near-cream" centroid
/// that the solver can never actually deposit.
const BOARD_LIGHT_CAP_RATIO: f32 = 0.95;

/// Linear-RGB Rec.709 luminance of the board. Mirrors
/// `solver::mod::BOARD_LUMINANCE`.
const BOARD_LUMINANCE: f32 =
    0.2126 * BOARD_LINEAR[0] + 0.7152 * BOARD_LINEAR[1] + 0.0722 * BOARD_LINEAR[2];

/// Minimum OKLab distance between two palette entries for them to be
/// considered distinct. Used in `suggest_next_color` to skip colors
/// that would duplicate what's already in the palette.
const DUPLICATE_EPSILON: f32 = 0.06;

/// sRGB of the default black thread. Mono mode (k=1) returns this
/// verbatim, and multi-color palettes anchor slot 0 here.
const BLACK_SRGB: [u8; 3] = [0x11, 0x11, 0x11];

/// Linear-RGB board color (cream #f4efe5). Must mirror
/// `solver::mod::BOARD_LINEAR`.
const BOARD_LINEAR: [f32; 3] = [0.904_587_8, 0.862_741_3, 0.784_452_6];

/// Canonical thread-color vocabulary — the fallback set the
/// extractor falls back to when an image is too greyscale to yield
/// chromatic k-means centroids, and the search space for
/// `suggest_next_color`. These are real embroidery/crochet thread
/// colors at roughly even intervals around hue space.
const CANONICAL_PRIMARIES: &[[u8; 3]] = &[
    [0x11, 0x11, 0x11], // near-black (shadow anchor; always slot 0)
    [0xb8, 0x1c, 0x1c], // saturated red
    [0xd9, 0x5a, 0x1c], // orange
    [0xd9, 0xa8, 0x1c], // saturated yellow
    [0x8a, 0x3c, 0x2c], // brick / terracotta
    [0xd9, 0x82, 0x82], // salmon / rose
    [0x1c, 0x88, 0x50], // deep green
    [0x3c, 0x5a, 0x1c], // olive / sage
    [0x1c, 0x88, 0xa8], // deep cyan
    [0x1c, 0x70, 0x70], // teal
    [0x1c, 0x3c, 0xa8], // saturated blue
    [0x5a, 0x1c, 0xa8], // purple
    [0xa8, 0x1c, 0x88], // deep magenta
];

/// Pick a palette of `k` thread colors. Slot 0 is always near-black.
/// Slots 1..k are saliency-weighted OKLab k-means centroids with
/// muddy-centroid rejection; if too few survive, the canonical
/// primary ranker fills the remainder. Output is sorted dark-to-light
/// and returned as `k * 3` sRGB bytes.
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

    let samples = sample_with_saliency(rgba, size, face);
    if samples.is_empty() {
        return Ok(BLACK_SRGB.repeat(k));
    }

    // Chromatic centroids come from saliency-weighted OKLab k-means
    // on samples that aren't already well-explained by the black
    // anchor — i.e., exclude near-black pixels so the chromatic
    // clustering doesn't waste a centroid on shadow.
    let black_oklab = linear_to_oklab(srgb_bytes_to_linear(BLACK_SRGB));
    let chromatic_samples: Vec<WeightedLab> = samples
        .iter()
        .filter(|s| oklab_distance(&s.oklab, &black_oklab) > 0.15)
        .cloned()
        .collect();

    let target_chromatic = k - 1;
    // Candidate pool = image-saturated rim samples + canonical thread
    // primaries. Canonical primaries ensure gamut coverage even when
    // an image sits in one hue lane (e.g. a warm portrait); image
    // samples let genuinely image-derived colors compete.
    let mut candidates = image_saturated_candidates(&chromatic_samples, target_chromatic * 3, seed);
    for primary in CANONICAL_PRIMARIES.iter().skip(1) {
        let lab = linear_to_oklab(srgb_bytes_to_linear(*primary));
        if oklab_chroma(lab) >= MUDDY_CHROMA_THRESHOLD {
            candidates.push(lab);
        }
    }
    let chromatic: Vec<[f32; 3]> = if candidates.is_empty() {
        Vec::new()
    } else {
        gamut_diverse_maxmin(&candidates, &chromatic_samples, target_chromatic)
    };

    let mut picks_oklab: Vec<[f32; 3]> = Vec::with_capacity(k);
    picks_oklab.push(linear_to_oklab(srgb_bytes_to_linear(BLACK_SRGB)));

    let mut picks: Vec<[u8; 3]> = Vec::with_capacity(k);
    picks.push(BLACK_SRGB);
    for candidate in &chromatic {
        if picks.len() >= k {
            break;
        }
        let bytes = oklab_to_srgb_bytes_clamped(*candidate);
        if picks.iter().any(|p| srgb_bytes_similar(*p, bytes)) {
            continue;
        }
        picks.push(bytes);
        picks_oklab.push(*candidate);
    }

    // If maxmin selection undersupplied (greyscale image, all samples
    // muddy), top up from the canonical primary ranker so we always
    // reach the requested palette size. The ranker's vocabulary is
    // saturated by construction; we still enforce gamut diversity
    // unless we're nearly empty, in which case we pad any canonical
    // primary rather than failing.
    if picks.len() < k {
        let fallback = primary_fallback_palette(&samples, k, &picks);
        let strict_diversity = picks.len() > 1;
        for c in fallback {
            if picks.len() >= k {
                break;
            }
            if picks.iter().any(|p| srgb_bytes_similar(*p, c)) {
                continue;
            }
            let cand = linear_to_oklab(srgb_bytes_to_linear(c));
            if strict_diversity
                && picks_oklab
                    .iter()
                    .any(|existing| oklab_distance(existing, &cand) < GAMUT_DIVERSITY_MIN)
            {
                continue;
            }
            picks.push(c);
            picks_oklab.push(cand);
        }

        // Last-ditch pad: if still short (e.g. very short fallback
        // list for a greyscale image), drop the diversity constraint
        // and fill from the canonical vocabulary.
        if picks.len() < k {
            for primary in CANONICAL_PRIMARIES.iter() {
                if picks.len() >= k {
                    break;
                }
                if picks.iter().any(|p| srgb_bytes_similar(*p, *primary)) {
                    continue;
                }
                picks.push(*primary);
                picks_oklab.push(linear_to_oklab(srgb_bytes_to_linear(*primary)));
            }
        }
    }

    picks.sort_by(|a, b| {
        rec709_srgb(*a)
            .partial_cmp(&rec709_srgb(*b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut out = Vec::with_capacity(picks.len() * 3);
    for p in &picks {
        out.extend_from_slice(p);
    }
    Ok(out)
}

/// Per-color explanatory share of the image's gamut.
///
/// Each saliency-weighted sample is assigned softly to the palette
/// entries it's perceptually closest to, using an OKLab-distance
/// softmax with temperature `SHARE_SOFTMAX_TEMPERATURE`. A color's
/// share is the fraction of saliency-weighted mass that falls to
/// it across the whole image. Returned shares sum to 1.0.
///
/// Perceptual distance (OKLab) rather than linear-RGB projection is
/// the right signal here: a red pixel projects almost as well onto
/// black's darkening basis as onto red's (black can darken any
/// channel), but perceptually it's far closer to a red thread. The
/// budget derivation we feed these shares into is a preference
/// signal for the solver, not a physical deposit calculation.
///
/// This is the image-aware input to per-color budget allocation:
/// a red-heavy portrait yields a large red share, a near-greyscale
/// landscape yields shares dominated by black. The UI then applies
/// a minimum floor + normalization before feeding the shares into
/// `SolverConfig.color_budgets` so no color starves to zero.
pub fn palette_explanatory_shares(
    rgba: &[u8],
    size: usize,
    palette_srgb: &[u8],
    face: Option<FaceBox>,
) -> Result<Vec<f32>, &'static str> {
    if rgba.len() != size * size * 4 {
        return Err("rgba length must equal width * height * 4");
    }
    #[allow(unknown_lints, clippy::manual_is_multiple_of)]
    let bad_len = palette_srgb.len() % 3 != 0;
    if bad_len || palette_srgb.is_empty() {
        return Err("palette must be a non-empty multiple of 3 bytes (rgb)");
    }
    let n = palette_srgb.len() / 3;

    let palette_oklab: Vec<[f32; 3]> = palette_srgb
        .chunks_exact(3)
        .map(|c| linear_to_oklab(srgb_bytes_to_linear([c[0], c[1], c[2]])))
        .collect();

    let samples = sample_with_saliency(rgba, size, face);
    if samples.is_empty() {
        return Ok(vec![1.0 / n as f32; n]);
    }

    let mut shares = vec![0.0f32; n];
    for s in &samples {
        let distances: Vec<f32> = palette_oklab
            .iter()
            .map(|p| oklab_distance(&s.oklab, p))
            .collect();
        let min_d = distances.iter().copied().fold(f32::INFINITY, f32::min);
        let mut exps = vec![0.0f32; n];
        let mut sum = 0.0f32;
        for (k, d) in distances.iter().enumerate() {
            let e = (-(d - min_d) / SHARE_SOFTMAX_TEMPERATURE).exp();
            exps[k] = e;
            sum += e;
        }
        if sum <= 1e-6 {
            continue;
        }
        let inv = s.weight / sum;
        for (k, e) in exps.iter().enumerate() {
            shares[k] += e * inv;
        }
    }

    let total: f32 = shares.iter().sum();
    if total <= 1e-6 {
        return Ok(vec![1.0 / n as f32; n]);
    }
    for s in &mut shares {
        *s /= total;
    }
    Ok(shares)
}

/// OKLab-distance softmax temperature used by
/// `palette_explanatory_shares`. Lower values sharpen assignment
/// toward the nearest palette entry; higher values spread each
/// pixel's mass more uniformly. `0.08` sits roughly between the
/// intra-swatch distance (~0.02) and inter-palette distance
/// (~0.15–0.30), so each pixel picks one clear winner while a
/// meaningfully close runner-up still gets non-trivial share.
const SHARE_SOFTMAX_TEMPERATURE: f32 = 0.08;

/// Given an image and an existing partial palette, return the single
/// best new color (sRGB bytes) to maximize gamut coverage. The
/// heuristic: for each canonical primary, score how much it reduces
/// the per-sample OKLab distance to the nearest existing palette
/// color, weighted by saliency; return the canonical primary with
/// the highest improvement. Primaries already present in the palette
/// (within `DUPLICATE_EPSILON` OKLab) are skipped.
pub fn suggest_next_color(
    rgba: &[u8],
    size: usize,
    existing_srgb: &[u8],
    face: Option<FaceBox>,
) -> Result<[u8; 3], &'static str> {
    if rgba.len() != size * size * 4 {
        return Err("rgba length must equal width * height * 4");
    }
    // `is_multiple_of` is unstable on our 1.83 MSRV; both the
    // fallback allow for older toolchains and the lint name for
    // 1.92+ have to be permitted for `cargo clippy -D warnings`.
    #[allow(unknown_lints, clippy::manual_is_multiple_of)]
    let bad_len = existing_srgb.len() % 3 != 0;
    if bad_len {
        return Err("existing palette must be a multiple of 3 bytes (rgb)");
    }

    // An empty palette always starts with the structural black
    // anchor — every Vrellis-style build needs it and returning
    // anything else makes the `[+]` button's first click surprising.
    if existing_srgb.is_empty() {
        return Ok(BLACK_SRGB);
    }

    let samples = sample_with_saliency(rgba, size, face);
    if samples.is_empty() {
        return Ok(CANONICAL_PRIMARIES[1]);
    }

    let existing_oklab: Vec<[f32; 3]> = existing_srgb
        .chunks_exact(3)
        .map(|c| linear_to_oklab(srgb_bytes_to_linear([c[0], c[1], c[2]])))
        .collect();

    // Baseline: per-sample distance to nearest existing palette color.
    // If the palette is empty, fall back to uniform baseline (infinite
    // distance) so any primary is an improvement.
    let baseline: Vec<f32> = samples
        .iter()
        .map(|s| {
            existing_oklab
                .iter()
                .map(|e| oklab_distance(&s.oklab, e))
                .fold(f32::INFINITY, f32::min)
        })
        .collect();

    let mut best_idx = 1usize;
    let mut best_score = f32::NEG_INFINITY;
    for (i, primary) in CANONICAL_PRIMARIES.iter().enumerate() {
        let p_oklab = linear_to_oklab(srgb_bytes_to_linear(*primary));
        if existing_oklab
            .iter()
            .any(|e| oklab_distance(e, &p_oklab) < DUPLICATE_EPSILON)
        {
            continue;
        }
        let mut score = 0.0f32;
        for (sample, &base) in samples.iter().zip(baseline.iter()) {
            let d = oklab_distance(&sample.oklab, &p_oklab);
            let improvement = if base.is_finite() {
                (base - d).max(0.0)
            } else {
                // No existing palette — score by inverse distance so
                // we prefer primaries close to the image content.
                (1.0 - d).max(0.0)
            };
            score += improvement * sample.weight;
        }
        if score > best_score {
            best_score = score;
            best_idx = i;
        }
    }
    Ok(CANONICAL_PRIMARIES[best_idx])
}

#[derive(Clone, Copy)]
struct WeightedLab {
    oklab: [f32; 3],
    weight: f32,
}

/// Downsample the image and compute OKLab + saliency weight per
/// sample. Saliency multiplies a face-box emphasis into each sample
/// weight; without a face box, all samples weigh equally.
fn sample_with_saliency(rgba: &[u8], size: usize, face: Option<FaceBox>) -> Vec<WeightedLab> {
    let tile = size.max(SAMPLE_DIM) / SAMPLE_DIM;
    let dim = (size / tile).max(1);
    let mut out = Vec::with_capacity(dim * dim);
    let face_cx = face.map(|f| f.x + f.w * 0.5);
    let face_cy = face.map(|f| f.y + f.h * 0.5);
    let face_sx = face.map(|f| (f.w * 0.6).max(1.0));
    let face_sy = face.map(|f| (f.h * 0.6).max(1.0));
    for ty in 0..dim {
        for tx in 0..dim {
            let mut sum = [0.0f32; 3];
            let mut n = 0u32;
            let y_start = ty * tile;
            let x_start = tx * tile;
            let y_end = (y_start + tile).min(size);
            let x_end = (x_start + tile).min(size);
            for y in y_start..y_end {
                for x in x_start..x_end {
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
            if n == 0 {
                continue;
            }
            let inv = 1.0 / n as f32;
            let linear = [sum[0] * inv, sum[1] * inv, sum[2] * inv];
            let oklab = linear_to_oklab(linear);
            let cx = (x_start + x_end) as f32 * 0.5;
            let cy = (y_start + y_end) as f32 * 0.5;
            let weight = face_weight(cx, cy, face_cx, face_cy, face_sx, face_sy);
            out.push(WeightedLab { oklab, weight });
        }
    }
    out
}

fn face_weight(
    x: f32,
    y: f32,
    cx: Option<f32>,
    cy: Option<f32>,
    sx: Option<f32>,
    sy: Option<f32>,
) -> f32 {
    match (cx, cy, sx, sy) {
        (Some(cx), Some(cy), Some(sx), Some(sy)) => {
            let dx = (x - cx) / sx;
            let dy = (y - cy) / sy;
            1.0 + 1.5 * (-0.5 * (dx * dx + dy * dy)).exp()
        }
        _ => 1.0,
    }
}

/// Extract saturated-rim OKLab candidates from the image's chromatic
/// samples by clustering, then replacing each centroid with the
/// highest-chroma sample in its cluster (plus a saturation boost for
/// any that still land in the muddy middle). These are the
/// image-derived candidates; `gamut_diverse_maxmin` merges them with
/// canonical primaries for the final palette pick.
fn image_saturated_candidates(
    samples: &[WeightedLab],
    cluster_count: usize,
    seed: u64,
) -> Vec<[f32; 3]> {
    if cluster_count == 0 || samples.is_empty() {
        return Vec::new();
    }
    let actual_k = cluster_count.min(samples.len()).max(1);
    let centroids = oklab_kmeans(samples, actual_k, seed);
    let mut out = Vec::with_capacity(actual_k);
    for centroid in &centroids {
        let mut best: Option<[f32; 3]> = None;
        let mut best_chroma = -1.0f32;
        for s in samples {
            if oklab_distance(&s.oklab, centroid) > 0.12 {
                continue;
            }
            let c = oklab_chroma(s.oklab);
            if c > best_chroma {
                best_chroma = c;
                best = Some(s.oklab);
            }
        }
        let pick = best.unwrap_or(*centroid);
        let boosted = if oklab_chroma(pick) < MUDDY_CHROMA_THRESHOLD {
            [
                pick[0],
                pick[1] * CHROMA_BOOST_FACTOR,
                pick[2] * CHROMA_BOOST_FACTOR,
            ]
        } else {
            pick
        };
        if oklab_chroma(boosted) >= MUDDY_CHROMA_THRESHOLD && !too_light_for_board(boosted) {
            out.push(boosted);
        }
    }
    out
}

/// Greedy maxmin pick from a candidate pool. Starts with the highest-
/// chroma candidate and iteratively adds the one whose minimum OKLab
/// distance to already-chosen candidates is largest, tie-broken by
/// how much image-saliency-mass it would absorb. Produces a pairwise-
/// diverse palette that spans the color wheel even on monochromatic
/// images, because the canonical-primary half of the pool always
/// supplies a cool option when the image has none.
fn gamut_diverse_maxmin(
    candidates: &[[f32; 3]],
    samples: &[WeightedLab],
    k: usize,
) -> Vec<[f32; 3]> {
    if k == 0 || candidates.is_empty() {
        return Vec::new();
    }
    // Precompute per-candidate saliency match score: the saliency-
    // weighted count of image samples closer to this candidate than
    // any other. Candidates the image "wants" get a boost.
    let saliency_scores: Vec<f32> = candidates
        .iter()
        .map(|c| {
            let mut score = 0.0f32;
            for s in samples {
                let d = oklab_distance(&s.oklab, c);
                if d < 0.12 {
                    score += s.weight * (0.12 - d);
                }
            }
            score
        })
        .collect();

    // Seed with the highest-chroma candidate that also has some
    // saliency attraction — pushes the first pick toward the
    // image's dominant chromatic direction instead of an arbitrary
    // canonical primary.
    let mut seed_idx = 0usize;
    let mut seed_score = f32::NEG_INFINITY;
    for (i, c) in candidates.iter().enumerate() {
        let sc = oklab_chroma(*c) + saliency_scores[i] * 0.3;
        if sc > seed_score {
            seed_score = sc;
            seed_idx = i;
        }
    }
    let mut remaining: Vec<usize> = (0..candidates.len()).collect();
    remaining.swap_remove(remaining.iter().position(|&i| i == seed_idx).unwrap());
    let mut chosen: Vec<[f32; 3]> = vec![candidates[seed_idx]];

    while chosen.len() < k && !remaining.is_empty() {
        let mut best_pos: Option<usize> = None;
        let mut best_score = -1.0f32;
        for (pos, &i) in remaining.iter().enumerate() {
            let c = &candidates[i];
            let min_d = chosen
                .iter()
                .map(|ex| oklab_distance(ex, c))
                .fold(f32::INFINITY, f32::min);
            if min_d < GAMUT_DIVERSITY_MIN {
                continue;
            }
            // Score: minimum distance (gamut spread) dominates;
            // saliency and chroma break ties.
            let score = min_d + 0.15 * oklab_chroma(*c) + 0.08 * saliency_scores[i];
            if score > best_score {
                best_score = score;
                best_pos = Some(pos);
            }
        }
        let Some(pos) = best_pos else { break };
        let idx = remaining.swap_remove(pos);
        chosen.push(candidates[idx]);
    }
    chosen
}

fn too_light_for_board(oklab: [f32; 3]) -> bool {
    let linear = oklab_to_linear(oklab);
    let lum = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    lum > BOARD_LUMINANCE * BOARD_LIGHT_CAP_RATIO
}

fn oklab_kmeans(samples: &[WeightedLab], k: usize, seed: u64) -> Vec<[f32; 3]> {
    if k == 0 || samples.is_empty() {
        return Vec::new();
    }
    let mut centroids = kmeans_pp_init(samples, k, seed);
    let mut assignments = vec![0usize; samples.len()];
    for _ in 0..24 {
        let mut changed = false;
        for (i, s) in samples.iter().enumerate() {
            let mut best = 0usize;
            let mut best_d = f32::INFINITY;
            for (c, centroid) in centroids.iter().enumerate() {
                let d = oklab_distance(&s.oklab, centroid);
                if d < best_d {
                    best_d = d;
                    best = c;
                }
            }
            if assignments[i] != best {
                assignments[i] = best;
                changed = true;
            }
        }
        let mut sums = vec![[0.0f32; 3]; k];
        let mut wsum = vec![0.0f32; k];
        for (i, s) in samples.iter().enumerate() {
            let c = assignments[i];
            sums[c][0] += s.oklab[0] * s.weight;
            sums[c][1] += s.oklab[1] * s.weight;
            sums[c][2] += s.oklab[2] * s.weight;
            wsum[c] += s.weight;
        }
        for c in 0..k {
            if wsum[c] > 1e-6 {
                let inv = 1.0 / wsum[c];
                centroids[c] = [sums[c][0] * inv, sums[c][1] * inv, sums[c][2] * inv];
            }
        }
        if !changed {
            break;
        }
    }
    centroids
}

fn kmeans_pp_init(samples: &[WeightedLab], k: usize, seed: u64) -> Vec<[f32; 3]> {
    // Simple deterministic k-means++: seed first centroid at the
    // highest-weight sample, then repeatedly pick the sample farthest
    // from any existing centroid (weighted by saliency).
    let mut centroids = Vec::with_capacity(k);
    let mut best_idx = 0;
    let mut best_w = f32::NEG_INFINITY;
    for (i, s) in samples.iter().enumerate() {
        if s.weight > best_w {
            best_w = s.weight;
            best_idx = i;
        }
    }
    centroids.push(samples[best_idx].oklab);
    let mut rng = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    while centroids.len() < k {
        let mut total = 0.0f64;
        let distances: Vec<f32> = samples
            .iter()
            .map(|s| {
                let d = centroids
                    .iter()
                    .map(|c| oklab_distance(&s.oklab, c))
                    .fold(f32::INFINITY, f32::min);
                let score = d * d * s.weight;
                total += score as f64;
                score
            })
            .collect();
        if total <= 0.0 {
            // All samples coincide with existing centroids — bail out
            // with a nudged duplicate rather than looping forever.
            let last = *centroids.last().unwrap();
            centroids.push([last[0], last[1] + 0.01, last[2]]);
            continue;
        }
        // Deterministic pseudo-random draw using seed-derived rng.
        rng = rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let r = (rng >> 33) as f32 / u32::MAX as f32;
        let target = r as f64 * total;
        let mut acc = 0.0f64;
        let mut picked = 0usize;
        for (i, &d) in distances.iter().enumerate() {
            acc += d as f64;
            if acc >= target {
                picked = i;
                break;
            }
        }
        centroids.push(samples[picked].oklab);
    }
    centroids
}

/// Top up a palette from the canonical primary ranker when k-means
/// under-supplied. Reproduces the earlier pre-OKLab ranker behavior
/// (chromatic-basis projection) for legacy test coverage.
fn primary_fallback_palette(
    samples: &[WeightedLab],
    k: usize,
    already_picked: &[[u8; 3]],
) -> Vec<[u8; 3]> {
    let primaries_linear: Vec<[f32; 3]> = CANONICAL_PRIMARIES
        .iter()
        .map(|p| srgb_bytes_to_linear(*p))
        .collect();
    let darkening_basis: Vec<[f32; 3]> = primaries_linear
        .iter()
        .map(|c| {
            [
                (BOARD_LINEAR[0] - c[0]).max(0.0),
                (BOARD_LINEAR[1] - c[1]).max(0.0),
                (BOARD_LINEAR[2] - c[2]).max(0.0),
            ]
        })
        .collect();
    let chromatic_basis: Vec<[f32; 3]> = darkening_basis
        .iter()
        .map(|b| {
            let m = b[0].min(b[1]).min(b[2]);
            [b[0] - m, b[1] - m, b[2] - m]
        })
        .collect();

    let mut scores = vec![0.0f32; CANONICAL_PRIMARIES.len()];
    for s in samples {
        let linear = oklab_to_linear(s.oklab);
        let b = [
            (BOARD_LINEAR[0] - linear[0]).max(0.0),
            (BOARD_LINEAR[1] - linear[1]).max(0.0),
            (BOARD_LINEAR[2] - linear[2]).max(0.0),
        ];
        let m = b[0].min(b[1]).min(b[2]);
        let b_chrom = [b[0] - m, b[1] - m, b[2] - m];
        let mag = b_chrom[0] * b_chrom[0] + b_chrom[1] * b_chrom[1] + b_chrom[2] * b_chrom[2];
        if mag <= 1e-6 {
            continue;
        }
        for (i, basis) in chromatic_basis.iter().enumerate() {
            let basis_mag_sq = basis[0] * basis[0] + basis[1] * basis[1] + basis[2] * basis[2];
            if basis_mag_sq <= 1e-6 {
                continue;
            }
            let dot = b_chrom[0] * basis[0] + b_chrom[1] * basis[1] + b_chrom[2] * basis[2];
            if dot <= 0.0 {
                continue;
            }
            scores[i] += dot * s.weight / basis_mag_sq.sqrt();
        }
    }
    let mut ranked: Vec<(usize, f32)> = scores
        .iter()
        .enumerate()
        .skip(1)
        .map(|(i, &s)| (i, s))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = Vec::with_capacity(k);
    for (idx, _) in ranked {
        if out.len() >= k {
            break;
        }
        let c = CANONICAL_PRIMARIES[idx];
        // Skip canonical primaries that don't clear the muddiness
        // gate. Olive, brick, and salmon sit below the raised
        // threshold and muddy the palette when the fallback fires
        // on earth-toned content.
        let lab = linear_to_oklab(srgb_bytes_to_linear(c));
        if oklab_chroma(lab) < MUDDY_CHROMA_THRESHOLD {
            continue;
        }
        if already_picked
            .iter()
            .chain(out.iter())
            .any(|p| srgb_bytes_similar(*p, c))
        {
            continue;
        }
        out.push(c);
    }
    out
}

fn rec709_srgb(c: [u8; 3]) -> f32 {
    let r = c[0] as f32 / 255.0;
    let g = c[1] as f32 / 255.0;
    let b = c[2] as f32 / 255.0;
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn srgb_bytes_to_linear(c: [u8; 3]) -> [f32; 3] {
    [
        srgb_to_linear(c[0] as f32 / 255.0),
        srgb_to_linear(c[1] as f32 / 255.0),
        srgb_to_linear(c[2] as f32 / 255.0),
    ]
}

fn linear_to_srgb_byte(u: f32) -> u8 {
    let clamped = u.clamp(0.0, 1.0);
    let s = if clamped <= 0.003_130_8 {
        clamped * 12.92
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}

fn oklab_to_srgb_bytes_clamped(lab: [f32; 3]) -> [u8; 3] {
    let linear = oklab_to_linear(lab);
    [
        linear_to_srgb_byte(linear[0]),
        linear_to_srgb_byte(linear[1]),
        linear_to_srgb_byte(linear[2]),
    ]
}

fn srgb_bytes_similar(a: [u8; 3], b: [u8; 3]) -> bool {
    let dr = a[0] as i32 - b[0] as i32;
    let dg = a[1] as i32 - b[1] as i32;
    let db = a[2] as i32 - b[2] as i32;
    dr * dr + dg * dg + db * db < 64
}

fn oklab_distance(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let dl = a[0] - b[0];
    let da = a[1] - b[1];
    let db = a[2] - b[2];
    (dl * dl + da * da + db * db).sqrt()
}

fn oklab_chroma(c: [f32; 3]) -> f32 {
    (c[1] * c[1] + c[2] * c[2]).sqrt()
}

/// Björn Ottosson's OKLab (2020). Input is linear sRGB in [0,1].
#[allow(clippy::excessive_precision)]
fn linear_to_oklab(rgb: [f32; 3]) -> [f32; 3] {
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];
    let l = 0.412_221_47 * r + 0.536_332_56 * g + 0.051_445_995 * b;
    let m = 0.211_903_5 * r + 0.680_699_55 * g + 0.107_396_96 * b;
    let s = 0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b;
    let l_ = l.cbrt();
    let m_ = m.cbrt();
    let s_ = s.cbrt();
    [
        0.210_454_26 * l_ + 0.793_617_8 * m_ - 0.004_072_047 * s_,
        1.977_998_5 * l_ - 2.428_592_2 * m_ + 0.450_593_7 * s_,
        0.025_904_037 * l_ + 0.782_771_77 * m_ - 0.808_675_77 * s_,
    ]
}

#[allow(clippy::excessive_precision)]
fn oklab_to_linear(lab: [f32; 3]) -> [f32; 3] {
    let l_ = lab[0] + 0.396_337_78 * lab[1] + 0.215_803_76 * lab[2];
    let m_ = lab[0] - 0.105_561_346 * lab[1] - 0.063_854_17 * lab[2];
    let s_ = lab[0] - 0.089_484_18 * lab[1] - 1.291_485_5 * lab[2];
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    [
        4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_93 * s,
        -1.268_438 * l + 2.609_757_4 * m - 0.341_319_4 * s,
        -0.004_196_086 * l - 0.703_418_6 * m + 1.707_614_7 * s,
    ]
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
    fn oklab_roundtrip_preserves_linear_rgb() {
        let cases = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.5, 0.3, 0.7],
        ];
        for c in cases {
            let lab = linear_to_oklab(c);
            let rt = oklab_to_linear(lab);
            for i in 0..3 {
                assert!(
                    (c[i] - rt[i]).abs() < 1e-3,
                    "roundtrip failed: {c:?} → {rt:?}"
                );
            }
        }
    }

    #[test]
    fn oklab_black_has_near_zero_chroma() {
        let lab = linear_to_oklab([0.01, 0.01, 0.01]);
        assert!(oklab_chroma(lab) < 1e-3);
    }

    #[test]
    fn oklab_saturated_red_has_substantial_chroma() {
        let lab = linear_to_oklab(srgb_bytes_to_linear([0xc0, 0x20, 0x20]));
        assert!(oklab_chroma(lab) > 0.1);
    }

    #[test]
    fn k_of_one_is_always_black() {
        let warm = rgb_image(64, |_, _| [200, 50, 80]);
        let out = extract_palette_bytes(&warm, 64, 1, 0, None).unwrap();
        assert_eq!(out, BLACK_SRGB.to_vec());
        let cool = rgb_image(64, |_, _| [10, 40, 200]);
        let out = extract_palette_bytes(&cool, 64, 1, 7, None).unwrap();
        assert_eq!(out, BLACK_SRGB.to_vec());
    }

    #[test]
    fn palette_slot_zero_is_always_black() {
        for k in 2..=6 {
            let img = rgb_image(64, |_, _| [180, 120, 60]);
            let out = extract_palette_bytes(&img, 64, k, 0, None).unwrap();
            let slot0 = [out[0], out[1], out[2]];
            assert_eq!(slot0, BLACK_SRGB, "k={k}: slot 0 should be black");
        }
    }

    #[test]
    fn palette_is_ordered_dark_to_light() {
        let rgba = rgb_image(96, |_, _| [180, 120, 60]);
        let out = extract_palette_bytes(&rgba, 96, 5, 0, None).unwrap();
        let lums: Vec<f32> = out
            .chunks_exact(3)
            .map(|c| rec709_srgb([c[0], c[1], c[2]]))
            .collect();
        assert!(
            lums.windows(2).all(|w| w[0] <= w[1] + 1e-3),
            "palette not dark-to-light: {lums:?}"
        );
    }

    #[test]
    fn warm_image_includes_warm_primary() {
        // Gamut-diverse selection intentionally spans the wheel, so a
        // warm image's palette will include both warm picks (matching
        // the image's content) and cool picks (for gamut diversity,
        // e.g. shadows/background). What we guarantee: at least one
        // non-black pick is warm-leaning for a warm image, so the
        // image's dominant hue is represented.
        let size = 96;
        let rgba = rgb_image(size, |_, _| [220, 160, 100]);
        let out = extract_palette_bytes(&rgba, size, 4, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let non_black: Vec<[u8; 3]> = hexes.iter().copied().filter(|c| *c != BLACK_SRGB).collect();
        assert!(
            !non_black.is_empty(),
            "palette must include at least one chromatic color"
        );
        assert!(
            non_black.iter().any(|c| c[0] > c[2]),
            "no warm primary picked for a warm image: {non_black:?}"
        );
    }

    #[test]
    fn cool_image_picks_cool_primary_over_warm() {
        let size = 96;
        let rgba = rgb_image(size, |_, _| [30, 80, 200]);
        let out = extract_palette_bytes(&rgba, size, 2, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        assert_eq!(hexes[0], BLACK_SRGB);
        let slot1 = hexes[1];
        assert!(
            slot1[2] > slot1[0],
            "slot 1 should lean cool (blue > red): {slot1:?}"
        );
    }

    #[test]
    fn red_blue_gradient_picks_both_not_muddy_middle() {
        // Image spans red to blue along x. OKLab k-means with muddy
        // rejection must place centroids on the saturated ends rather
        // than in the desaturated middle. Two chromatic slots + black.
        let size = 96;
        let rgba = rgb_image(size, |x, _| {
            let t = x as f32 / (size - 1) as f32;
            let r = (255.0 * (1.0 - t)) as u8;
            let b = (255.0 * t) as u8;
            [r, 20, b]
        });
        let out = extract_palette_bytes(&rgba, size, 3, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        assert_eq!(hexes[0], BLACK_SRGB);
        // Remaining two centroids should have opposite red/blue bias.
        let s1 = hexes[1];
        let s2 = hexes[2];
        let warm_cool = |c: [u8; 3]| c[0] as i32 - c[2] as i32;
        let wc1 = warm_cool(s1);
        let wc2 = warm_cool(s2);
        assert!(
            wc1.signum() != wc2.signum() || wc1.abs() + wc2.abs() > 40,
            "expected opposing warm/cool centroids, got {s1:?} and {s2:?}"
        );
    }

    #[test]
    fn greyscale_image_falls_back_without_panic() {
        // Pure grey has no chromatic content; k-means must reject all
        // chromatic centroids and the fallback primary ranker fills
        // the palette. The important thing is no panic and a
        // black-anchored palette of the requested size.
        let rgba = rgb_image(64, |_, _| [120, 120, 120]);
        let out = extract_palette_bytes(&rgba, 64, 4, 0, None).unwrap();
        assert_eq!(out.len(), 4 * 3);
        assert_eq!([out[0], out[1], out[2]], BLACK_SRGB);
    }

    #[test]
    fn suggest_next_on_empty_returns_black() {
        let rgba = rgb_image(64, |_, _| [200, 100, 100]);
        let s = suggest_next_color(&rgba, 64, &[], None).unwrap();
        assert_eq!(s, BLACK_SRGB);
    }

    #[test]
    fn suggest_next_on_black_returns_warm_for_warm_image() {
        let rgba = rgb_image(96, |_, _| [220, 100, 60]);
        let s = suggest_next_color(&rgba, 96, &BLACK_SRGB, None).unwrap();
        assert!(
            s[0] > s[2],
            "warm image expected a warm suggestion, got {s:?}"
        );
    }

    #[test]
    fn suggest_next_avoids_duplicating_existing() {
        // Seed with black and the saturated red primary; ask for a
        // suggestion on a warm image. The suggestion must not be the
        // saturated red primary already present.
        let rgba = rgb_image(96, |_, _| [220, 100, 60]);
        let mut existing = Vec::new();
        existing.extend_from_slice(&BLACK_SRGB);
        existing.extend_from_slice(&CANONICAL_PRIMARIES[1]); // saturated red
        let s = suggest_next_color(&rgba, 96, &existing, None).unwrap();
        assert_ne!(s, CANONICAL_PRIMARIES[1]);
        assert_ne!(s, BLACK_SRGB);
    }

    #[test]
    fn muddy_wash_reclusters_and_palette_has_no_muddy_entries() {
        // A warm-neutral gradient without any saturated content is
        // exactly the "middle mud" k-means wants to park a centroid in.
        // With muddy rejection + k-1 reclustering, the returned palette
        // must not contain any low-chroma chromatic entries — either
        // the fallback ranker's saturated primaries, or fewer slots.
        let size = 96;
        let rgba = rgb_image(size, |x, y| {
            let t = (x + y) as f32 / (2.0 * (size - 1) as f32);
            let r = (180.0 + 40.0 * t) as u8;
            let g = (140.0 + 30.0 * t) as u8;
            let b = (120.0 + 20.0 * t) as u8;
            [r, g, b]
        });
        let out = extract_palette_bytes(&rgba, size, 5, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        assert_eq!(hexes[0], BLACK_SRGB);
        for c in hexes.iter().skip(1) {
            let lab = linear_to_oklab(srgb_bytes_to_linear(*c));
            assert!(
                oklab_chroma(lab) >= MUDDY_CHROMA_THRESHOLD - 0.005,
                "palette entry {c:?} is muddy (chroma {}) — recluster should have dropped it",
                oklab_chroma(lab)
            );
        }
    }

    #[test]
    fn rejects_near_board_centroids_and_palette_stays_darkenable() {
        // High-key image: a small saturated red in a sea of near-cream.
        // Any k-means centroid near the cream board is useless as a
        // thread (can't darken the board), so the board-luminance cap
        // must exclude it. Every returned palette entry must sit below
        // 95% of board luminance.
        let size = 96;
        let rgba = rgb_image(size, |x, y| {
            if x < size / 8 && y < size / 8 {
                [220, 30, 30]
            } else {
                [240, 232, 220]
            }
        });
        let out = extract_palette_bytes(&rgba, size, 4, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let cap = BOARD_LUMINANCE * BOARD_LIGHT_CAP_RATIO;
        for c in &hexes {
            let linear = srgb_bytes_to_linear(*c);
            let lum = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
            assert!(
                lum <= cap + 1e-3,
                "palette entry {c:?} is too close to board luminance ({lum} > {cap})",
            );
        }
    }

    #[test]
    fn explanatory_shares_follow_image_dominance() {
        // Two-thirds red, one-third blue image with a palette of
        // black / red / blue. Red's explanatory share should clearly
        // dominate blue's, and all three must sum to ~1.
        let size = 96;
        let rgba = rgb_image(size, |x, _| {
            if x < 2 * size / 3 {
                [210, 30, 30]
            } else {
                [30, 30, 210]
            }
        });
        let palette: &[u8] = &[0x11, 0x11, 0x11, 0xc0, 0x20, 0x20, 0x20, 0x20, 0xc0];
        let shares = palette_explanatory_shares(&rgba, size, palette, None).unwrap();
        assert_eq!(shares.len(), 3);
        let sum: f32 = shares.iter().sum();
        assert!(
            (sum - 1.0).abs() < 1e-3,
            "shares should sum to 1, got {sum}"
        );
        assert!(
            shares[1] > shares[2] * 1.5,
            "red should dominate blue on a 2/3 red image: red={}, blue={}",
            shares[1],
            shares[2]
        );
    }

    #[test]
    fn explanatory_shares_with_only_one_explanatory_color() {
        // A single-chromatic-region image with a palette where only
        // one color can actually darken the region; the near-board
        // slot has near-zero basis and should get a small share.
        let size = 64;
        let rgba = rgb_image(size, |_, _| [200, 40, 40]);
        let palette: &[u8] = &[0xc0, 0x30, 0x30, 0xee, 0xe6, 0xd8];
        let shares = palette_explanatory_shares(&rgba, size, palette, None).unwrap();
        assert!(
            shares[0] > 0.8,
            "the single explanatory color should own most of the share, got {}",
            shares[0]
        );
    }

    #[test]
    fn explanatory_shares_rejects_bad_inputs() {
        let rgba = rgb_image(32, |_, _| [0, 0, 0]);
        assert!(palette_explanatory_shares(&rgba, 32, &[], None).is_err());
        // 2-byte palette isn't a multiple of 3.
        assert!(palette_explanatory_shares(&rgba, 32, &[0, 0], None).is_err());
        // Wrong image size.
        let tiny = vec![0u8; 4];
        assert!(palette_explanatory_shares(&tiny, 2, &[0, 0, 0], None).is_err());
    }

    #[test]
    fn rejects_bad_inputs() {
        let rgba = vec![0u8; 4];
        assert!(extract_palette_bytes(&rgba, 2, 1, 0, None).is_err());
        let rgba = rgb_image(4, |_, _| [0, 0, 0]);
        assert!(extract_palette_bytes(&rgba, 4, 0, 0, None).is_err());
        assert!(extract_palette_bytes(&rgba, 4, MAX_K + 1, 0, None).is_err());
    }
}
