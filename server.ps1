# Requires -Version 5.1
# Minimal local static file server for testing the site (index.html + gnw.js) with correct
# COOP/COEP headers, in case any future emulator core needs SharedArrayBuffer/WASM threads.

Clear-Host
$RootPath = $PSScriptRoot
$Port     = 8080
$Url      = "http://localhost:$Port/"

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Url)

try {
    $Listener.Start()
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " GW Local Dev Server Running! " -ForegroundColor Green
    Write-Host " Context URL: $Url" -ForegroundColor Cyan
    Write-Host " Serving directory: $RootPath" -ForegroundColor Gray
    Write-Host " Press [Ctrl + C] in this window to stop the server." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green

    while ($Listener.IsListening) {
        # Wait for the next request. GetContext() throws when the listener is being
        # stopped (Ctrl + C) -- treat that as "time to exit" and leave the loop.
        try { $Context = $Listener.GetContext() }
        catch { break }

        # Handle each request in its OWN try/catch/finally. If the browser drops the
        # connection mid-response (a cancelled fetch, a closed tab, navigating away),
        # OutputStream.Write throws "The I/O operation has been aborted ...". That is
        # harmless and expected -- we log it and keep serving instead of letting it
        # bubble up and shut the whole server down. The response is always closed in
        # the finally, so no connection is ever left dangling.
        try {
            $Request  = $Context.Request
            $Response = $Context.Response

            $SubPath = $Request.Url.LocalPath.TrimStart('/')
            if ([string]::IsNullOrEmpty($SubPath)) { $SubPath = "index.html" }

            $TargetFile = [System.IO.Path]::GetFullPath((Join-Path $RootPath $SubPath))

            if (-not $TargetFile.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $Response.StatusCode = 403
                Write-Host "[403] Forbidden (Traversal Blocked): /$SubPath" -ForegroundColor Red
            }
            elseif (Test-Path $TargetFile -PathType Leaf) {
                $Bytes = [System.IO.File]::ReadAllBytes($TargetFile)

                $Extension = [System.IO.Path]::GetExtension($TargetFile).ToLower()
                $ContentType = switch ($Extension) {
                    ".html" { "text/html; charset=utf-8" }
                    ".js"   { "application/javascript" }
                    ".css"  { "text/css" }
                    ".wasm" { "application/wasm" }
                    ".zip"  { "application/zip" }
                    ".svg"  { "image/svg+xml" }
                    ".json" { "application/json" }
                    ".png"  { "image/png" }
                    ".jpg"  { "image/jpeg" }
                    ".jpeg" { "image/jpeg" }
                    default { "application/octet-stream" }
                }

                $Response.ContentType = $ContentType
                $Response.ContentLength64 = $Bytes.Length

                $Response.AddHeader("Cross-Origin-Opener-Policy", "same-origin")
                $Response.AddHeader("Cross-Origin-Embedder-Policy", "require-corp")
                $Response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
                # This loop is single-threaded/synchronous and doesn't correctly service a
                # second request pipelined onto a kept-alive connection -- it just hangs
                # forever waiting on GetContext() for a "new" connection that never opens
                # while the browser sits on the old one. Forcing Connection: close makes
                # every request open a fresh socket, which this server can handle fine.
                $Response.KeepAlive = $false

                $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
                Write-Host "[200] ($ContentType) /$SubPath" -ForegroundColor Green
            }
            else {
                $Response.StatusCode = 404
                Write-Host "[404] Not Found: /$SubPath" -ForegroundColor Red
            }
        }
        catch {
            # Client aborted mid-response (or a transient socket error) -- benign.
            Write-Host ("[warn] request aborted: {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
        }
        finally {
            if ($null -ne $Context) { try { $Context.Response.Close() } catch { } }
        }
    }
}
catch {
    Write-Error $_.Exception.Message
}
finally {
    if ($null -ne $Listener) {
        $Listener.Stop()
        $Listener.Close()
        Write-Host "Server successfully halted." -ForegroundColor Yellow
    }
}
