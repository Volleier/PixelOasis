$src = (Resolve-Path "$PSScriptRoot\..\PixelOasis").Path
$dst = "C:\Program Files\Adobe\Adobe Photoshop 2026\Plug-ins\PixelOasis"

Remove-Item -Path $dst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path $src -Destination $dst -Recurse -Force

Write-Host "Deploy complete: $dst"
