param([string]$OutputDir = (Join-Path $PSScriptRoot '..\branding'))

# Builds branding/icon.svg and icon.png from one geometry (viewBox 512x512).
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$shapes = [Collections.Generic.List[object]]::new()
function Shape([object[]]$commands) { $shapes.Add($commands) }
function Polygon([double[]]$points) {
  $commands = [Collections.Generic.List[object]]::new()
  $commands.Add(@('M', $points[0], $points[1]))
  for ($i=2; $i -lt $points.Count; $i+=2) { $commands.Add(@('L', $points[$i], $points[$i+1])) }
  $commands.Add(@('Z'))
  Shape $commands.ToArray()
}

function ArcCommands([double]$radius, [double]$start, [double]$end, [bool]$move) {
  $a=$start*[Math]::PI/180; $b=$end*[Math]::PI/180
  $k=4/3*[Math]::Tan(($b-$a)/4)
  $x1=256+$radius*[Math]::Cos($a); $y1=256+$radius*[Math]::Sin($a)
  $x2=256+$radius*[Math]::Cos($b); $y2=256+$radius*[Math]::Sin($b)
  if ($move) { ,@('M',$x1,$y1) } else { ,@('L',$x1,$y1) }
  ,@('C',($x1-$k*$radius*[Math]::Sin($a)),($y1+$k*$radius*[Math]::Cos($a)),($x2+$k*$radius*[Math]::Sin($b)),($y2-$k*$radius*[Math]::Cos($b)),$x2,$y2)
}

for ($i=0; $i -lt 8; $i++) {
  $start=$i*45+5; $end=($i+1)*45-5
  $commands=@(ArcCommands 201 $start $end $true)
  $commands+=@(ArcCommands 177 $end $start $false)
  $commands+=,@('Z')
  Shape $commands
}
Polygon @(256,24, 268,48, 256,72, 244,48)
Polygon @(256,440, 268,464, 256,488, 244,464)
Polygon @(24,256, 48,244, 72,256, 48,268)
Polygon @(440,256, 464,244, 488,256, 464,268)

Shape @(
  @('M',260,73),
  @('C',280,116,267,137,253,157),
  @('C',231,184,249,202,281,219),
  @('C',297,195,266,169,293,140),
  @('C',285,175,328,191,338,222),
  @('C',349,248,344,267,338,280),
  @('L',256,231), @('L',153,290), @('L',153,371),
  @('C',109,343,111,300,137,263),
  @('C',134,280,137,287,142,294),
  @('C',147,259,164,236,189,216),
  @('C',176,243,184,263,191,269),
  @('C',216,249,205,226,209,202),
  @('C',202,155,242,139,260,73), @('Z')
)
Shape @(
  @('M',361,251), @('C',390,292,388,342,357,372),
  @('L',357,291), @('C',366,280,367,266,361,251), @('Z')
)

# Each d20 face is inset towards its centre, leaving transparent seams in both PNG and SVG.
$a=@(256,241); $b=@(344,291); $c=@(344,375); $d=@(256,426)
$e=@(168,375); $f=@(168,291); $p=@(207,353); $q=@(305,353)
$faces=@(@($a,$f,$p),@($a,$b,$q),@($f,$e,$p),@($e,$d,$p),@($p,$d,$q),@($b,$c,$q),@($c,$d,$q),@($a,$p,$q))
foreach ($face in $faces) {
  $cx=($face[0][0]+$face[1][0]+$face[2][0])/3
  $cy=($face[0][1]+$face[1][1]+$face[2][1])/3
  $points=[Collections.Generic.List[double]]::new()
  foreach ($vertex in $face) {
    $points.Add($cx+($vertex[0]-$cx)*0.94)
    $points.Add($cy+($vertex[1]-$cy)*0.94)
  }
  Polygon $points.ToArray()
}

[IO.Directory]::CreateDirectory($OutputDir) | Out-Null
$svg=[Text.StringBuilder]::new()
[void]$svg.AppendLine('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024" fill="#edc57d">')
[void]$svg.AppendLine('  <title>Очаг — монохромная печать</title>')
$bitmap=[Drawing.Bitmap]::new(1024,1024,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([Drawing.Color]::Transparent)
$graphics.SmoothingMode='AntiAlias'; $graphics.PixelOffsetMode='HighQuality'
$graphics.ScaleTransform(2,2)
$brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#edc57d'))
$culture=[Globalization.CultureInfo]::InvariantCulture
foreach ($commands in $shapes) {
  $path=[Drawing.Drawing2D.GraphicsPath]::new()
  $text=[Collections.Generic.List[string]]::new()
  $x=0; $y=0
  foreach ($command in $commands) {
    $op=[string]$command[0]
    $values=@($command | Select-Object -Skip 1 | ForEach-Object { ([double]$_).ToString('0.###',$culture) })
    $text.Add($op+($values -join ' '))
    switch ($op) {
      'M' { $path.StartFigure(); $x=$command[1]; $y=$command[2] }
      'L' { $path.AddLine([single]$x,[single]$y,[single]$command[1],[single]$command[2]); $x=$command[1]; $y=$command[2] }
      'C' { $path.AddBezier([single]$x,[single]$y,[single]$command[1],[single]$command[2],[single]$command[3],[single]$command[4],[single]$command[5],[single]$command[6]); $x=$command[5]; $y=$command[6] }
      'Z' { $path.CloseFigure() }
    }
  }
  [void]$svg.AppendLine('  <path d="'+($text -join ' ')+'"/>')
  $graphics.FillPath($brush,$path)
  $path.Dispose()
}
[void]$svg.AppendLine('</svg>')
[IO.File]::WriteAllText((Join-Path $OutputDir 'icon.svg'),$svg.ToString(),[Text.UTF8Encoding]::new($false))
# GDI+ rounds RGB on semi-transparent edges: keep the antialiasing in alpha, force one colour on every visible pixel.
for ($y=0; $y -lt $bitmap.Height; $y++) {
  for ($x=0; $x -lt $bitmap.Width; $x++) {
    $pixel=$bitmap.GetPixel($x,$y)
    if ($pixel.A -gt 0) { $bitmap.SetPixel($x,$y,[Drawing.Color]::FromArgb($pixel.A,237,197,125)) }
  }
}
$bitmap.Save((Join-Path $OutputDir 'icon.png'),[Drawing.Imaging.ImageFormat]::Png)
$brush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
Write-Host 'Built branding/icon.svg and branding/icon.png (1024x1024, transparent monochrome)'
