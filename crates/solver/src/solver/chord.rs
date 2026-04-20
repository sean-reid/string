//! Chord rasterization. Xiaolin-Wu antialiased lines between two pins.
//!
//! `score_chord` sums the residual along the chord, weighted by the AA
//! coverage of each touched pixel, divided by the chord length (so long
//! chords are not unfairly preferred).
//!
//! `draw_chord` subtracts `opacity * coverage` from the residual at each
//! touched pixel, clamping at zero.

#[inline]
fn fpart(x: f32) -> f32 {
    x - x.floor()
}

#[inline]
fn rfpart(x: f32) -> f32 {
    1.0 - fpart(x)
}

/// Iterates Xiaolin-Wu line pixels, calling `f(index, coverage)` for each.
/// Ignores endpoints that fall outside the image.
pub fn for_each_pixel<F>(x0: f32, y0: f32, x1: f32, y1: f32, width: usize, height: usize, mut f: F)
where
    F: FnMut(usize, f32),
{
    let steep = (y1 - y0).abs() > (x1 - x0).abs();
    let (mut x0, mut y0, mut x1, mut y1) = if steep {
        (y0, x0, y1, x1)
    } else {
        (x0, y0, x1, y1)
    };
    if x0 > x1 {
        std::mem::swap(&mut x0, &mut x1);
        std::mem::swap(&mut y0, &mut y1);
    }
    let dx = x1 - x0;
    let dy = y1 - y0;
    let gradient = if dx.abs() < f32::EPSILON {
        1.0
    } else {
        dy / dx
    };

    let mut intery = y0 + gradient * (x0.round() - x0);

    let x_start = x0.round() as i32;
    let x_end = x1.round() as i32;
    let w = width as i32;
    let h = height as i32;

    let mut plot = |ix: i32, iy: i32, c: f32| {
        if ix < 0 || iy < 0 || ix >= w || iy >= h {
            return;
        }
        let idx = (iy as usize) * width + (ix as usize);
        f(idx, c);
    };

    for x in x_start..=x_end {
        if steep {
            let iy = intery.floor() as i32;
            plot(iy, x, rfpart(intery));
            plot(iy + 1, x, fpart(intery));
        } else {
            let iy = intery.floor() as i32;
            plot(x, iy, rfpart(intery));
            plot(x, iy + 1, fpart(intery));
        }
        intery += gradient;
    }
}

pub fn score_chord(
    residual: &[f32],
    width: usize,
    height: usize,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
) -> f32 {
    let mut sum = 0.0f32;
    let mut weight = 0.0f32;
    for_each_pixel(x0, y0, x1, y1, width, height, |idx, c| {
        sum += residual[idx] * c;
        weight += c;
    });
    if weight > 0.0 {
        sum / weight
    } else {
        0.0
    }
}

pub struct Endpoints {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

pub fn draw_chord(residual: &mut [f32], width: usize, height: usize, e: Endpoints, opacity: f32) {
    for_each_pixel(e.x0, e.y0, e.x1, e.y1, width, height, |idx, c| {
        residual[idx] = (residual[idx] - opacity * c).max(0.0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horizontal_line_touches_each_column() {
        let w = 10;
        let h = 10;
        let mut residual = vec![1.0f32; w * h];
        draw_chord(
            &mut residual,
            w,
            h,
            Endpoints {
                x0: 0.5,
                y0: 5.0,
                x1: 9.5,
                y1: 5.0,
            },
            0.5,
        );
        for x in 1..9 {
            // All middle pixels on row 5 should be reduced.
            assert!(
                residual[5 * w + x] < 0.9,
                "col {x} not drawn on: {}",
                residual[5 * w + x],
            );
        }
    }

    #[test]
    fn score_increases_with_residual() {
        let w = 16;
        let h = 16;
        let low = vec![0.1f32; w * h];
        let high = vec![0.9f32; w * h];
        let s_low = score_chord(&low, w, h, 0.5, 8.0, 15.5, 8.0);
        let s_high = score_chord(&high, w, h, 0.5, 8.0, 15.5, 8.0);
        assert!(s_high > s_low, "{s_high} should exceed {s_low}");
    }
}
