#Requires -Version 5.1
<#
.SYNOPSIS
Sets up this Atlas RAN Twin checkout on Windows 11.
.DESCRIPTION
Installs missing Git, Node.js LTS and Python with WinGet, installs the checked-in
npm lockfile and Chromium, then runs the project validation gate. Compatible
tools already on PATH are reused. Run from any directory; no Make or WSL needed.
WinGet installers may display a Windows administrator (UAC) prompt.
.PARAMETER ProjectRoot
Existing checkout to set up. Defaults to the parent of this script's directory.
.PARAMETER InstallVSCode
Also install Visual Studio Code if its command is not available.
.PARAMETER InstallRayTracing
Also install uv and LLVM, set up Sionna-RT, and run its real worker smoke test.
.PARAMETER SkipToolInstall
Use existing tools only; fail if a required tool is missing or incompatible.
.PARAMETER SkipBrowserInstall
Skip downloading Playwright Chromium.
.PARAMETER SkipChecks
Skip the base validation gate. The ray-tracing smoke test still runs if selected.
.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
.EXAMPLE
.\scripts\setup-windows.ps1 -InstallVSCode -InstallRayTracing
#>
[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [switch]$InstallVSCode,
    [switch]$InstallRayTracing,
    [switch]$SkipToolInstall,
    [switch]$SkipBrowserInstall,
    [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# PowerShell 7 can turn native exit codes into errors before our diagnostics.
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Find-Application {
    param([string]$Name)
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit $LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

function Update-ProcessPath {
    # Retain custom process entries while picking up paths written by installers.
    $entries = @(
        $env:Path
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -join ';'
    $env:Path = (($entries -split ';' | Where-Object { $_ } | Select-Object -Unique) -join ';')
}

function Install-WinGetPackage {
    param([string]$Id)
    if ($SkipToolInstall) {
        throw "Required tool is missing or incompatible ($Id). Install it, or rerun without -SkipToolInstall."
    }
    $winget = Find-Application 'winget.exe'
    if (-not $winget) {
        throw 'WinGet is missing. Install or update App Installer from https://apps.microsoft.com/detail/9nblggh4nns1, reopen PowerShell, and rerun this script.'
    }
    Write-Step "Installing $Id with WinGet (an installer may request UAC approval)"
    Invoke-Checked $winget @('install', '--id', $Id, '--exact', '--source', 'winget',
        '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity')
    Update-ProcessPath
}

function Ensure-Application {
    param([string]$Name, [string]$PackageId)
    $application = Find-Application $Name
    if (-not $application) {
        Install-WinGetPackage $PackageId
        $application = Find-Application $Name
    }
    if (-not $application) {
        throw "$Name is still unavailable after installation. Reopen PowerShell, check PATH, and rerun the script."
    }
    return $application
}

function Test-NodeVersion {
    param([string]$NodePath)
    if (-not $NodePath) { return $false }
    $output = & $NodePath --version
    if ($LASTEXITCODE -ne 0) { return $false }
    $version = $null
    if (-not [Version]::TryParse(([string]$output).Trim().TrimStart('v'), [ref]$version)) {
        return $false
    }
    # Match package.json: ^22.12.0 || >=24.0.0.
    return (($version.Major -eq 22 -and $version -ge [Version]'22.12.0') -or $version.Major -ge 24)
}

function Find-ProjectPython {
    param([string]$NodePath)
    # Use the application's exact version/SQLite checks and interpreter overrides.
    # Single quotes in JavaScript also survive Windows PowerShell 5.1's legacy
    # native argument passing, which removes unescaped embedded double quotes.
    $probe = "import { findPython } from './scripts/runtime.mjs'; try { console.log(findPython()); } catch { process.exit(1); }"
    $output = & $NodePath --input-type=module -e $probe
    if ($LASTEXITCODE -eq 0 -and $output) { return ([string]$output).Trim() }
    return $null
}

function Find-LlvmDirectory {
    if ($env:DRJIT_LIBLLVM_PATH) {
        if (-not (Test-Path -LiteralPath $env:DRJIT_LIBLLVM_PATH -PathType Leaf)) {
            throw "DRJIT_LIBLLVM_PATH does not point to an LLVM DLL: $env:DRJIT_LIBLLVM_PATH"
        }
        return (Split-Path -Parent $env:DRJIT_LIBLLVM_PATH)
    }
    $directories = @($env:Path -split ';')
    if ($env:ProgramFiles) { $directories += Join-Path $env:ProgramFiles 'LLVM\bin' }
    foreach ($directory in $directories) {
        if ($directory -and (Test-Path -LiteralPath (Join-Path $directory 'LLVM-C.dll') -PathType Leaf)) {
            return $directory
        }
    }
    return $null
}

$locationPushed = $false
$originalConsoleEncoding = [Console]::OutputEncoding
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This setup script requires Windows 11. On macOS/Linux, use npm run setup.'
    }
    if (-not [Environment]::Is64BitProcess) {
        throw 'Open a 64-bit PowerShell terminal and rerun this script.'
    }
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $windows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    if ([int]$windows.CurrentBuildNumber -lt 22000) {
        throw 'This setup script requires Windows 11 (build 22000 or later).'
    }
    if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
    $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
    foreach ($file in @('package.json', 'package-lock.json', 'scripts\runtime.mjs', 'scripts\atlas.mjs', 'serve.py')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $file) -PathType Leaf)) {
            throw "Not an Atlas RAN Twin checkout: missing $file in $ProjectRoot."
        }
    }
    Push-Location -LiteralPath $ProjectRoot
    $locationPushed = $true
    Update-ProcessPath

    Write-Step 'Checking Git, Node.js and Python'
    $git = Ensure-Application 'git.exe' 'Git.Git'
    Invoke-Checked $git @('--version')
    $node = Find-Application 'node.exe'
    if (-not (Test-NodeVersion $node)) {
        Install-WinGetPackage 'OpenJS.NodeJS.LTS'
        $node = Find-Application 'node.exe'
    }
    if (-not (Test-NodeVersion $node)) {
        throw 'Node.js 22.12+ (22.x) or 24+ is required. An older node.exe may shadow the LTS installation on PATH; reopen PowerShell or correct PATH and rerun.'
    }
    Invoke-Checked $node @('--version')
    # npm.cmd avoids the execution-policy restriction on npm.ps1.
    $npm = Find-Application 'npm.cmd'
    if (-not $npm) { throw 'npm.cmd is missing. Repair the Node.js installation and reopen PowerShell.' }
    Invoke-Checked $npm @('--version')

    $python = Find-ProjectPython $node
    if (-not $python) {
        if ($env:ATLAS_PYTHON -or $env:PYTHON) {
            throw 'The ATLAS_PYTHON/PYTHON override cannot run Python 3.10+ with SQLite. Correct it to an executable path without arguments and rerun.'
        }
        Install-WinGetPackage 'Python.Python.3.13'
        $python = Find-ProjectPython $node
    }
    if (-not $python) {
        throw 'Python 3.10+ with SQLite is still unavailable. Reopen PowerShell or set ATLAS_PYTHON to the installed python.exe path and rerun.'
    }
    Invoke-Checked $python @('--version')
    Write-Host "Python interpreter: $python"

    if ($InstallVSCode) {
        $code = Ensure-Application 'code.cmd' 'Microsoft.VisualStudioCode'
        Invoke-Checked $code @('--version')
    }

    Write-Step 'Installing pinned frontend dependencies, including native platform bindings'
    Invoke-Checked $npm @('run', 'setup')

    if (-not $SkipBrowserInstall) {
        Write-Step 'Installing Playwright Chromium'
        Invoke-Checked $npm @('exec', '--no', '--', 'playwright', 'install', 'chromium')
    }

    if ($InstallRayTracing) {
        Write-Step 'Preparing the optional Sionna-RT CPU runtime'
        $uv = Ensure-Application 'uv.exe' 'astral-sh.uv'
        Invoke-Checked $uv @('--version')
        $llvmDirectory = Find-LlvmDirectory
        if (-not $llvmDirectory) {
            Install-WinGetPackage 'LLVM.LLVM'
            $llvmDirectory = Find-LlvmDirectory
        }
        if (-not $llvmDirectory) {
            throw 'LLVM-C.dll was not found. Add the installed LLVM bin directory to PATH or set DRJIT_LIBLLVM_PATH to its DLL, then rerun.'
        }
        # Persist only the required DLL search directory for future app launches.
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (@($userPath -split ';') -notcontains $llvmDirectory) {
            [Environment]::SetEnvironmentVariable('Path', (@($userPath, $llvmDirectory) |
                Where-Object { $_ }) -join ';', 'User')
        }
        Update-ProcessPath
        Invoke-Checked $npm @('run', 'rt:setup')
        Write-Step 'Verifying a real Sionna-RT worker job'
        Invoke-Checked $npm @('run', 'test:rt')
    }

    if (-not $SkipChecks) {
        Write-Step 'Running tests, TypeScript checks, production build and API integration checks'
        Invoke-Checked $npm @('run', 'check')
    }

    Write-Host "`nSetup completed: $ProjectRoot" -ForegroundColor Green
    if ($SkipChecks) { Write-Host 'Base validation was skipped; run npm.cmd run check when ready.' }
    Write-Host 'Start the app:       npm.cmd start'
    Write-Host 'Frontend development (two terminals): npm.cmd run api / npm.cmd run dev'
    if (-not $SkipBrowserInstall) { Write-Host 'Run browser tests:   npm.cmd run test:e2e' }
    Write-Host 'If a new terminal cannot find a newly installed tool, reopen it.'
}
catch {
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($locationPushed) { Pop-Location }
    [Console]::OutputEncoding = $originalConsoleEncoding
}
