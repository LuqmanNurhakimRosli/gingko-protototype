# Export the poster with PowerPoint: a print-ready PDF and a preview PNG (poster/preview.png).
#   powershell -ExecutionPolicy Bypass -File poster/export.ps1
# The first slide export after opening uses fallback fonts, so a throwaway export runs first.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $dir 'GINKGO poster for URBIEE26.pptx'
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open($src, $true, $false, $false)
  $slide = $pres.Slides.Item(1)
  $slide.Export((Join-Path $dir 'preview.png'), 'PNG', 400, 566)
  $slide.Export((Join-Path $dir 'preview.png'), 'PNG', 1500, 2125)
  $pres.SaveAs((Join-Path $dir 'GINKGO poster for URBIEE26.pdf'), 32)  # ppSaveAsPDF
  $pres.Close()
} finally { $ppt.Quit() }
