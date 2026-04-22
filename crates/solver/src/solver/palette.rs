//! Thread palette: the set of colors the solver can choose from when picking
//! a chord. PR 2 only threads this through the pipeline at the data-model
//! level; the solver still runs the legacy scalar-residual path when the
//! palette has exactly one color.

/// Linear-RGB thread color.
pub type LinearRgb = [f32; 3];

#[derive(Clone, Debug)]
pub struct Palette {
    colors: Vec<LinearRgb>,
}

impl Palette {
    /// Build a palette from a flat buffer of sRGB bytes (length must be a
    /// positive multiple of 3). Each triple becomes one palette entry in
    /// linear RGB.
    pub fn from_srgb_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.is_empty() || !bytes.len().is_multiple_of(3) {
            return Err("palette must be a non-empty multiple of 3 bytes (rgb)");
        }
        if bytes.len() / 3 > u8::MAX as usize {
            return Err("palette is limited to 255 colors");
        }
        let colors = bytes
            .chunks_exact(3)
            .map(|c| {
                [
                    srgb_to_linear(c[0] as f32 / 255.0),
                    srgb_to_linear(c[1] as f32 / 255.0),
                    srgb_to_linear(c[2] as f32 / 255.0),
                ]
            })
            .collect();
        Ok(Palette { colors })
    }

    pub fn len(&self) -> usize {
        self.colors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.colors.is_empty()
    }

    #[allow(dead_code)]
    pub fn colors(&self) -> &[LinearRgb] {
        &self.colors
    }
}

/// Piecewise sRGB -> linear transfer (component in 0..=1).
pub fn srgb_to_linear(u: f32) -> f32 {
    if u <= 0.04045 {
        u / 12.92
    } else {
        ((u + 0.055) / 1.055).powf(2.4)
    }
}

/// The solver loop today works on a single scalar residual (luminance). The
/// `Mode` enum tags which code path is active. PR 3 will add `Color`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Mono,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_srgb_single_color() {
        let p = Palette::from_srgb_bytes(&[0xF4, 0xEF, 0xE5]).unwrap();
        assert_eq!(p.len(), 1);
        let c = p.colors()[0];
        assert!(c[0] > 0.8 && c[1] > 0.8 && c[2] > 0.7);
    }

    #[test]
    fn from_srgb_empty_rejected() {
        assert!(Palette::from_srgb_bytes(&[]).is_err());
    }

    #[test]
    fn from_srgb_partial_rejected() {
        assert!(Palette::from_srgb_bytes(&[1, 2, 3, 4]).is_err());
    }

    #[test]
    fn srgb_zero_and_one_map_correctly() {
        assert!((srgb_to_linear(0.0)).abs() < 1e-7);
        assert!((srgb_to_linear(1.0) - 1.0).abs() < 1e-4);
    }
}
