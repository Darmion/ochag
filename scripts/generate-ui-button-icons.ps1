param(
  [string]$SourceDir = (Join-Path $PSScriptRoot '..\assets\codex-made\ui\buttons'),
  [string]$PublicDir = (Join-Path $PSScriptRoot '..\apps\client\public\ui-icons')
)

# Pixel UI icons drawn on a 32x32 grid and scaled without smoothing, to match assets/sorted/ui/symbols.
Add-Type -AssemblyName System.Drawing

$colors = @{
  outline = [Drawing.Color]::FromArgb(255, 18, 12, 13)
  shadow = [Drawing.Color]::FromArgb(255, 63, 35, 30)
  brass = [Drawing.Color]::FromArgb(255, 195, 119, 43)
  gold = [Drawing.Color]::FromArgb(255, 238, 183, 78)
  light = [Drawing.Color]::FromArgb(255, 255, 239, 167)
  steel = [Drawing.Color]::FromArgb(255, 180, 196, 203)
  steelDark = [Drawing.Color]::FromArgb(255, 83, 98, 109)
  red = [Drawing.Color]::FromArgb(255, 198, 45, 55)
  redDark = [Drawing.Color]::FromArgb(255, 103, 27, 39)
  violet = [Drawing.Color]::FromArgb(255, 133, 77, 177)
  blue = [Drawing.Color]::FromArgb(255, 64, 133, 185)
  cyan = [Drawing.Color]::FromArgb(255, 118, 212, 219)
  green = [Drawing.Color]::FromArgb(255, 70, 145, 85)
  stone = [Drawing.Color]::FromArgb(255, 138, 129, 118)
  stoneDark = [Drawing.Color]::FromArgb(255, 76, 70, 69)
}

function Brush([Drawing.Color]$color) { [Drawing.SolidBrush]::new($color) }
function Pen([Drawing.Color]$color, [int]$width = 1) { [Drawing.Pen]::new($color, $width) }
function Points([int[]]$values) {
  $result = [Drawing.Point[]]::new($values.Count / 2)
  for ($i = 0; $i -lt $values.Count; $i += 2) { $result[$i / 2] = [Drawing.Point]::new($values[$i], $values[$i + 1]) }
  $result
}
function Poly($g, [Drawing.Color]$fill, [int[]]$values) { $b = Brush $fill; $g.FillPolygon($b, (Points $values)); $b.Dispose() }
function Rect($g, [Drawing.Color]$fill, [int]$x, [int]$y, [int]$w, [int]$h) { $b = Brush $fill; $g.FillRectangle($b, $x, $y, $w, $h); $b.Dispose() }
function Ellipse($g, [Drawing.Color]$fill, [int]$x, [int]$y, [int]$w, [int]$h) { $b = Brush $fill; $g.FillEllipse($b, $x, $y, $w, $h); $b.Dispose() }
function StrokeEllipse($g, [Drawing.Color]$color, [int]$width, [int]$x, [int]$y, [int]$w, [int]$h) { $p = Pen $color $width; $g.DrawEllipse($p, $x, $y, $w, $h); $p.Dispose() }
function Line($g, [Drawing.Color]$color, [int]$width, [int]$x1, [int]$y1, [int]$x2, [int]$y2) { $p = Pen $color $width; $p.StartCap = 'Square'; $p.EndCap = 'Square'; $g.DrawLine($p, $x1, $y1, $x2, $y2); $p.Dispose() }

