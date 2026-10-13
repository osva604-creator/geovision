param(
    [string]$Source = (Join-Path $PSScriptRoot '../docs/brand/source/geovision-brand-sheet.jfif')
)

# Extract each labeled panel from the supplied 2630 x 1600 contact sheet.
# Coordinates refer to its 2048 x 1246 preview; labels and frames are excluded.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class GeoVisionBrand {
    public static void Extract(Bitmap source, string output, int x, int y, int w, int h, int size, bool maskable) {
        var rect = new Rectangle((int)Math.Round(x * source.Width / 2048.0), (int)Math.Round(y * source.Height / 1246.0),
            (int)Math.Round(w * source.Width / 2048.0), (int)Math.Round(h * source.Height / 1246.0));
        using (var panel = source.Clone(rect, PixelFormat.Format32bppArgb)) {
            // Extend the maskable panel's green to a square without a rectangular seam.
            // Only flood-fill the outer background; the white badge protects the symbol.
            if (maskable) {
                var background = panel.GetPixel(10, 10);
                var pending = new Queue<Point>();
                var visited = new bool[panel.Width, panel.Height];
                pending.Enqueue(new Point(0, 0));
                while (pending.Count > 0) {
                    var p = pending.Dequeue();
                    if (p.X < 0 || p.Y < 0 || p.X >= panel.Width || p.Y >= panel.Height || visited[p.X, p.Y]) continue;
                    visited[p.X, p.Y] = true;
                    var c = panel.GetPixel(p.X, p.Y);
                    if (c.R > 60 || c.G < c.R + 25 || c.G < c.B + 20) continue;
                    panel.SetPixel(p.X, p.Y, background);
                    pending.Enqueue(new Point(p.X - 1, p.Y)); pending.Enqueue(new Point(p.X + 1, p.Y));
                    pending.Enqueue(new Point(p.X, p.Y - 1)); pending.Enqueue(new Point(p.X, p.Y + 1));
                }
            }
            int left = panel.Width, top = panel.Height, right = 0, bottom = 0;
            for (int py = 0; py < panel.Height; py++) for (int px = 0; px < panel.Width; px++) {
                var c = panel.GetPixel(px, py);
                int max = Math.Max(c.R, Math.Max(c.G, c.B)), min = Math.Min(c.R, Math.Min(c.G, c.B));
                bool artwork = maskable ? min > 220 : max - min > 35 || max < 100;
                if (artwork) { left = Math.Min(left, px); top = Math.Min(top, py); right = Math.Max(right, px); bottom = Math.Max(bottom, py); }
            }
            // Keep antialiasing surrounding the artwork / white maskable badge.
            left = Math.Max(0, left - 3); top = Math.Max(0, top - 3);
            right = Math.Min(panel.Width - 1, right + 3); bottom = Math.Min(panel.Height - 1, bottom + 3);
            var bounds = new Rectangle(left, top, right - left + 1, bottom - top + 1);
            int width = size > 0 ? size : bounds.Width + 40;
            int height = size > 0 ? size : bounds.Height + 40;
            using (var result = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(result)) {
                g.Clear(maskable ? panel.GetPixel(10, 10) : Color.White);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                double scale = size > 0 ? size * (maskable ? 0.70 : 0.88) / Math.Max(bounds.Width, bounds.Height) : 1;
                int dw = (int)Math.Round(bounds.Width * scale), dh = (int)Math.Round(bounds.Height * scale);
                g.DrawImage(panel, new Rectangle((width - dw) / 2, (height - dh) / 2, dw, dh), bounds, GraphicsUnit.Pixel);
                result.Save(output, ImageFormat.Png);
            }
        }
    }
}
'@

$brandRoot = Join-Path $PSScriptRoot '../assets/brand'
New-Item -ItemType Directory -Force -Path (Join-Path $brandRoot 'logos'), (Join-Path $brandRoot 'icons') | Out-Null
$sheet = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Source))
try {
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'logos/geovision-logo.png'), 108, 110, 568, 418, 0, $false)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/geovision-icon-512.png'), 775, 110, 540, 418, 512, $false)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/geovision-icon-maskable-512.png'), 1432, 112, 548, 420, 512, $true)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/geovision-icon-192.png'), 237, 795, 309, 291, 192, $false)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/apple-touch-icon.png'), 237, 795, 309, 291, 180, $false)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/geovision-icon-48.png'), 978, 897, 142, 138, 48, $false)
    [GeoVisionBrand]::Extract($sheet, (Join-Path $brandRoot 'icons/favicon.png'), 1656, 949, 87, 87, 32, $false)
} finally { $sheet.Dispose() }
Get-ChildItem -Path (Join-Path $brandRoot '*/*.png') | Select-Object Name, Length
