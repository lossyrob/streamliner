use crate::model::EventKind;
use ab_glyph::{point, Font, FontArc, GlyphId, PxScale, ScaleFont};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

const FONT_BYTES: &[u8] = include_bytes!("../assets/Inter.ttf");

#[derive(Clone, Copy)]
struct EventStyle {
    color: (u8, u8, u8),
    mark: EventMark,
}

#[derive(Clone, Copy)]
enum EventMark {
    Dot,
    Plus,
    Check,
    X,
    Equal,
    Star,
}

pub fn render_badge(color_hex: &str, monogram: &str, event_kind: EventKind, size_px: u32) -> Vec<u8> {
    let font = FontArc::try_from_slice(FONT_BYTES).expect("bundled Inter font must be valid");
    let pixmap = render_pixmap(color_hex, monogram, event_kind, size_px, &font);
    pixmap.encode_png().expect("badge PNG encoding must succeed")
}

pub fn render_badge_cached(
    cache_dir: impl AsRef<Path>,
    color_hex: &str,
    monogram: &str,
    event_kind: EventKind,
    size_px: u32,
) -> io::Result<Vec<u8>> {
    let cache_dir = cache_dir.as_ref();
    fs::create_dir_all(cache_dir)?;
    let path = cache_path(cache_dir, color_hex, monogram, event_kind, size_px);
    if path.exists() {
        return fs::read(path);
    }

    let png = render_badge(color_hex, monogram, event_kind, size_px);
    fs::write(&path, &png)?;
    Ok(png)
}

/// On-disk path that [`render_badge_cached`] uses for the given inputs. Lets a
/// caller (e.g. the toast emitter) reference the cached PNG file directly.
pub fn badge_cache_path(
    cache_dir: impl AsRef<Path>,
    color_hex: &str,
    monogram: &str,
    event_kind: EventKind,
    size_px: u32,
) -> PathBuf {
    cache_path(cache_dir.as_ref(), color_hex, monogram, event_kind, size_px)
}

pub fn derive_display_monogram(short_name: Option<&str>) -> String {
    let cleaned: String = short_name
        .unwrap_or("")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(3)
        .flat_map(char::to_uppercase)
        .collect();

    if cleaned.is_empty() {
        "SL".to_string()
    } else {
        cleaned
    }
}

pub fn text_color_for_hex(color_hex: &str) -> (u8, u8, u8, u8) {
    let base = parse_hex(color_hex).unwrap_or((109, 93, 251));
    if relative_luminance(base) > 0.48 {
        (15, 23, 42, 255)
    } else {
        (255, 255, 255, 255)
    }
}

fn render_pixmap(
    color_hex: &str,
    monogram: &str,
    event_kind: EventKind,
    size: u32,
    font: &FontArc,
) -> Pixmap {
    let size = size.max(1);
    let mut pixmap = Pixmap::new(size, size).expect("pixmap allocation must succeed");
    pixmap.fill(Color::TRANSPARENT);

    let base = parse_hex(color_hex).unwrap_or((109, 93, 251));
    let display_monogram = derive_display_monogram(Some(monogram));
    let text_color = text_color_for_hex(color_hex);

    let pad = size as f32 * 0.035;
    let radius = size as f32 * 0.18;
    let rect = rounded_rect_path(pad, pad, size as f32 - pad * 2.0, size as f32 - pad * 2.0, radius);
    fill_path(&mut pixmap, &rect, rgba(base.0, base.1, base.2, 255));

    draw_inner_highlight(&mut pixmap, size);

    let initials_size = initials_font_size(&display_monogram, size);
    draw_centered_text(
        &mut pixmap,
        font,
        &display_monogram,
        initials_size,
        0.50,
        (0, 0, 0, 72),
    );
    draw_centered_text(
        &mut pixmap,
        font,
        &display_monogram,
        initials_size,
        0.485,
        text_color,
    );

    draw_event_chip(&mut pixmap, font, event_style(event_kind), size);
    pixmap
}

fn cache_path(
    cache_dir: &Path,
    color_hex: &str,
    monogram: &str,
    event_kind: EventKind,
    size_px: u32,
) -> PathBuf {
    let color = color_hex.trim_start_matches('#').to_ascii_lowercase();
    let monogram = derive_display_monogram(Some(monogram)).to_ascii_lowercase();
    cache_dir.join(format!(
        "{color}-{monogram}-{}-{size_px}.png",
        event_kind.as_str()
    ))
}

fn event_style(kind: EventKind) -> EventStyle {
    match kind {
        EventKind::Online => EventStyle {
            color: (16, 185, 129),
            mark: EventMark::Dot,
        },
        EventKind::PrCreated => EventStyle {
            color: (59, 130, 246),
            mark: EventMark::Plus,
        },
        EventKind::PrApproved => EventStyle {
            color: (34, 197, 94),
            mark: EventMark::Check,
        },
        EventKind::IssueClosed => EventStyle {
            color: (239, 68, 68),
            mark: EventMark::X,
        },
        EventKind::Reconciled => EventStyle {
            color: (168, 85, 247),
            mark: EventMark::Equal,
        },
        EventKind::Done => EventStyle {
            color: (245, 158, 11),
            mark: EventMark::Star,
        },
        EventKind::Generic => EventStyle {
            color: (100, 116, 139),
            mark: EventMark::Dot,
        },
    }
}

