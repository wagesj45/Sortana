$svgDir = "./svg"
$outDir = "./img"
$sizes = @(16, 32, 64)
$themes = @{
    "light" = "#000000"
    "dark"  = "#ffffff"
}
$tempSvg = "temp.svg"

# Ensure output directory exists
if (!(Test-Path -Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

# Check for Inkscape
if (-not (Get-Command "inkscape" -ErrorAction SilentlyContinue)) {
    Write-Error "Inkscape CLI is not installed or not in PATH. Please install it from https://inkscape.org/"
    exit 1
}

# Helper: inject color into <svg> tag
function Inject-Color {
    param ($original, $color)
    $content = Get-Content $original -Raw

    if ($content -match '<svg[^>]*>') {
        # Inject color style
        $patched = $content -replace '<svg([^>]*?)>', "<svg`$1 style=`"color: $color`">"
        Set-Content -Path $tempSvg -Value $patched
    }
    else {
        throw "Couldn't find <svg> tag to patch."
    }
}

# Process each SVG file
Get-ChildItem -Path $svgDir -Filter *.svg | ForEach-Object {
    $svgPath = $_.FullName
    $baseName = $_.BaseName

    foreach ($theme in $themes.Keys) {
        $color = $themes[$theme]

        # Create themed temp SVG
        Inject-Color $svgPath $color

        foreach ($size in $sizes) {
            $outFile = Join-Path $outDir "$baseName-$theme-$size.png"
            Write-Host "Exporting $outFile (color $color)..."
            & inkscape $tempSvg `
                --export-type=png `
                --export-filename="$outFile" `
                --export-width=$size `
                --export-height=$size `
                --actions="export-do"
        }
    }

    # Cleanup
    if (Test-Path $tempSvg) {
        Remove-Item $tempSvg -Force
    }
}

Write-Host "Done generating light/dark themed PNGs."
