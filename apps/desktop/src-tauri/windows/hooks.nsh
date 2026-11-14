; Electron builds of «Очаг» (electron-builder, appId local.ttrpg.tabletop) are registered under this id.
!ifndef OCHAG_ELECTRON_ID
  !define OCHAG_ELECTRON_ID "65e85578-dd30-50fc-9384-92836edd9685"
!endif
!define OCHAG_ELECTRON_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OCHAG_ELECTRON_ID}"

LangString ochagRemoveOld 1049 "Удаляю прежнюю версию «Очага»: $R0"
LangString ochagRemoveOld 1033 "Removing the previous version of Ochag: $R0"
LangString ochagOldForAll 1049 "Для всех пользователей компьютера установлена прежняя версия «Очага»: $R0.$\r$\n$\r$\nУдалить её сейчас? Windows спросит разрешение администратора. Кампании и настройки останутся."
LangString ochagOldForAll 1033 "An earlier version of Ochag is installed for all users of this computer: $R0.$\r$\n$\r$\nRemove it now? Windows will ask for administrator permission. Campaigns and settings stay."

; $R1 ← the uninstaller from «"<path>" /flags», or "" when the old version is not there.
!macro OCHAG_OLD_UNINSTALLER ROOT
  ReadRegStr $R0 ${ROOT} "Software\${OCHAG_ELECTRON_ID}" "InstallLocation"
  ReadRegStr $R1 ${ROOT} "${OCHAG_ELECTRON_UNINSTALL}" "UninstallString"
  ${If} $R0 == ""
    StrCpy $R1 ""
  ${ElseIf} $R1 != ""
    StrCpy $R1 $R1 "" 1
    ${StrLoc} $R2 $R1 '"' ">"
    StrCpy $R1 $R1 $R2
    ${IfNot} ${FileExists} "$R1"
      StrCpy $R1 ""
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2
  SetRegView 64

  ; This user's install: its shortcuts have the same names as the new ones, so its uninstaller must finish first.
  ; A copy runs, as electron-builder does on updates, so the original and its folder can go too.
  !insertmacro OCHAG_OLD_UNINSTALLER HKCU
  ${If} $R1 != ""
    DetailPrint "$(ochagRemoveOld)"
    InitPluginsDir
    CopyFiles /SILENT "$R1" "$PLUGINSDIR\ochag-old-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\ochag-old-uninstaller.exe" /currentuser /S /KEEP_APP_DATA _?=$R0'
    Delete "$PLUGINSDIR\ochag-old-uninstaller.exe"
    RMDir "$R0"
  ${EndIf}

  ; An install for all users needs an administrator: ask, and let Windows elevate its uninstaller. Its shortcuts are
  ; in the common folders, apart from the new ones, so there is nothing to wait for.
  !insertmacro OCHAG_OLD_UNINSTALLER HKLM
  ${If} $R1 != ""
    MessageBox MB_YESNO|MB_ICONQUESTION "$(ochagOldForAll)" /SD IDNO IDNO ochag_keep_old
      ExecShellWait "runas" "$R1" "/allusers /S /KEEP_APP_DATA"
    ochag_keep_old:
  ${EndIf}

  SetRegView lastused
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; The uninstaller's checkbox (windows/Russian.nsh, deleteAppData) clears Tauri's own folders, where «Очаг» keeps
; nothing: its campaigns, database, backups and settings live in the data folder of src/main.rs data_dir().
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$APPDATA\ttrpg-foundation"
  ${EndIf}
!macroend
