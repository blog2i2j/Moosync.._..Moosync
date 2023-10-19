$ErrorActionPreference = 'Stop';
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$url64 = 'https://github.com/Moosync/Moosync/releases/download/v10.1.2/Moosync-10.1.2-win-x64.exe'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  unzipLocation  = $toolsDir
  fileType       = 'exe'
  url64bit       = $url64

  softwareName   = 'Moosync*'

  checksum64     = '02f4eb018e92ea4aded9d5547a00f4a43a5cb66362b9c12f285c643434d56eb1'
  checksumType64 = 'sha256'

  validExitCodes = @(0, 3010, 1641)
  silentArgs     = '/S'
}

Install-ChocolateyPackage @packageArgs



















