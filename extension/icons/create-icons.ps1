Add-Type -AssemblyName System.Drawing

foreach ($s in @(16, 48, 128)) {
    $path = Join-Path $PSScriptRoot "icon$s.png"
    $bitmap = New-Object System.Drawing.Bitmap(
        $s,
        $s,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::FromArgb(37, 99, 235))

    $stroke = [Math]::Max(1, [int]($s / 8))
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $stroke)
    $circleInset = [int]($s * 0.22)
    $circleSize = [int]($s * 0.43)
    $graphics.DrawEllipse($pen, $circleInset, $circleInset, $circleSize, $circleSize)
    $graphics.DrawLine(
        $pen,
        [int]($s * 0.57),
        [int]($s * 0.57),
        [int]($s * 0.80),
        [int]($s * 0.80)
    )

    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    Write-Output "Created $path ($s x $s)"
}