function Draw-Icon([string]$name, [scriptblock]$paint) {
  $small = [Drawing.Bitmap]::new(32, 32, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($small)
  $g.Clear([Drawing.Color]::Transparent)
  $g.SmoothingMode = 'None'; $g.InterpolationMode = 'NearestNeighbor'; $g.PixelOffsetMode = 'Half'
  & $paint $g
  $g.Dispose()

  $large = [Drawing.Bitmap]::new(128, 128, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $out = [Drawing.Graphics]::FromImage($large)
  $out.Clear([Drawing.Color]::Transparent)
  $out.SmoothingMode = 'None'; $out.InterpolationMode = 'NearestNeighbor'; $out.PixelOffsetMode = 'Half'
  $out.DrawImage($small, [Drawing.Rectangle]::new(0, 0, 128, 128), 0, 0, 32, 32, [Drawing.GraphicsUnit]::Pixel)
  $out.Dispose(); $small.Dispose()

  foreach ($dir in @($SourceDir, $PublicDir)) {
    [IO.Directory]::CreateDirectory($dir) | Out-Null
    $large.Save((Join-Path $dir "$name.png"), [Drawing.Imaging.ImageFormat]::Png)
  }
  $large.Dispose()
}

Draw-Icon ancestry { param($g)
  Line $g $colors.outline 4 9 5 23 27; Line $g $colors.outline 4 23 5 9 27
  Line $g $colors.cyan 2 9 5 23 27; Line $g $colors.violet 2 23 5 9 27
  foreach ($y in @(8, 13, 19, 24)) { Line $g $colors.outline 3 11 $y 21 $y; Line $g $colors.light 1 11 $y 21 $y }
}
Draw-Icon might { param($g)
  Poly $g $colors.outline @(7,15, 10,10, 13,11, 14,7, 18,7, 19,11, 23,12, 25,17, 23,24, 18,27, 11,25, 7,20)
  Poly $g $colors.brass @(9,16, 11,12, 14,13, 16,9, 17,13, 21,14, 23,17, 21,22, 17,25, 12,23, 9,19)
  Line $g $colors.light 2 11 15 15 17; Line $g $colors.shadow 2 15 17 21 15
}
Draw-Icon shield { param($g)
  Poly $g $colors.outline @(16,3, 27,7, 25,20, 21,26, 16,29, 11,26, 7,20, 5,7)
  Poly $g $colors.steelDark @(16,5, 24,8, 23,19, 19,24, 16,26, 13,24, 9,19, 8,9)
  Poly $g $colors.steel @(16,7, 21,9, 20,18, 16,23, 16,8)
  Line $g $colors.light 1 11 9 13 20
}
Draw-Icon blood-drop { param($g)
  Poly $g $colors.outline @(16,2, 24,14, 25,19, 23,25, 19,29, 13,29, 8,25, 6,20, 8,14)
  Poly $g $colors.red @(16,5, 22,15, 23,20, 20,25, 16,27, 12,25, 9,21, 10,15)
  Poly $g ([Drawing.Color]::FromArgb(255,245,93,105)) @(13,11, 11,17, 12,20, 14,18, 15,12)
}
Draw-Icon blinded { param($g)
  Poly $g $colors.outline @(3,16, 8,10, 15,7, 22,9, 29,16, 23,23, 16,25, 9,23)
  Poly $g $colors.steel @(6,16, 10,12, 16,10, 22,12, 26,16, 22,20, 16,22, 10,20)
  Ellipse $g $colors.outline 12 12 8 8; Ellipse $g $colors.blue 14 14 4 4
  Line $g $colors.outline 5 6 27 27 5; Line $g $colors.red 2 6 27 27 5
}
Draw-Icon deafened { param($g)
  StrokeEllipse $g $colors.outline 4 7 3 18 24; StrokeEllipse $g $colors.brass 2 7 3 18 24
  Line $g $colors.outline 4 16 9 20 12; Line $g $colors.light 2 16 9 20 12
  Line $g $colors.outline 4 20 12 15 18; Line $g $colors.light 2 20 12 15 18
  Line $g $colors.outline 4 15 18 15 25; Line $g $colors.light 2 15 18 15 25
}
Draw-Icon frightened { param($g)
  Poly $g $colors.outline @(16,2, 29,27, 3,27)
  Poly $g $colors.gold @(16,6, 25,25, 7,25)
  Rect $g $colors.shadow 14 11 4 8; Rect $g $colors.light 15 11 2 7; Rect $g $colors.outline 14 21 4 3
}
Draw-Icon incapacitated { param($g)
  Line $g $colors.outline 7 7 7 25 25; Line $g $colors.outline 7 25 7 7 25
  Line $g $colors.red 3 7 7 25 25; Line $g $colors.red 3 25 7 7 25
  Rect $g $colors.light 8 8 3 3; Rect $g $colors.light 21 8 3 3
}
Draw-Icon invisible { param($g)
  Poly $g $colors.outline @(3,16, 8,10, 15,7, 22,9, 29,16, 23,23, 16,25, 9,23)
  Poly $g $colors.steelDark @(6,16, 10,12, 16,10, 22,12, 26,16, 22,20, 16,22, 10,20)
  Ellipse $g $colors.cyan 13 13 6 6
  foreach ($x in @(7,12,17,22)) { Rect $g ([Drawing.Color]::FromArgb(150,18,12,13)) $x 7 2 18 }
}
Draw-Icon paralyzed { param($g)
  Poly $g $colors.outline @(18,2, 7,17, 14,17, 11,30, 26,12, 19,12)
  Poly $g $colors.gold @(17,6, 11,15, 17,15, 15,24, 22,14, 17,14)
  Rect $g $colors.light 16 8 2 6
}
Draw-Icon petrified { param($g)
  Poly $g $colors.outline @(8,4, 24,4, 28,10, 25,27, 7,27, 4,10)
  Poly $g $colors.stone @(9,7, 22,7, 25,11, 23,24, 9,24, 7,11)
  Line $g $colors.stoneDark 2 16 7 14 14; Line $g $colors.stoneDark 2 14 14 19 18; Line $g $colors.stoneDark 2 19 18 16 24
  Rect $g $colors.light 9 9 3 8
}
Draw-Icon poisoned { param($g)
  Ellipse $g $colors.outline 6 3 20 20; Rect $g $colors.outline 10 18 12 10
  Ellipse $g $colors.steel 8 5 16 16; Rect $g $colors.steel 12 18 8 7
  Ellipse $g $colors.outline 10 11 5 5; Ellipse $g $colors.outline 18 11 5 5
  Poly $g $colors.outline @(16,15, 13,20, 19,20); Rect $g $colors.outline 12 23 3 4; Rect $g $colors.outline 18 23 3 4
  Rect $g $colors.green 5 26 22 2
}
Draw-Icon prone { param($g)
  Ellipse $g $colors.brass 21 7 6 6
  Line $g $colors.outline 5 8 18 22 18; Line $g $colors.steel 2 8 18 22 18
  Line $g $colors.outline 5 14 18 8 24; Line $g $colors.steel 2 14 18 8 24
  Line $g $colors.outline 5 18 18 25 24; Line $g $colors.steel 2 18 18 25 24
  Rect $g $colors.red 4 27 24 2
}
Draw-Icon restrained { param($g)
  foreach ($offset in @(0,9,18)) {
    StrokeEllipse $g $colors.outline 4 (3+$offset) (10-($offset%2)) 11 14
    StrokeEllipse $g $colors.steel 2 (3+$offset) (10-($offset%2)) 11 14
  }
  Line $g $colors.light 1 8 12 10 20; Line $g $colors.light 1 17 12 19 20
}
Draw-Icon stunned { param($g)
  foreach ($star in @(@(16,4),@(7,12),@(24,13),@(16,23))) {
    $x=$star[0]; $y=$star[1]
    Poly $g $colors.outline @($x,($y-4),($x+2),($y-1),($x+5),$y,($x+2),($y+2),$x,($y+5),($x-2),($y+2),($x-5),$y,($x-2),($y-1))
    Rect $g $colors.gold ($x-1) ($y-2) 3 5
  }
  Ellipse $g $colors.steelDark 12 12 8 8
}
Draw-Icon unconscious { param($g)
  Ellipse $g $colors.outline 4 3 24 24; Ellipse $g $colors.blue 7 5 19 20; Ellipse $g ([Drawing.Color]::Transparent) 0 0 0 0
  Ellipse $g $colors.outline 11 2 17 18; Ellipse $g ([Drawing.Color]::FromArgb(0,0,0,0)) 0 0 0 0
  Poly $g $colors.outline @(20,4, 25,6, 28,10, 24,9, 22,6)
  Rect $g $colors.light 6 24 17 2
}
Draw-Icon rest-cup { param($g)
  Rect $g $colors.outline 6 10 18 16; Rect $g $colors.brass 8 12 14 12
  StrokeEllipse $g $colors.outline 4 20 12 9 10; StrokeEllipse $g $colors.gold 2 20 12 9 10
  Rect $g $colors.light 10 13 3 8; Rect $g $colors.outline 5 25 20 3
  Line $g $colors.cyan 2 11 8 11 4; Line $g $colors.cyan 2 16 8 16 3; Line $g $colors.cyan 2 21 8 21 5
}
Draw-Icon star-xp { param($g)
  Poly $g $colors.outline @(16,2, 20,11, 30,12, 22,19, 25,29, 16,24, 7,29, 10,19, 2,12, 12,11)
  Poly $g $colors.gold @(16,6, 19,13, 26,14, 20,18, 22,25, 16,21, 10,25, 12,18, 6,14, 13,13)
  Poly $g $colors.light @(16,8, 17,14, 21,15, 17,17, 16,21, 15,17, 11,15, 15,14)
}

Write-Host "UI icons written to $SourceDir and $PublicDir"
