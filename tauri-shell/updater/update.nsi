Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
Name "llama.cpp Router Update"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\llama.cpp Router"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "llama.cpp Router Update"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "llama.cpp Router Update for existing installations"
VIAddVersionKey "LegalCopyright" "llama.cpp Router contributors"
Icon "..\icons\icon.ico"
UninstallIcon "..\icons\icon.ico"
BrandingText "llama.cpp Router ${VERSION}"
Var ValidationMode
Var Parameters
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This updates your existing llama.cpp Router installation with automatic TensorRT-LLM setup and improved hover help.$\r$\n$\r$\nYour models, settings, cache, logs, and bundled CUDA runtime are kept.$\r$\n$\r$\nClose Router before continuing."
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
    close_app:
    FindWindow $0 "" "llama.cpp"
    ${If} $0 != 0
      IfSilent app_running
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Close llama.cpp Router, then click OK to continue." IDOK close_app
      Abort
      app_running:
      SetErrorLevel 170
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd
Section "Update Router"
  IfFileExists "$INSTDIR\llama-webui.exe" 0 missing_app
  IfFileExists "$INSTDIR\portable-data\bin\llama-server.exe" 0 missing_app
  Goto apply_update
  missing_app:
  IfSilent missing_silent
  MessageBox MB_ICONSTOP "Choose your existing llama.cpp Router folder. This updater requires an installed copy of Router."
  missing_silent:
  SetErrorLevel 2
  Abort
  apply_update:
  SetOverwrite on
  !include "${MANIFEST}\install-files.nsh"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} $ValidationMode != "1"
    WriteRegStr HKCU "Software\llama.cpp Router" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\llama.cpp Router" "DisplayVersion" "${VERSION}"
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
