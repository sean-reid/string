//! Naive bilateral filter. Suitable for 700x700 preview-class inputs.
//!
//! Kernel radius is derived from `sigma_space` (3 sigma). Intensity weight
//! is a Gaussian in the color domain with width `sigma_color`. A production
//! build should swap for the separable-bilateral or permutohedral variant;
//! this one is chosen for clarity.

pub fn bilateral(
    lum: &[f32],
    width: usize,
    height: usize,
    sigma_color: f32,
    sigma_space: f32,
) -> Vec<f32> {
    assert_eq!(lum.len(), width * height);
    let radius = (sigma_space * 3.0).ceil().max(1.0) as isize;
    let space_coeff = -0.5 / (sigma_space * sigma_space);
    let color_coeff = -0.5 / (sigma_color * sigma_color);

    let mut space_weights = Vec::with_capacity(((2 * radius + 1) * (2 * radius + 1)) as usize);
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let d2 = (dx * dx + dy * dy) as f32;
            space_weights.push((d2 * space_coeff).exp());
        }
    }

    let mut out = vec![0.0f32; lum.len()];
    let stride_w = (2 * radius + 1) as usize;

    for y in 0..height as isize {
        for x in 0..width as isize {
            let center = lum[(y as usize) * width + x as usize];
            let mut sum = 0.0f32;
            let mut weight_sum = 0.0f32;

            for dy in -radius..=radius {
                let ny = y + dy;
                if ny < 0 || ny >= height as isize {
                    continue;
                }
                for dx in -radius..=radius {
                    let nx = x + dx;
                    if nx < 0 || nx >= width as isize {
                        continue;
                    }
                    let neighbor = lum[(ny as usize) * width + nx as usize];
                    let ds = neighbor - center;
                    let ws =
                        space_weights[((dy + radius) * stride_w as isize + (dx + radius)) as usize];
                    let wc = (ds * ds * color_coeff).exp();
                    let w = ws * wc;
                    sum += neighbor * w;
                    weight_sum += w;
                }
            }

            out[(y as usize) * width + x as usize] = if weight_sum > 0.0 {
                sum / weight_sum
            } else {
                center
            };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_image_is_unchanged() {
        let w = 32;
        let h = 32;
        let lum = vec![0.5; w * h];
        let out = bilateral(&lum, w, h, 0.1, 2.0);
        for v in &out {
            assert!((v - 0.5).abs() < 1e-4, "drifted: {v}");
        }
    }

    #[test]
    fn preserves_sharp_edge_better_than_no_color_term() {
        let w = 16;
        let h = 16;
        let mut lum = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                lum[y * w + x] = if x < w / 2 { 0.0 } else { 1.0 };
            }
        }
        let bil = bilateral(&lum, w, h, 0.05, 2.0);
        // Pixels one column away from the seam should still be close to
        // their original values because the color term suppresses cross-edge weight.
        let left_near = bil[h / 2 * w + (w / 2 - 1)];
        let right_near = bil[h / 2 * w + (w / 2)];
        assert!(left_near < 0.2, "left side bled across edge: {left_near}");
        assert!(
            right_near > 0.8,
            "right side bled across edge: {right_near}"
        );
    }
}