fn draw_event_chip(pixmap: &mut Pixmap, font: &FontArc, event: EventStyle, size: u32) {
    let s = size as f32;
    let r = s * 0.168;
    let cx = s - r - s * 0.055;
    let cy = s - r - s * 0.055;

    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r + s * 0.035);
    fill_path(
        pixmap,
        &pb.finish().expect("outer chip path must finish"),
        Color::from_rgba8(255, 255, 255, 235),
    );

    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r);
    fill_path(
        pixmap,
        &pb.finish().expect("inner chip path must finish"),
        rgba(event.color.0, event.color.1, event.color.2, 255),
    );

    match event.mark {
        EventMark::Dot => draw_dot_mark(pixmap, cx, cy, r),
        EventMark::Plus => draw_plus_mark(pixmap, cx, cy, r),
        EventMark::Check => draw_glyph_mark(pixmap, font, "✓", cx, cy, r, 1.35),
        EventMark::X => draw_glyph_mark(pixmap, font, "×", cx, cy, r, 1.35),
        EventMark::Equal => draw_equal_mark(pixmap, cx, cy, r),
        EventMark::Star => draw_glyph_mark(pixmap, font, "★", cx, cy, r, 1.15),
    }
}

fn draw_dot_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r * 0.38);
    fill_path(
        pixmap,
        &pb.finish().expect("dot path must finish"),
        Color::from_rgba8(255, 255, 255, 255),
    );
}

fn draw_plus_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let w = r * 0.28;
    let len = r * 1.05;
    fill_rect(
        pixmap,
        cx - w / 2.0,
        cy - len / 2.0,
        w,
        len,
        Color::from_rgba8(255, 255, 255, 255),
    );
    fill_rect(
        pixmap,
        cx - len / 2.0,
        cy - w / 2.0,
        len,
        w,
        Color::from_rgba8(255, 255, 255, 255),
    );
}

fn draw_equal_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let w = r;
    let h = r * 0.22;
    fill_rect(
        pixmap,
        cx - w / 2.0,
        cy - r * 0.25,
        w,
        h,
        Color::from_rgba8(255, 255, 255, 255),
    );
    fill_rect(
        pixmap,
        cx - w / 2.0,
        cy + r * 0.08,
        w,
        h,
        Color::from_rgba8(255, 255, 255, 255),
    );
}

fn draw_glyph_mark(
    pixmap: &mut Pixmap,
    font: &FontArc,
    text: &str,
    cx: f32,
    cy: f32,
    r: f32,
    scale: f32,
) {
    draw_centered_text_at(
        pixmap,
        font,
        text,
        r * scale,
        cx,
        cy + r * 0.04,
        (255, 255, 255, 255),
    );
}

fn draw_inner_highlight(pixmap: &mut Pixmap, size: u32) {
    let s = size as f32;
    let path = rounded_rect_path(s * 0.055, s * 0.055, s * 0.89, s * 0.89, s * 0.15);
    let mut paint = Paint::default();
    paint.set_color_rgba8(255, 255, 255, 54);
    let stroke = Stroke {
        width: s * 0.018,
        ..Stroke::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

fn draw_centered_text(
    pixmap: &mut Pixmap,
    font: &FontArc,
    text: &str,
    px: f32,
    y_fraction: f32,
    rgba: (u8, u8, u8, u8),
) {
    let cx = pixmap.width() as f32 / 2.0;
    let cy = pixmap.height() as f32 * y_fraction;
    draw_centered_text_at(pixmap, font, text, px, cx, cy, rgba);
}

fn draw_centered_text_at(
    pixmap: &mut Pixmap,
    font: &FontArc,
    text: &str,
    px: f32,
    cx: f32,
    cy: f32,
    rgba: (u8, u8, u8, u8),
) {
    let scale = PxScale::from(px);
    let scaled = font.as_scaled(scale);
    let width = text_width(font, &scaled, text);
    let baseline = cy + (scaled.ascent() + scaled.descent()).abs() * 0.19;
    let mut x = cx - width / 2.0;
    let mut prev: Option<GlyphId> = None;

    for ch in text.chars() {
        let id = font.glyph_id(ch);
        if let Some(prev_id) = prev {
            x += scaled.kern(prev_id, id);
        }
        let glyph = id.with_scale_and_position(scale, point(x, baseline));
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, alpha| {
                let x = bounds.min.x as i32 + gx as i32;
                let y = bounds.min.y as i32 + gy as i32;
                blend_pixel(pixmap, x, y, rgba, alpha);
            });
        }
        x += scaled.h_advance(id);
        prev = Some(id);
    }
}

fn text_width<'a, S: ScaleFont<&'a FontArc>>(font: &'a FontArc, scaled: &S, text: &str) -> f32 {
    let mut width = 0.0;
    let mut prev: Option<GlyphId> = None;
    for ch in text.chars() {
        let id = font.glyph_id(ch);
        if let Some(prev_id) = prev {
            width += scaled.kern(prev_id, id);
        }
        width += scaled.h_advance(id);
        prev = Some(id);
    }
    width
}

