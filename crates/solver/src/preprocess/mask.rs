//! Circular mask: zeros out pixels outside the inscribed circle.
//!
//! Pixels inside the circle are left untouched. The radius is the largest
//! that fits the square: `min(width, height) / 2`. Edge pixels are softened
//! with a 1-pixel anti-aliased falloff so the solver does not see a
//! stair-stepped boundary.

pub fn circular_mask(lum: &mut [f32], width: usize, height: usize) {
    assert_eq!(lum.len(), width * height);
    let cx = (width as f32 - 1.0) * 0.5;
    let cy = (height as f32 - 1.0) * 0.5;
    let radius = ((width.min(height) as f32) * 0.5) - 1.0;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            let idx = y * width + x;
            if d > radius + 1.0 {
                lum[idx] = 0.0;
            } else if d > radius {
                lum[idx] *= (radius + 1.0 - d).clamp(0.0, 1.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_are_zeroed() {
        let w = 16;
        let h = 16;
        let mut lum = vec![1.0; w * h];
        circular_mask(&mut lum, w, h);
        assert_eq!(lum[0], 0.0, "top-left corner not zero");
        assert_eq!(lum[w - 1], 0.0, "top-right corner not zero");
        assert_eq!(lum[w * (h - 1)], 0.0, "bottom-left corner not zero");
        assert_eq!(lum[w * h - 1], 0.0, "bottom-right corner not zero");
    }

    #[test]
    fn center_is_preserved() {
        let w = 32;
        let h = 32;
        let mut lum = vec![1.0; w * h];
        circular_mask(&mut lum, w, h);
        let center = lum[h / 2 * w + w / 2];
        assert!((center - 1.0).abs() < 1e-6, "center wiped: {center}");
    }
}
