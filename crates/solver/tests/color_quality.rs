//! End-to-end color-mode quality harness.
//!
//! For each reference image, runs the color solver, renders the emitted
//! sequence onto a simulated canvas via the same alpha-over-in-linear-
//! RGB model the solver deposits with, and computes:
//!
//!  - mean and p95 CIE ΔE2000 (perceptual color difference in Lab)
//!  - mean linear-RGB L2 error (structural fast-check)
//!  - global luminance SSIM (Rec.709)
//!
//! These gate CI against regressions: reverting to scalar residual,
//! breaking the deposit model, starving a color via a misconfigured
//! budget. Thresholds sit loose enough that reasonable solver tweaks
//! don't trip them, tight enough that a real regression fails.
//!
//! Reference images span portrait (skin-tone gradient on cream),
//! landscape (sky + foliage), and high-chroma (three-panel primaries).
//! Synthetic rather than file-loaded so the harness stays portable.

use solver::solver::palette::{srgb_to_linear, Palette};
use solver::solver::{Solver, SolverConfig};

const BOARD_LINEAR: [f32; 3] = [0.904_587_8, 0.862_741_3, 0.784_452_6];

fn high_chroma_three_panel(size: usize) -> Vec<u8> {
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let base = (y * size + x) * 4;
            let (r, g, b) = if x < size / 3 {
                (210u8, 40u8, 40u8)
            } else if x < 2 * size / 3 {
                (40u8, 40u8, 210u8)
            } else {
                (210u8, 200u8, 40u8)
            };
            rgba[base] = r;
            rgba[base + 1] = g;
            rgba[base + 2] = b;
            rgba[base + 3] = 255;
        }
    }
    rgba
}

fn portrait_rgba(size: usize) -> Vec<u8> {
    // Oval face-like region with a warm-skin gradient, darker shadow
    // on the right cheek, on a muted cream background. Exercises the
    // skin-tone path the solver is tuned around.
    let mut rgba = vec![0u8; size * size * 4];
    let cx = size as f32 * 0.5;
    let cy = size as f32 * 0.5;
    let rx = size as f32 * 0.32;
    let ry = size as f32 * 0.40;
    for y in 0..size {
        for x in 0..size {
            let base = (y * size + x) * 4;
            let dx = (x as f32 - cx) / rx;
            let dy = (y as f32 - cy) / ry;
            let in_face = dx * dx + dy * dy <= 1.0;
            let (r, g, b) = if in_face {
                // Warm skin tone with a shadow term from the right-x side.
                let shadow = (0.5 + 0.5 * dx).clamp(0.0, 1.0);
                let lit = 1.0 - 0.35 * shadow;
                (
                    (220.0 * lit) as u8,
                    (165.0 * lit) as u8,
                    (130.0 * lit) as u8,
                )
            } else {
                (238u8, 228u8, 212u8)
            };
            rgba[base] = r;
            rgba[base + 1] = g;
            rgba[base + 2] = b;
            rgba[base + 3] = 255;
        }
    }
    rgba
}

fn landscape_rgba(size: usize) -> Vec<u8> {
    // Sky gradient top half (blue → white horizon), green foliage
    // bottom half. Low-chroma image compared to high-chroma, checks
    // that muddy rejection + budget allocation handle natural scenes.
    let mut rgba = vec![0u8; size * size * 4];
    let h = size as f32;
    for y in 0..size {
        let t = y as f32 / (h - 1.0);
        for x in 0..size {
            let base = (y * size + x) * 4;
            let (r, g, b) = if t < 0.5 {
                let u = t * 2.0;
                (
                    (120.0 + 110.0 * u) as u8,
                    (160.0 + 80.0 * u) as u8,
                    (210.0 + 30.0 * u) as u8,
                )
            } else {
                let u = (t - 0.5) * 2.0;
                (
                    (60.0 + 40.0 * (1.0 - u)) as u8,
                    (130.0 + 50.0 * (1.0 - u)) as u8,
                    (40.0 + 30.0 * (1.0 - u)) as u8,
                )
            };
            rgba[base] = r;
            rgba[base + 1] = g;
            rgba[base + 2] = b;
            rgba[base + 3] = 255;
        }
    }
    rgba
}

