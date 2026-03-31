$b = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
foreach ($s in @('16','48','128')) {
    $path = Join-Path $PSScriptRoot "icon$s.png"
    [IO.File]::WriteAllBytes($path, $b)
    Write-Output "Created $path"
}
