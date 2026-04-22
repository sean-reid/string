//! Palette extraction for a photo, tuned for **subtractive
//! reconstruction** on a light board (Vrellis paradigm).
//!
//! The palette is NOT image-derived. It's a fixed vocabulary of
//! saturated thread primaries — black, red, yellow, blue, cyan,
//! magenta, green — matching what Vrellis (and most string-art
//! builders) physically wind onto pins. Image-derived palettes on
//! portraits return muddy skin-tone browns that all darken canvas
//! toward the same warm-neutral; saturated primaries actually mix
//! partitively (red + yellow = orange density in a region, etc.)
//! the way classic halftone printing does.
//!
//! The extractor decides which N of the primaries best fit the
//! image's content, not what specific RGB values to use:
//!
//! 1. Rank primaries by how much of the image's `target − board`
//!    residual they explain (dot product summed over pixels,
//!    weighted by the residual magnitude).
//! 2. Return the top-N in dark-to-light luminance order.
//!
//! Black is always included — it's the universal luminance
//! darkener and every image needs it. k=1 is always just black.
//! k=4 tends to fall on the canonical Vrellis set
//! (black, red, yellow, blue) for natural portraits.

use crate::solver::palette::srgb_to_linear;
use crate::solver::weight::FaceBox;

const SAMPLE_DIM: usize = 128;
const MAX_K: usize = 8;

/// sRGB of the default black thread. Mono mode (k=1) returns this
/// verbatim — black on cream is the canonical Vrellis-style
/// monochrome baseline.
const BLACK_SRGB: [u8; 3] = [0x11, 0x11, 0x11];

/// Linear-RGB board color (cream #f4efe5). Must mirror
/// `solver::mod::BOARD_LINEAR`.
const BOARD_LINEAR: [f32; 3] = [0.904_587_8, 0.862_741_3, 0.784_452_6];

/// Canonical thread-color vocabulary — the full set of saturated
/// primaries the extractor ranks and picks from. These are all real
/// embroidery/crochet thread colors, chosen to tile hue-space at
/// roughly even intervals so a ranked top-N gives the palette that
/// actually explains the image's gamut rather than always falling
/// on the same six primaries. Dark-to-light luminance spread so
/// the dark-first build order places deep shadows first.
const CANONICAL_PRIMARIES: &[[u8; 3]] = &[
    // Achromatic / near-black anchor for shadow luminance.
    [0x11, 0x11, 0x11], // black
    // Warm half of the wheel.
    [0xb8, 0x1c, 0x1c], // saturated red
    [0xd9, 0x5a, 0x1c], // orange (between red and yellow)
    [0xd9, 0xa8, 0x1c], // saturated yellow (mustard-warm)
    [0x8a, 0x3c, 0x2c], // brick / terracotta (warm shadow — hair, skin shadow)
    [0xd9, 0x82, 0x82], // salmon / rose (soft warm — lips, cheek)
    // Cool half of the wheel.
    [0x1c, 0x88, 0x50], // deep green
    [0x3c, 0x5a, 0x1c], // olive / sage (earthy green)
    [0x1c, 0x88, 0xa8], // deep cyan
    [0x1c, 0x70, 0x70], // teal (between cyan and green)
    [0x1c, 0x3c, 0xa8], // saturated blue
    [0x5a, 0x1c, 0xa8], // purple (between blue and magenta)
    [0xa8, 0x1c, 0x88], // deep magenta
];

