//! Unsharp mask. Applies a separable Gaussian blur, then combines:
//! `out = lum + amount * (lum - blurred)`.

pub fn unsharp_mask(lum: &mut [f32], width: usize, height: usize, sigma: f32, amount: f32) {
    assert_eq!(lum.len(), width * height);
    let blurred = gaussian_blur(lum, width, height, sigma);
    for (v, b) in lum.iter_mut().zip(blurred.iter()) {
        *v = (*v + amount * (*v - *b)).clamp(0.0, 1.0);
    }
}

pub fn gaussian_blur(lum: &[f32], width: usize, height: usize, sigma: f32) -> Vec<f32> {
    let kernel = build_kernel(sigma);
    let radius = (kernel.len() / 2) as isize;

    let mut tmp = vec![0.0f32; lum.len()];
    // Horizontal pass.
    for y in 0..height as isize {
        for x in 0..width as isize {
            let mut sum = 0.0f32;
            let mut weight_sum = 0.0f32;
            for (i, &k) in kernel.iter().enumerate() {
                let nx = x + (i as isize - radius);
                if nx < 0 || nx >= width as isize {
                    continue;
                }
                sum += lum[(y as usize) * width + nx as usize] * k;
                weight_sum += k;
            }
            tmp[(y as usize) * width + x as usize] = if weight_sum > 0.0 {
                sum / weight_sum
            } else {
                0.0
            };
        }
    }

    let mut out = vec![0.0f32; lum.len()];
    // Vertical pass.
    for y in 0..height as isize {
        for x in 0..width as isize {
            let mut sum = 0.0f32;
            let mut weight_sum = 0.0f32;
            for (i, &k) in kernel.iter().enumerate() {
                let ny = y + (i as isize - radius);
                if ny < 0 || ny >= height as isize {
                    continue;
                }
                sum += tmp[(ny as usize) * width + x as usize] * k;
                weight_sum += k;
            }
            out[(y as usize) * width + x as usize] = if weight_sum > 0.0 {
                sum / weight_sum
            } else {
                0.0
            };
        }
    }
    out
}

fn build_kernel(sigma: f32) -> Vec<f32> {
    let radius = (sigma * 3.0).ceil().max(1.0) as isize;
    let two_sigma_sq = 2.0 * sigma * sigma;
    let mut kernel = Vec::with_capacity((2 * radius + 1) as usize);
    let mut sum = 0.0f32;
    for i in -radius..=radius {
        let v = (-(i * i) as f32 / two_sigma_sq).exp();
        kernel.push(v);
        sum += v;
    }
    for v in &mut kernel {
        *v /= sum;
    }
    kernel
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gaussian_preserves_mean() {
        let w = 24;
        let h = 24;
        let lum: Vec<f32> = (0..w * h).map(|i| ((i % 7) as f32) / 6.0).collect();
        let original_mean: f32 = lum.iter().sum::<f32>() / lum.len() as f32;
        let blurred = gaussian_blur(&lum, w, h, 1.5);
        let new_mean: f32 = blurred.iter().sum::<f32>() / blurred.len() as f32;
        assert!((new_mean - original_mean).abs() < 0.01, "mean shifted");
    }

    #[test]
    fn unsharp_increases_edge_contrast() {
        let w = 16;
        let h = 16;
        let mut lum = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                lum[y * w + x] = if x < w / 2 { 0.3 } else { 0.6 };
            }
        }
        let before_diff = lum[h / 2 * w + w / 2] - lum[h / 2 * w + w / 2 - 1];
        unsharp_mask(&mut lum, w, h, 1.0, 1.0);
        let after_diff = lum[h / 2 * w + w / 2] - lum[h / 2 * w + w / 2 - 1];
        assert!(
            after_diff > before_diff,
            "unsharp did not increase edge contrast: {before_diff} -> {after_diff}",
        );
    }
}
