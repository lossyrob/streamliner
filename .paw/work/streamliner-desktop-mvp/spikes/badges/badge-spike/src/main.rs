use ab_glyph::{point, Font, FontArc, GlyphId, PxScale, ScaleFont};
use std::error::Error;
use std::fs;
use std::path::Path;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

const FONT_BYTES: &[u8] = include_bytes!("../fonts/Inter.ttf");

#[derive(Clone, Copy)]
struct Workstream {
    initials: &'static str,
    hex: &'static str,
}

#[derive(Clone, Copy)]
struct EventStyle {
    key: &'static str,
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

fn main() -> Result<(), Box<dyn Error>> {
    let font = FontArc::try_from_slice(FONT_BYTES)?;
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("samples");
    fs::create_dir_all(&out_dir)?;

    let workstreams = [
        Workstream { initials: "STR", hex: "#6D5DFB" },
        Workstream { initials: "API", hex: "#0078D4" },
        Workstream { initials: "DB", hex: "#0E7A3B" },
    ];
    let events = [
        EventStyle { key: "online", color: (16, 185, 129), mark: EventMark::Dot },
        EventStyle { key: "pr-created", color: (59, 130, 246), mark: EventMark::Plus },
        EventStyle { key: "pr-approved", color: (34, 197, 94), mark: EventMark::Check },
        EventStyle { key: "issue-closed", color: (239, 68, 68), mark: EventMark::X },
        EventStyle { key: "reconciled", color: (168, 85, 247), mark: EventMark::Equal },
        EventStyle { key: "done", color: (245, 158, 11), mark: EventMark::Star },
    ];

    for ws in workstreams {
        for event in events {
            for size in [256u32, 48u32] {
                let badge = render_badge(ws, event, size, &font)?;
                let file = out_dir.join(format!("{}-{}-{}px.png", ws.initials.to_ascii_lowercase(), event.key, size));
                badge.save_png(file)?;
            }
        }
    }

    println!("wrote {} PNGs to {}", workstreams.len() * events.len() * 2, out_dir.display());
    Ok(())
}

fn render_badge(ws: Workstream, event: EventStyle, size: u32, font: &FontArc) -> Result<Pixmap, Box<dyn Error>> {
    let mut pixmap = Pixmap::new(size, size).ok_or("pixmap allocation failed")?;
    pixmap.fill(Color::TRANSPARENT);

    let base = parse_hex(ws.hex)?;
    let text_color = if relative_luminance(base) > 0.48 { (15, 23, 42, 255) } else { (255, 255, 255, 255) };

    let pad = size as f32 * 0.035;
    let radius = size as f32 * 0.18;
    let rect = rounded_rect_path(pad, pad, size as f32 - pad * 2.0, size as f32 - pad * 2.0, radius);
    fill_path(&mut pixmap, &rect, rgba(base.0, base.1, base.2, 255));

    draw_inner_highlight(&mut pixmap, size);

    let initials_size = initials_font_size(ws.initials, size);
    draw_centered_text(&mut pixmap, font, ws.initials, initials_size, 0.50, (0, 0, 0, 72));
    draw_centered_text(&mut pixmap, font, ws.initials, initials_size, 0.485, text_color);

    draw_event_chip(&mut pixmap, font, event, size)?;
    Ok(pixmap)
}

fn draw_event_chip(pixmap: &mut Pixmap, font: &FontArc, event: EventStyle, size: u32) -> Result<(), Box<dyn Error>> {
    let s = size as f32;
    let r = s * 0.168;
    let cx = s - r - s * 0.055;
    let cy = s - r - s * 0.055;

    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r + s * 0.035);
    let outer = pb.finish().unwrap();
    fill_path(pixmap, &outer, Color::from_rgba8(255, 255, 255, 235));

    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r);
    let inner = pb.finish().unwrap();
    fill_path(pixmap, &inner, rgba(event.color.0, event.color.1, event.color.2, 255));

    match event.mark {
        EventMark::Dot => draw_dot_mark(pixmap, cx, cy, r),
        EventMark::Plus => draw_plus_mark(pixmap, cx, cy, r),
        EventMark::Check => draw_glyph_mark(pixmap, font, "✓", cx, cy, r, 1.35),
        EventMark::X => draw_glyph_mark(pixmap, font, "×", cx, cy, r, 1.35),
        EventMark::Equal => draw_equal_mark(pixmap, cx, cy, r),
        EventMark::Star => draw_glyph_mark(pixmap, font, "★", cx, cy, r, 1.15),
    }
    Ok(())
}