/// Public entry point. Returns `k * 3` sRGB bytes of saturated thread
/// primaries chosen to best explain the image's target distribution.
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
    let _ = face;
    let _ = seed;

    // k=1 is always black — the mono baseline.
    if k == 1 {
        return Ok(BLACK_SRGB.to_vec());
    }

    let samples = downsample_linear_rgb(rgba, size);
    if samples.is_empty() {
        return Ok(BLACK_SRGB.repeat(k));
    }

    // Pre-bake the canonical primaries in linear RGB, plus each one's
    // "darkening basis" (board - primary), which is how a crossing
    // contributes to closing the target-vs-board gap in partitive
    // terms.
    let primaries_linear: Vec<[f32; 3]> = CANONICAL_PRIMARIES
        .iter()
        .map(|p| {
            [
                srgb_to_linear(p[0] as f32 / 255.0),
                srgb_to_linear(p[1] as f32 / 255.0),
                srgb_to_linear(p[2] as f32 / 255.0),
            ]
        })
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

    // Each primary's chromatic basis: darkening basis minus its
    // achromatic component (the minimum of its three channels). This
    // is the "which hue does this thread lean toward as it darkens"
    // component. Black's chromatic basis is zero (it darkens
    // uniformly); red's chromatic basis emphasizes G and B
    // (red thread leaves R behind when it occludes board); etc.
    // Scoring against chromatic basis instead of raw darkening basis
    // stops every non-black primary from scoring ~the same on dark
    // pixels — only primaries whose hue actually matches the image's
    // chromatic residual get credit, so the top-k picks discriminate
    // by hue rather than by raw darkening magnitude.
    let chromatic_basis: Vec<[f32; 3]> = darkening_basis
        .iter()
        .map(|b| {
            let m = b[0].min(b[1]).min(b[2]);
            [b[0] - m, b[1] - m, b[2] - m]
        })
        .collect();

    // Score each primary by projecting the chromatic part of each
    // pixel's (board − target) residual onto its chromatic basis.
    // Black has zero chromatic basis, so it scores 0 — but black is
    // pinned as slot 0 by convention, so this is fine. The ranking
    // is effectively "which non-black primary best matches the
    // image's chromatic demand".
    let mut scores = vec![0.0f32; CANONICAL_PRIMARIES.len()];
    for s in &samples {
        let b = [
            (BOARD_LINEAR[0] - s[0]).max(0.0),
            (BOARD_LINEAR[1] - s[1]).max(0.0),
            (BOARD_LINEAR[2] - s[2]).max(0.0),
        ];
        let m = b[0].min(b[1]).min(b[2]);
        let b_chrom = [b[0] - m, b[1] - m, b[2] - m];
        let b_chrom_mag_sq =
            b_chrom[0] * b_chrom[0] + b_chrom[1] * b_chrom[1] + b_chrom[2] * b_chrom[2];
        if b_chrom_mag_sq <= 1e-6 {
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
            scores[i] += dot / basis_mag_sq.sqrt();
        }
    }

    // Always pin black as slot 0 — it's the universal darkness
    // primary. Rank the other primaries by score, take the top (k−1).
    let mut ranked: Vec<(usize, f32)> = scores
        .iter()
        .enumerate()
        .skip(1) // skip black
        .map(|(i, &s)| (i, s))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut picks: Vec<[u8; 3]> = Vec::with_capacity(k);
    picks.push(CANONICAL_PRIMARIES[0]); // black
    for (idx, _) in ranked.into_iter().take(k - 1) {
        picks.push(CANONICAL_PRIMARIES[idx]);
    }

    // Dark-to-light build order so the physical builder lays the
    // darkest threads first.
    picks.sort_by(|a, b| {
        let la = rec709_srgb(*a);
        let lb = rec709_srgb(*b);
        la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut out = Vec::with_capacity(k * 3);
    for p in &picks {
        out.extend_from_slice(p);
    }
    Ok(out)
}

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

fn rec709_srgb(c: [u8; 3]) -> f32 {
    // Rough Rec.709 on sRGB bytes (not gamma-corrected to linear —
    // enough for dark-to-light palette ordering).
    let r = c[0] as f32 / 255.0;
    let g = c[1] as f32 / 255.0;
    let b = c[2] as f32 / 255.0;
    0.2126 * r + 0.7152 * g + 0.0722 * b
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
        // Black is the universal darkness primary; every palette must
        // include it for the luminance axis to have a solid anchor.
        for k in 2..=6 {
            let img = rgb_image(64, |_, _| [180, 120, 60]);
            let out = extract_palette_bytes(&img, 64, k, 0, None).unwrap();
            let slot0 = [out[0], out[1], out[2]];
            // slot 0 after dark-to-light ordering: the DARKEST of the
            // picks, which for any palette including black is black.
            assert_eq!(slot0, BLACK_SRGB, "k={k}: slot 0 should be black");
        }
    }

    #[test]
    fn warm_image_picks_warm_primaries_over_cool() {
        // A warm portrait's residual lives in the red/yellow half of
        // the wheel. With a larger canonical vocabulary the picks
        // include finer warm subdivisions (orange, salmon, etc.) —
        // the test just requires ZERO cool primaries in the top-4.
        let size = 96;
        let rgba = rgb_image(size, |_, _| [220, 160, 100]);
        let out = extract_palette_bytes(&rgba, size, 4, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        let is_warm = |c: [u8; 3]| c[0] >= c[2]; // red/green >= blue
        for c in &hexes {
            if *c == BLACK_SRGB {
                continue;
            }
            assert!(is_warm(*c), "unexpected cool primary in warm image: {c:?}");
        }
    }

    #[test]
    fn cool_image_picks_cool_primary_over_warm() {
        let size = 96;
        let rgba = rgb_image(size, |_, _| [30, 80, 200]);
        let out = extract_palette_bytes(&rgba, size, 2, 0, None).unwrap();
        let hexes: Vec<[u8; 3]> = out.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        assert_eq!(hexes[0], BLACK_SRGB); // slot 0
        let slot1 = hexes[1];
        assert!(
            slot1[2] > slot1[0],
            "slot 1 should lean cool (blue > red): {slot1:?}"
        );
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
    fn rejects_bad_inputs() {
        let rgba = vec![0u8; 4];
        assert!(extract_palette_bytes(&rgba, 2, 1, 0, None).is_err());
        let rgba = rgb_image(4, |_, _| [0, 0, 0]);
        assert!(extract_palette_bytes(&rgba, 4, 0, 0, None).is_err());
        assert!(extract_palette_bytes(&rgba, 4, MAX_K + 1, 0, None).is_err());
    }
}