fn linear_target(rgba: &[u8], size: usize) -> Vec<[f32; 3]> {
    rgba.chunks_exact(4)
        .take(size * size)
        .map(|c| {
            [
                srgb_to_linear(c[0] as f32 / 255.0).min(BOARD_LINEAR[0]),
                srgb_to_linear(c[1] as f32 / 255.0).min(BOARD_LINEAR[1]),
                srgb_to_linear(c[2] as f32 / 255.0).min(BOARD_LINEAR[2]),
            ]
        })
        .collect()
}

/// Wu-antialiased line rasterizer — duplicated here instead of
/// exposed from the solver crate so the quality harness stays
/// self-contained. Matches `solver::chord::for_each_pixel` so
/// deposits in the harness exactly mirror solver deposits.
fn for_each_pixel(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    width: usize,
    height: usize,
    mut f: impl FnMut(usize, f32),
) {
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
            plot(iy, x, 1.0 - (intery - intery.floor()));
            plot(iy + 1, x, intery - intery.floor());
        } else {
            let iy = intery.floor() as i32;
            plot(x, iy, 1.0 - (intery - intery.floor()));
            plot(x, iy + 1, intery - intery.floor());
        }
        intery += gradient;
    }
}

fn render_sequence(
    size: usize,
    pin_positions: &[(f32, f32)],
    sequence: &[u16],
    colors: &[u8],
    palette_linear: &[[f32; 3]],
    opacity: f32,
) -> Vec<[f32; 3]> {
    let n = size * size;
    let mut canvas = vec![BOARD_LINEAR; n];
    for i in 1..sequence.len() {
        let from = sequence[i - 1] as usize;
        let to = sequence[i] as usize;
        let color_idx = colors[i] as usize;
        if color_idx >= palette_linear.len() {
            continue;
        }
        let thread = palette_linear[color_idx];
        let (fx, fy) = pin_positions[from];
        let (tx, ty) = pin_positions[to];
        for_each_pixel(fx, fy, tx, ty, size, size, |idx, cov| {
            let k = opacity * cov;
            canvas[idx][0] += k * (thread[0] - canvas[idx][0]);
            canvas[idx][1] += k * (thread[1] - canvas[idx][1]);
            canvas[idx][2] += k * (thread[2] - canvas[idx][2]);
        });
    }
    canvas
}

fn mean_rgb_l2(a: &[[f32; 3]], b: &[[f32; 3]]) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    for (x, y) in a.iter().zip(b.iter()) {
        let d0 = x[0] - y[0];
        let d1 = x[1] - y[1];
        let d2 = x[2] - y[2];
        sum += (d0 * d0 + d1 * d1 + d2 * d2).sqrt();
        count += 1;
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f32
    }
}

