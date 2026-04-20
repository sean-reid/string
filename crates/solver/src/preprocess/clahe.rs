//! Contrast-limited adaptive histogram equalization.
//!
//! Divides the image into `tiles x tiles` blocks, builds a 256-bin histogram
//! per tile, clips the histogram at `clip_limit * mean_bin_count`, then
//! bilinearly interpolates the per-tile CDF at each pixel.

const HIST_BINS: usize = 256;

pub fn clahe(lum: &mut [f32], width: usize, height: usize, tiles: usize, clip_limit: f32) {
    assert_eq!(lum.len(), width * height);
    assert!(tiles >= 1);
    let tiles = tiles.max(1);

    let tile_w = width.div_ceil(tiles);
    let tile_h = height.div_ceil(tiles);

    // Per-tile CDFs mapped to `[0.0, 1.0]`.
    let mut cdfs = vec![[0.0f32; HIST_BINS]; tiles * tiles];

    for ty in 0..tiles {
        for tx in 0..tiles {
            let x0 = tx * tile_w;
            let y0 = ty * tile_h;
            let x1 = (x0 + tile_w).min(width);
            let y1 = (y0 + tile_h).min(height);

            let mut hist = [0u32; HIST_BINS];
            for y in y0..y1 {
                for x in x0..x1 {
                    let v = lum[y * width + x].clamp(0.0, 1.0);
                    let bin = (v * (HIST_BINS as f32 - 1.0)).round() as usize;
                    hist[bin] += 1;
                }
            }
            let tile_pixels = ((y1 - y0) * (x1 - x0)) as u32;
            let mean = tile_pixels as f32 / HIST_BINS as f32;
            let clip = (clip_limit * mean).max(1.0) as u32;
            let mut excess = 0u32;
            for count in &mut hist {
                if *count > clip {
                    excess += *count - clip;
                    *count = clip;
                }
            }
            // Spread the clipped mass uniformly.
            let redistribute = excess / HIST_BINS as u32;
            let remainder = excess - redistribute * HIST_BINS as u32;
            for bin in &mut hist {
                *bin += redistribute;
            }
            for bin in hist.iter_mut().take(remainder as usize) {
                *bin += 1;
            }

            let mut cdf = [0.0f32; HIST_BINS];
            let mut acc = 0u32;
            for (i, &count) in hist.iter().enumerate() {
                acc += count;
                cdf[i] = acc as f32 / tile_pixels.max(1) as f32;
            }
            cdfs[ty * tiles + tx] = cdf;
        }
    }

    // Bilinear interpolation of CDF lookups.
    for y in 0..height {
        let gy = (y as f32 + 0.5) / tile_h as f32 - 0.5;
        let ty0 = gy.floor().max(0.0) as usize;
        let ty1 = (ty0 + 1).min(tiles - 1);
        let fy = (gy - ty0 as f32).clamp(0.0, 1.0);

        for x in 0..width {
            let gx = (x as f32 + 0.5) / tile_w as f32 - 0.5;
            let tx0 = gx.floor().max(0.0) as usize;
            let tx1 = (tx0 + 1).min(tiles - 1);
            let fx = (gx - tx0 as f32).clamp(0.0, 1.0);

            let v = lum[y * width + x].clamp(0.0, 1.0);
            let bin = (v * (HIST_BINS as f32 - 1.0)).round() as usize;

            let c00 = cdfs[ty0 * tiles + tx0][bin];
            let c01 = cdfs[ty0 * tiles + tx1][bin];
            let c10 = cdfs[ty1 * tiles + tx0][bin];
            let c11 = cdfs[ty1 * tiles + tx1][bin];

            let top = c00 * (1.0 - fx) + c01 * fx;
            let bot = c10 * (1.0 - fx) + c11 * fx;
            lum[y * width + x] = top * (1.0 - fy) + bot * fy;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_stays_in_unit_range() {
        let w = 32;
        let h = 32;
        let mut lum: Vec<f32> = (0..w * h)
            .map(|i| ((i as f32 * 0.13) % 1.0).abs())
            .collect();
        clahe(&mut lum, w, h, 4, 2.0);
        for v in &lum {
            assert!(
                (0.0..=1.0).contains(v),
                "out of unit range after CLAHE: {v}",
            );
        }
    }

    #[test]
    fn stretches_a_compressed_histogram() {
        let w = 32;
        let h = 32;
        // Image confined to a narrow band near 0.4-0.6.
        let mut lum = vec![0.0f32; w * h];
        for (i, v) in lum.iter_mut().enumerate() {
            *v = 0.4 + 0.2 * ((i % 16) as f32 / 15.0);
        }
        let before_min = lum.iter().cloned().fold(1.0f32, f32::min);
        let before_max = lum.iter().cloned().fold(0.0f32, f32::max);
        let before_span = before_max - before_min;

        clahe(&mut lum, w, h, 2, 2.0);

        let after_min = lum.iter().cloned().fold(1.0f32, f32::min);
        let after_max = lum.iter().cloned().fold(0.0f32, f32::max);
        let after_span = after_max - after_min;
        assert!(
            after_span >= before_span,
            "CLAHE should not reduce dynamic range: {before_span} -> {after_span}",
        );
    }
}
