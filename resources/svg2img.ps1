$svgDir = "./svg"
$outDir = "./img"
$sizes = @(16, 32, 64)

# Ensure output directory exists
if (!(Test-Path -Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

# Check for Inkscape
if (-not (Get-Command "inkscape" -ErrorAction SilentlyContinue)) {
    Write-Error "Inkscape CLI is not installed or not in PATH. Please install it from https://inkscape.org/"
    exit 1
}

# Process SVGs
Get-ChildItem -Path $svgDir -Filter *.svg | ForEach-Object {
    $svgPath = $_.FullName
    $baseName = $_.BaseName

    foreach ($size in $sizes) {
        $outFile = Join-Path $outDir "$baseName-$size.png"
        Write-Host "Converting $($_.Name) to $outFile ($size x $size)..."
        & inkscape "$svgPath" --export-type=png --export-filename="$outFile" --export-width=$size --export-height=$size
    }
}

Write-Host "Conversion complete."