fn blend_pixel(pixmap: &mut Pixmap, gx: i32, gy: i32, rgba: (u8, u8, u8, u8), glyph_alpha: f32) {
    if gx < 0 || gy < 0 || gx as u32 >= pixmap.width() || gy as u32 >= pixmap.height() {
        return;
    }
    let gx = gx as u32;
    let gy = gy as u32;
    let idx = ((gy * pixmap.width() + gx) * 4) as usize;
    let a = (rgba.3 as f32 / 255.0) * glyph_alpha;
    let data = pixmap.data_mut();
    for (i, src) in [rgba.0, rgba.1, rgba.2].iter().enumerate() {
        let dst = data[idx + i] as f32;
        data[idx + i] = ((*src as f32 * a) + dst * (1.0 - a))
            .round()
            .clamp(0.0, 255.0) as u8;
    }
    data[idx + 3] = 255;
}

fn fill_path(pixmap: &mut Pixmap, path: &tiny_skia::Path, color: Color) {
    let mut paint = Paint::default();
    paint.set_color(color);
    pixmap.fill_path(path, &paint, FillRule::Winding, Transform::identity(), None);
}

fn fill_rect(pixmap: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, color: Color) {
    let mut paint = Paint::default();
    paint.set_color(color);
    let Some(rect) = Rect::from_xywh(x, y, w, h) else {
        return;
    };
    pixmap.fill_rect(rect, &paint, Transform::identity(), None);
}

fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, r: f32) -> tiny_skia::Path {
    let k = 0.552_284_8;
    let r = r.min(w / 2.0).min(h / 2.0);
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + r * k, y, x + w, y + r - r * k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(
        x + w,
        y + h - r + r * k,
        x + w - r + r * k,
        y + h,
        x + w - r,
        y + h,
    );
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - r * k, y + h, x, y + h - r + r * k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - r * k, x + r - r * k, y, x + r, y);
    pb.close();
    pb.finish().expect("rounded rectangle path must finish")
}

fn initials_font_size(initials: &str, size: u32) -> f32 {
    let n = initials.chars().count();
    let factor = match n {
        0..=2 => 0.48,
        3 => 0.40,
        _ => 0.32,
    };
    size as f32 * factor
}

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    Some((
        u8::from_str_radix(&h[0..2], 16).ok()?,
        u8::from_str_radix(&h[2..4], 16).ok()?,
        u8::from_str_radix(&h[4..6], 16).ok()?,
    ))
}

fn rgba(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color::from_rgba8(r, g, b, a)
}

fn relative_luminance(rgb: (u8, u8, u8)) -> f32 {
    fn channel(v: u8) -> f32 {
        let c = v as f32 / 255.0;
        if c <= 0.039_28 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * channel(rgb.0) + 0.7152 * channel(rgb.1) + 0.0722 * channel(rgb.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cache_dir(name: &str) -> PathBuf {
        let dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join("test-cache")
            .join(name);
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rendering_is_deterministic_and_png_at_48_and_256() {
        let first = render_badge("6D5DFB", "STR", EventKind::PrApproved, 48);
        let second = render_badge("#6D5DFB", "STR", EventKind::PrApproved, 48);
        assert_eq!(first, second);
        assert!(first.starts_with(b"\x89PNG"));

        let large = render_badge("6D5DFB", "STR", EventKind::PrApproved, 256);
        assert!(large.starts_with(b"\x89PNG"));
        assert_ne!(first, large);
    }

    #[test]
    fn monogram_derivation_caps_to_three_ascii_alphanumeric_chars() {
        assert_eq!(derive_display_monogram(Some("streamliner")), "STR");
        assert_eq!(derive_display_monogram(Some("db")), "DB");
        assert_eq!(derive_display_monogram(Some(" a-p i ")), "API");
        assert_eq!(derive_display_monogram(Some("!!!")), "SL");
        assert!(derive_display_monogram(Some("abcd")).chars().count() <= 3);
    }

    #[test]
    fn cached_render_writes_one_file_per_key() {
        let cache = test_cache_dir("cached-render");
        let first = render_badge_cached(&cache, "6D5DFB", "STR", EventKind::Done, 96).unwrap();
        let second = render_badge_cached(&cache, "#6d5dfb", "streamliner", EventKind::Done, 96).unwrap();
        assert_eq!(first, second);

        let files = fs::read_dir(&cache).unwrap().count();
        assert_eq!(files, 1);
    }

    #[test]
    fn text_color_uses_luminance() {
        assert_eq!(text_color_for_hex("FFFFFF"), (15, 23, 42, 255));
        assert_eq!(text_color_for_hex("000000"), (255, 255, 255, 255));
    }

    #[test]
    fn all_event_kinds_render_without_panic() {
        for kind in EventKind::ALL {
            let png = render_badge("0078D4", "API", kind, 48);
            assert!(png.starts_with(b"\x89PNG"), "{kind:?} did not render a PNG");
        }
    }
}
