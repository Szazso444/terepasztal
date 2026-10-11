$ErrorActionPreference = 'Stop'
$pocRoot = 'G:\DEV\Terepasztal\poc\rocket-original-v1'
node 'C:\Users\Zso\terepasztal\scratchpad\rocket-poc-package.mjs'
Copy-Item -LiteralPath 'C:\Users\Zso\terepasztal\scratchpad\rocket-poc-render.py' -Destination "$pocRoot\render-proof.py"
Copy-Item -LiteralPath 'C:\Users\Zso\terepasztal\scratchpad\rocket-poc-reconstruct.py' -Destination "$pocRoot\reconstruct-proof.py"
$pocDeadline = (Get-Date).AddMinutes(25)
while (-not (Test-Path -LiteralPath "$pocRoot\raw.glb")) {
    if ((Get-Date) -gt $pocDeadline) { throw 'Reconstruction wait timed out; no job was interrupted.' }
    if (Test-Path -LiteralPath "$pocRoot\history.json") {
        $pocHistory = Get-Content -LiteralPath "$pocRoot\history.json" -Raw | ConvertFrom-Json
        if ($pocHistory.status.status_str -eq 'error') { throw 'Reconstruction failed; see history.json.' }
    }
    Start-Sleep -Seconds 5
}
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' -b --factory-startup --python-exit-code 1 -P "$pocRoot\render-proof.py" *> "$pocRoot\render.log"
if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath "$pocRoot\render.log" -Tail 22; throw 'Headless proof render failed.' }
Get-Content -LiteralPath "$pocRoot\render.log" -Tail 5
