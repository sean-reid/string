//! Rec. 709 luminance from RGBA8 in `[0, 255]` to f32 in `[0.0, 1.0]`.

const R: f32 = 0.2126;
const G: f32 = 0.7152;
const B: f32 = 0.0722;
const INV_255: f32 = 1.0 / 255.0;

pub fn rec709(rgba: &[u8], width: usize, height: usize) -> Vec<f32> {
    assert_eq!(rgba.len(), width * height * 4);
    let mut lum = Vec::with_capacity(width * height);
    for chunk in rgba.chunks_exact(4) {
        let r = chunk[0] as f32 * INV_255;
        let g = chunk[1] as f32 * INV_255;
        let b = chunk[2] as f32 * INV_255;
        lum.push(R * r + G * g + B * b);
    }
    lum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_red_maps_to_rec709_weight() {
        let rgba = vec![255, 0, 0, 255];
        let lum = rec709(&rgba, 1, 1);
        assert!((lum[0] - R).abs() < 1e-6);
    }

    #[test]
    fn pure_white_maps_to_one() {
        let rgba = vec![255, 255, 255, 255];
        let lum = rec709(&rgba, 1, 1);
        assert!((lum[0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn pure_black_maps_to_zero() {
        let rgba = vec![0, 0, 0, 255];
        let lum = rec709(&rgba, 1, 1);
        assert!(lum[0].abs() < 1e-6);
    }

    #[test]
    fn channel_weights_sum_to_one() {
        assert!((R + G + B - 1.0).abs() < 1e-6);
    }
}
