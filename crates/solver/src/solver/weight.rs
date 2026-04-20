//! Importance weight map used to bias the solver toward the subject.
//!
//! A face box is in solver-image coordinates (pixels). Weights follow an
//! anisotropic Gaussian centered on the box, so chords that pass through the
//! face score higher than chords only in the background without any hard
//! edge in the weight field.

#[derive(Clone, Copy, Debug)]
pub struct FaceBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

pub fn uniform(size: usize) -> Vec<f32> {
    vec![1.0; size * size]
}

pub fn with_face_emphasis(
    size: usize,
    face: Option<FaceBox>,
    strength: f32,
    sigma_mul: f32,
) -> Vec<f32> {
    let mut weights = uniform(size);
    let Some(face) = face else {
        return weights;
    };
    let cx = face.x + face.w * 0.5;
    let cy = face.y + face.h * 0.5;
    let sx = (face.w * 0.5 * sigma_mul).max(1.0);
    let sy = (face.h * 0.5 * sigma_mul).max(1.0);
    for y in 0..size {
        for x in 0..size {
            let dx = (x as f32 - cx) / sx;
            let dy = (y as f32 - cy) / sy;
            let r2 = dx * dx + dy * dy;
            let boost = strength * (-0.5 * r2).exp();
            weights[y * size + x] = 1.0 + boost;
        }
    }
    weights
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_face_leaves_weights_uniform() {
        let w = with_face_emphasis(16, None, 1.5, 1.0);
        for v in &w {
            assert!((v - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn face_center_weighs_more_than_corner() {
        let size = 64;
        let face = FaceBox {
            x: 20.0,
            y: 20.0,
            w: 24.0,
            h: 24.0,
        };
        let w = with_face_emphasis(size, Some(face), 1.5, 1.0);
        let center = w[(32) * size + 32];
        let corner = w[0];
        assert!(
            center > corner + 0.2,
            "expected face center heavier than corner: {center} vs {corner}",
        );
    }
}
