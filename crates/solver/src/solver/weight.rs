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

/// Background weight floor — pixels far from the face gaussian get
/// this importance. Below 1.0 so the non-face area is actively
/// suppressed rather than merely out-boosted by the face peak. Without
/// suppression, a sky that occupies 40% of the image contributes more
/// total "mass" than a face that occupies 10% even under a 2× face
/// boost, and per-color budgets (which sum importance × projection)
/// over-allocate lines to whatever thread best matches the sky.
const BACKGROUND_FLOOR: f32 = 0.15;

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
    let peak = 1.0 + strength;
    for y in 0..size {
        for x in 0..size {
            let dx = (x as f32 - cx) / sx;
            let dy = (y as f32 - cy) / sy;
            let r2 = dx * dx + dy * dy;
            let g = (-0.5 * r2).exp();
            // Interpolate background floor → face peak by the gaussian
            // falloff. Face center hits `1 + strength`; asymptote is
            // `BACKGROUND_FLOOR` (≪ 1) rather than 1.0, so non-face
            // pixels get less line budget than a uniform solve.
            weights[y * size + x] = BACKGROUND_FLOOR + (peak - BACKGROUND_FLOOR) * g;
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

    #[test]
    fn background_weight_falls_below_uniform_when_face_is_known() {
        // With a face box, far-from-face pixels must be suppressed below
        // 1.0 so their per-color-budget contribution is smaller than the
        // face's. Otherwise a sky-heavy portrait allocates too many
        // lines to the background thread.
        let size = 64;
        let face = FaceBox {
            x: 28.0,
            y: 28.0,
            w: 8.0,
            h: 8.0,
        };
        let w = with_face_emphasis(size, Some(face), 1.5, 1.0);
        let corner = w[0];
        assert!(
            corner < 0.5,
            "expected suppressed background corner, got {corner}",
        );
    }
}
