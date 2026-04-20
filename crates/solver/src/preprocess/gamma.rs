//! Gamma correction. A gamma of 1.3 darkens midtones.

pub fn apply_gamma(lum: &mut [f32], gamma: f32) {
    // Darkness convention: out = in^gamma, so gamma > 1 darkens midtones.
    for v in lum.iter_mut() {
        *v = v.clamp(0.0, 1.0).powf(gamma);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gamma_one_is_identity() {
        let mut lum = vec![0.1, 0.5, 0.9];
        apply_gamma(&mut lum, 1.0);
        assert!((lum[0] - 0.1).abs() < 1e-6);
        assert!((lum[1] - 0.5).abs() < 1e-6);
        assert!((lum[2] - 0.9).abs() < 1e-6);
    }

    #[test]
    fn gamma_above_one_darkens_midtone() {
        let mut lum = vec![0.5];
        apply_gamma(&mut lum, 1.5);
        assert!(lum[0] < 0.5, "gamma > 1 should darken: {}", lum[0]);
    }

    #[test]
    fn extremes_are_preserved() {
        let mut lum = vec![0.0, 1.0];
        apply_gamma(&mut lum, 2.2);
        assert!(lum[0].abs() < 1e-6);
        assert!((lum[1] - 1.0).abs() < 1e-6);
    }
}