fn draw_dot_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let mut pb = PathBuilder::new();
    pb.push_circle(cx, cy, r * 0.38);
    fill_path(pixmap, &pb.finish().unwrap(), Color::from_rgba8(255, 255, 255, 255));
}

fn draw_plus_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let w = r * 0.28;
    let len = r * 1.05;
    fill_rect(pixmap, cx - w / 2.0, cy - len / 2.0, w, len, Color::from_rgba8(255, 255, 255, 255));
    fill_rect(pixmap, cx - len / 2.0, cy - w / 2.0, len, w, Color::from_rgba8(255, 255, 255, 255));
}

fn draw_equal_mark(pixmap: &mut Pixmap, cx: f32, cy: f32, r: f32) {
    let w = r * 1.0;
    let h = r * 0.22;
    fill_rect(pixmap, cx - w / 2.0, cy - r * 0.25, w, h, Color::from_rgba8(255, 255, 255, 255));
    fill_rect(pixmap, cx - w / 2.0, cy + r * 0.08, w, h, Color::from_rgba8(255, 255, 255, 255));
}

fn draw_glyph_mark(pixmap: &mut Pixmap, font: &FontArc, text: &str, cx: f32, cy: f32, r: f32, scale: f32) {
    let px = r * scale;
    draw_centered_text_at(pixmap, font, text, px, cx, cy + r * 0.04, (255, 255, 255, 255));
}

fn draw_inner_highlight(pixmap: &mut Pixmap, size: u32) {
    let s = size as f32;
    let path = rounded_rect_path(s * 0.055, s * 0.055, s * 0.89, s * 0.89, s * 0.15);
    let mut paint = Paint::default();
    paint.set_color_rgba8(255, 255, 255, 54);
    let stroke = Stroke { width: s * 0.018, ..Stroke::default() };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

fn draw_centered_text(pixmap: &mut Pixmap, font: &FontArc, text: &str, px: f32, y_fraction: f32, rgba: (u8, u8, u8, u8)) {
    let cx = pixmap.width() as f32 / 2.0;
    let cy = pixmap.height() as f32 * y_fraction;
    draw_centered_text_at(pixmap, font, text, px, cx, cy, rgba);
}

fn draw_centered_text_at(pixmap: &mut Pixmap, font: &FontArc, text: &str, px: f32, cx: f32, cy: f32, rgba: (u8, u8, u8, u8)) {
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
        data[idx + i] = ((*src as f32 * a) + dst * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
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
    let Some(rect) = Rect::from_xywh(x, y, w, h) else { return; };
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
    pb.cubic_to(x + w, y + h - r + r * k, x + w - r + r * k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - r * k, y + h, x, y + h - r + r * k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - r * k, x + r - r * k, y, x + r, y);
    pb.close();
    pb.finish().unwrap()
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

fn parse_hex(hex: &str) -> Result<(u8, u8, u8), Box<dyn Error>> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 { return Err("expected #RRGGBB".into()); }
    Ok((
        u8::from_str_radix(&h[0..2], 16)?,
        u8::from_str_radix(&h[2..4], 16)?,
        u8::from_str_radix(&h[4..6], 16)?,
    ))
}

fn rgba(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color::from_rgba8(r, g, b, a)
}

fn relative_luminance(rgb: (u8, u8, u8)) -> f32 {
    fn channel(v: u8) -> f32 {
        let c = v as f32 / 255.0;
        if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    }
    0.2126 * channel(rgb.0) + 0.7152 * channel(rgb.1) + 0.0722 * channel(rgb.2)
}


