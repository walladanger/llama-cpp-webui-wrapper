Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

Name "llama.cpp Router"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\llama.cpp Router"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "llama.cpp Router Setup"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "llama.cpp Router Windows x64 Installer"
VIAddVersionKey "LegalCopyright" "llama.cpp Router contributors"
Icon "..\icons\icon.ico"
UninstallIcon "..\icons\icon.ico"
BrandingText "llama.cpp Router ${VERSION}"

Var ValidationMode
Var Parameters

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\llama-webui.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open llama.cpp Router"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This installer requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  StrCpy $ValidationMode "0"
  ${GetParameters} $Parameters
  ClearErrors
  ${GetOptions} $Parameters "/VALIDATE" $0
  ${IfNot} ${Errors}
    StrCpy $ValidationMode "1"
  ${Else}
    ReadRegStr $0 HKCU "Software\llama.cpp Router" "InstallDir"
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
  ${If} $ValidationMode != "1"
    close_app:
    FindWindow $0 "" "llama.cpp"
    ${If} $0 != 0
      IfSilent app_running
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Close llama.cpp Router, then click OK to continue Setup." IDOK close_app
      Abort
      app_running:
      SetErrorLevel 170
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Function EnsureWebView2
  ; Prefer the existing runtime. Download Microsoft's evergreen bootstrapper
  ; only on machines without WebView2; no developer tools are needed.
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 != ""
    ${AndIf} $0 != "0.0.0.0"
    Return
  ${EndIf}
  DetailPrint "Installing Microsoft Edge WebView2 Runtime..."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$ErrorActionPreference='Stop'; $$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile (Join-Path $$env:TEMP 'Router-WebView2-Setup.exe')"`
  Pop $0
  Pop $1
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP "WebView2 could not be downloaded. Connect to the internet and run Setup again."
    Abort
  ${EndIf}
  ExecWait '"$TEMP\Router-WebView2-Setup.exe" /silent /install' $0
  Delete "$TEMP\Router-WebView2-Setup.exe"
  ${If} $0 != 0
    ${AndIf} $0 != 3010
    MessageBox MB_ICONSTOP "WebView2 installation failed (code $0). Run Setup again after Windows finishes pending updates."
    Abort
  ${EndIf}
FunctionEnd

Section "llama.cpp Router" SEC_ROUTER
  SectionIn RO
  ${If} $ValidationMode != "1"
    Call EnsureWebView2
  ${EndIf}
  ; File lists are generated from a clean, allowlisted staging directory.
  ; Config defaults are copied only when missing. User models/cache/logs and
  ; existing configuration files are never installer-owned resources.
  SetOverwrite on
  !include "${MANIFEST}\install-files.nsh"
  CreateDirectory "$INSTDIR\portable-data\models"
  CreateDirectory "$INSTDIR\portable-data\cache"
  CreateDirectory "$INSTDIR\portable-data\logs"
  CreateDirectory "$INSTDIR\portable-data\config"
  SetOverwrite off
  SetOutPath "$INSTDIR\portable-data\config"
  File /oname=llama-server.json "..\llama-server.default.json"
  File /oname=vllm.json "..\vllm.default.json"
  File /oname=trtllm.json "..\trtllm.default.json"
  SetOverwrite on
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} $ValidationMode != "1"
    CreateDirectory "$SMPROGRAMS\llama.cpp Router"
    CreateShortcut "$SMPROGRAMS\llama.cpp Router\llama.cpp Router.lnk" "$INSTDIR\llama-webui.exe" "" "$INSTDIR\llama-webui.exe"
    CreateShortcut "$SMPROGRAMS\llama.cpp Router\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortcut "$DESKTOP\llama.cpp Router.lnk" "$INSTDIR\llama-webui.exe" "" "$INSTDIR\llama-webui.exe"
    WriteRegStr HKCU "Software\llama.cpp Router" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "DisplayName" "llama.cpp Router"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "Publisher" "llama.cpp Router contributors"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "DisplayIcon" "$INSTDIR\llama-webui.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "NoRepair" 1
  ${EndIf}
SectionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext current
  StrCpy $ValidationMode "0"
  ${GetParameters} $Parameters
  ClearErrors
  ${GetOptions} $Parameters "/VALIDATE" $0
  ${IfNot} ${Errors}
    StrCpy $ValidationMode "1"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  !include "${MANIFEST}\uninstall-files.nsh"
  ${If} $ValidationMode != "1"
    Delete "$DESKTOP\llama.cpp Router.lnk"
    Delete "$SMPROGRAMS\llama.cpp Router\llama.cpp Router.lnk"
    Delete "$SMPROGRAMS\llama.cpp Router\Uninstall.lnk"
    RMDir "$SMPROGRAMS\llama.cpp Router"
    DeleteRegKey HKCU "Software\llama.cpp Router"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router"
  ${EndIf}
  Delete "$INSTDIR\Uninstall.exe"
  ; Deliberately non-recursive: user models, cache, logs and config survive.
  RMDir "$INSTDIR"
SectionEnd