fn rec709_luminance(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

fn ssim_luminance(a: &[[f32; 3]], b: &[[f32; 3]]) -> f32 {
    let n = a.len() as f32;
    if n == 0.0 {
        return 1.0;
    }
    let la: Vec<f32> = a.iter().map(|c| rec709_luminance(*c)).collect();
    let lb: Vec<f32> = b.iter().map(|c| rec709_luminance(*c)).collect();
    let mean_a = la.iter().sum::<f32>() / n;
    let mean_b = lb.iter().sum::<f32>() / n;
    let mut var_a = 0.0f32;
    let mut var_b = 0.0f32;
    let mut cov = 0.0f32;
    for (a, b) in la.iter().zip(lb.iter()) {
        let da = a - mean_a;
        let db = b - mean_b;
        var_a += da * da;
        var_b += db * db;
        cov += da * db;
    }
    var_a /= n;
    var_b /= n;
    cov /= n;
    let k1 = 0.01f32;
    let k2 = 0.03f32;
    let c1 = (k1 * 1.0).powi(2);
    let c2 = (k2 * 1.0).powi(2);
    let num = (2.0 * mean_a * mean_b + c1) * (2.0 * cov + c2);
    let denom = (mean_a.powi(2) + mean_b.powi(2) + c1) * (var_a + var_b + c2);
    if denom <= 0.0 {
        1.0
    } else {
        num / denom
    }
}

/// Linear sRGB (D65) → CIE XYZ via the standard BT.709 matrix.
fn linear_rgb_to_xyz(rgb: [f32; 3]) -> [f32; 3] {
    [
        0.412_390_8 * rgb[0] + 0.357_584_3 * rgb[1] + 0.180_480_8 * rgb[2],
        0.212_639 * rgb[0] + 0.715_168_7 * rgb[1] + 0.072_192_3 * rgb[2],
        0.019_330_8 * rgb[0] + 0.119_194_8 * rgb[1] + 0.950_532_2 * rgb[2],
    ]
}

/// XYZ → CIELAB with the D65 white point.
fn xyz_to_lab(xyz: [f32; 3]) -> [f32; 3] {
    const XN: f32 = 0.95047;
    const YN: f32 = 1.0;
    const ZN: f32 = 1.08883;
    fn f(t: f32) -> f32 {
        const DELTA: f32 = 6.0 / 29.0;
        if t > DELTA * DELTA * DELTA {
            t.cbrt()
        } else {
            t / (3.0 * DELTA * DELTA) + 4.0 / 29.0
        }
    }
    let fx = f(xyz[0] / XN);
    let fy = f(xyz[1] / YN);
    let fz = f(xyz[2] / ZN);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn linear_rgb_to_lab(rgb: [f32; 3]) -> [f32; 3] {
    xyz_to_lab(linear_rgb_to_xyz(rgb))
}

/// CIE ΔE2000 between two Lab colors. Follows Sharma et al. (2005)
/// reference implementation.
fn delta_e2000(lab1: [f32; 3], lab2: [f32; 3]) -> f32 {
    let (l1, a1, b1) = (lab1[0], lab1[1], lab1[2]);
    let (l2, a2, b2) = (lab2[0], lab2[1], lab2[2]);
    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let c_bar = 0.5 * (c1 + c2);
    let c_bar7 = c_bar.powi(7);
    let g = 0.5 * (1.0 - (c_bar7 / (c_bar7 + 25f32.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = (a1p * a1p + b1 * b1).sqrt();
    let c2p = (a2p * a2p + b2 * b2).sqrt();
    let h1p = hue_angle(b1, a1p);
    let h2p = hue_angle(b2, a2p);
    let dlp = l2 - l1;
    let dcp = c2p - c1p;
    let mut dhp = h2p - h1p;
    if c1p * c2p == 0.0 {
        dhp = 0.0;
    } else if dhp > 180.0 {
        dhp -= 360.0;
    } else if dhp < -180.0 {
        dhp += 360.0;
    }
    let dhp_big = 2.0 * (c1p * c2p).sqrt() * (dhp.to_radians() * 0.5).sin();
    let l_bar = 0.5 * (l1 + l2);
    let cp_bar = 0.5 * (c1p + c2p);
    let mut hp_bar = h1p + h2p;
    if c1p * c2p != 0.0 {
        if (h1p - h2p).abs() > 180.0 {
            if h1p + h2p < 360.0 {
                hp_bar += 360.0;
            } else {
                hp_bar -= 360.0;
            }
        }
        hp_bar *= 0.5;
    }
    let t = 1.0 - 0.17 * (hp_bar - 30.0).to_radians().cos()
        + 0.24 * (2.0 * hp_bar).to_radians().cos()
        + 0.32 * (3.0 * hp_bar + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hp_bar - 63.0).to_radians().cos();
    let d_theta = 30.0 * (-(((hp_bar - 275.0) / 25.0).powi(2))).exp();
    let cp_bar7 = cp_bar.powi(7);
    let rc = 2.0 * (cp_bar7 / (cp_bar7 + 25f32.powi(7))).sqrt();
    let sl = 1.0 + (0.015 * (l_bar - 50.0).powi(2)) / (20.0 + (l_bar - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cp_bar;
    let sh = 1.0 + 0.015 * cp_bar * t;
    let rt = -(2.0 * d_theta).to_radians().sin() * rc;
    let kl = 1.0;
    let kc = 1.0;
    let kh = 1.0;
    let tl = dlp / (kl * sl);
    let tc = dcp / (kc * sc);
    let th = dhp_big / (kh * sh);
    (tl * tl + tc * tc + th * th + rt * tc * th).sqrt()
}

fn hue_angle(b: f32, a: f32) -> f32 {
    if b == 0.0 && a == 0.0 {
        return 0.0;
    }
    let mut deg = b.atan2(a).to_degrees();
    if deg < 0.0 {
        deg += 360.0;
    }
    deg
}

fn p95(mut values: Vec<f32>) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((values.len() as f32 - 1.0) * 0.95).round() as usize;
    values[idx.min(values.len() - 1)]
}

fn lab_metrics(a: &[[f32; 3]], b: &[[f32; 3]]) -> (f32, f32) {
    let per_pixel: Vec<f32> = a
        .iter()
        .zip(b.iter())
        .map(|(&x, &y)| delta_e2000(linear_rgb_to_lab(x), linear_rgb_to_lab(y)))
        .collect();
    let mean = if per_pixel.is_empty() {
        0.0
    } else {
        per_pixel.iter().sum::<f32>() / per_pixel.len() as f32
    };
    (mean, p95(per_pixel))
}

struct QualityReport {
    mean_l2: f32,
    mean_de2000: f32,
    p95_de2000: f32,
    ssim: f32,
    color_counts: Vec<u32>,
}

fn solve_and_measure(
    rgba: &[u8],
    size: usize,
    palette_bytes: &[u8],
    color_budgets: [u32; 8],
    line_budget: u32,
) -> QualityReport {
    let palette = Palette::from_srgb_bytes(palette_bytes).unwrap();
    let palette_linear: Vec<[f32; 3]> = palette_bytes
        .chunks_exact(3)
        .map(|c| {
            [
                srgb_to_linear(c[0] as f32 / 255.0),
                srgb_to_linear(c[1] as f32 / 255.0),
                srgb_to_linear(c[2] as f32 / 255.0),
            ]
        })
        .collect();
    let config = SolverConfig {
        pin_count: 144,
        line_budget,
        opacity: 0.10,
        min_chord_skip: 8,
        ban_window: 12,
        switch_cost_factor: 0.15,
        color_budgets,
        ..Default::default()
    };
    let mut solver = Solver::new(rgba, size, config, palette, 42, None, 0.0).unwrap();
    let mut sequence: Vec<u16> = vec![0];
    let mut colors: Vec<u8> = vec![0];
    while !solver.is_done() {
        let batch = solver.step_many(100);
        if batch.is_empty() {
            break;
        }
        let batch_colors = solver.last_batch_colors();
        sequence.extend(batch.iter().copied());
        colors.extend(batch_colors.iter().copied());
    }
    assert!(sequence.len() > 1, "solver emitted no chords");

    let pin_positions: Vec<(f32, f32)> = (0..config.pin_count)
        .map(|i| solver.pin_position(i))
        .collect();
    let rendered = render_sequence(
        size,
        &pin_positions,
        &sequence,
        &colors,
        &palette_linear,
        config.opacity,
    );
    let target = linear_target(rgba, size);
    let mean_l2 = mean_rgb_l2(&rendered, &target);
    let ssim = ssim_luminance(&rendered, &target);
    let (mean_de, p95_de) = lab_metrics(&rendered, &target);

    let mut color_counts = vec![0u32; palette_linear.len()];
    for &c in &colors {
        if (c as usize) < color_counts.len() {
            color_counts[c as usize] += 1;
        }
    }
    QualityReport {
        mean_l2,
        mean_de2000: mean_de,
        p95_de2000: p95_de,
        ssim,
        color_counts,
    }
}

#[test]
fn high_chroma_three_panel_within_tolerance() {
    let size = 128usize;
    let rgba = high_chroma_three_panel(size);
    let palette_bytes: &[u8] = &[
        0x11, 0x11, 0x11, // near-black
        0xc8, 0x20, 0x20, // red
        0x20, 0x20, 0xc8, // blue
        0xc8, 0xb0, 0x20, // yellow
    ];
    let total: u32 = 3000;
    let black_budget = total * 30 / 100;
    let chromatic = (total - black_budget) / 3;
    let mut color_budgets = [0u32; 8];
    color_budgets[0] = black_budget;
    color_budgets[1] = chromatic;
    color_budgets[2] = chromatic;
    color_budgets[3] = chromatic;

    let report = solve_and_measure(&rgba, size, palette_bytes, color_budgets, total);
    eprintln!(
        "high_chroma: mean_l2={:.4} mean_de2000={:.2} p95_de2000={:.2} ssim={:.4}",
        report.mean_l2, report.mean_de2000, report.p95_de2000, report.ssim
    );
    assert!(
        report.mean_l2 < 0.55,
        "mean L2 regressed: {}",
        report.mean_l2
    );
    assert!(
        report.mean_de2000 < 35.0,
        "mean ΔE2000 regressed: {}",
        report.mean_de2000
    );
    assert!(
        report.p95_de2000 < 55.0,
        "p95 ΔE2000 regressed: {}",
        report.p95_de2000
    );
    assert!(report.ssim > 0.35, "SSIM regressed: {}", report.ssim);
    for (i, n) in report.color_counts.iter().enumerate() {
        assert!(*n > 0, "palette slot {i} was starved (0 lines)");
    }
}

#[test]
fn portrait_skin_gradient_within_tolerance() {
    let size = 128usize;
    let rgba = portrait_rgba(size);
    // Warm-skin palette: black shadow, warm red, orange, cream-accent.
    let palette_bytes: &[u8] = &[
        0x11, 0x11, 0x11, // near-black shadow
        0xa0, 0x30, 0x28, // warm red
        0xc8, 0x80, 0x40, // orange
        0x80, 0x40, 0x28, // brick / terracotta
    ];
    let total: u32 = 3000;
    let black_budget = total * 35 / 100;
    let chromatic = (total - black_budget) / 3;
    let mut color_budgets = [0u32; 8];
    color_budgets[0] = black_budget;
    color_budgets[1] = chromatic;
    color_budgets[2] = chromatic;
    color_budgets[3] = chromatic;

    let report = solve_and_measure(&rgba, size, palette_bytes, color_budgets, total);
    eprintln!(
        "portrait: mean_l2={:.4} mean_de2000={:.2} p95_de2000={:.2} ssim={:.4}",
        report.mean_l2, report.mean_de2000, report.p95_de2000, report.ssim
    );
    assert!(
        report.mean_l2 < 0.50,
        "mean L2 regressed: {}",
        report.mean_l2
    );
    assert!(
        report.mean_de2000 < 30.0,
        "mean ΔE2000 regressed: {}",
        report.mean_de2000
    );
    assert!(
        report.p95_de2000 < 50.0,
        "p95 ΔE2000 regressed: {}",
        report.p95_de2000
    );
    assert!(report.ssim > 0.35, "SSIM regressed: {}", report.ssim);
    for (i, n) in report.color_counts.iter().enumerate() {
        assert!(*n > 0, "palette slot {i} was starved (0 lines)");
    }
}

#[test]
fn landscape_sky_and_foliage_within_tolerance() {
    let size = 128usize;
    let rgba = landscape_rgba(size);
    // Sky + foliage palette: black, deep blue, green, warm accent for
    // horizon glow.
    let palette_bytes: &[u8] = &[
        0x11, 0x11, 0x11, // near-black
        0x28, 0x48, 0xa0, // deep blue sky
        0x40, 0x80, 0x38, // foliage green
        0xc0, 0x98, 0x58, // warm horizon
    ];
    let total: u32 = 3000;
    let black_budget = total * 25 / 100;
    let chromatic = (total - black_budget) / 3;
    let mut color_budgets = [0u32; 8];
    color_budgets[0] = black_budget;
    color_budgets[1] = chromatic;
    color_budgets[2] = chromatic;
    color_budgets[3] = chromatic;

    let report = solve_and_measure(&rgba, size, palette_bytes, color_budgets, total);
    eprintln!(
        "landscape: mean_l2={:.4} mean_de2000={:.2} p95_de2000={:.2} ssim={:.4}",
        report.mean_l2, report.mean_de2000, report.p95_de2000, report.ssim
    );
    assert!(
        report.mean_l2 < 0.45,
        "mean L2 regressed: {}",
        report.mean_l2
    );
    assert!(
        report.mean_de2000 < 30.0,
        "mean ΔE2000 regressed: {}",
        report.mean_de2000
    );
    assert!(
        report.p95_de2000 < 50.0,
        "p95 ΔE2000 regressed: {}",
        report.p95_de2000
    );
    assert!(report.ssim > 0.35, "SSIM regressed: {}", report.ssim);
    for (i, n) in report.color_counts.iter().enumerate() {
        assert!(*n > 0, "palette slot {i} was starved (0 lines)");
    }
}
