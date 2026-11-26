; Windows installer (Inno Setup 6). Built by packaging/build.py --package
; from dist/GluonSlides/, with /DAppVersion=<version>.
;
; Installs for the current user (no administrator rights needed): the app
; in %LOCALAPPDATA%\Programs\GluonSlides, a Start-menu entry, an optional
; desktop shortcut, and an entry in Settings -> Apps to uninstall it.
; Recent projects and settings (in %LOCALAPPDATA%\gluonslides) are kept.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define Root "..\.."

[Setup]
; Never change AppId: Windows uses it to recognise updates of the same app.
AppId={{E4185A42-0CD0-4A71-A274-D8EB7AEDF98B}
AppName=GluonSlides
AppVersion={#AppVersion}
AppPublisher=GluonSlides
AppPublisherURL=https://github.com/agussomacal/GluonSlides
DefaultDirName={autopf}\GluonSlides
DefaultGroupName=GluonSlides
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#Root}\dist
OutputBaseFilename=GluonSlides-{#AppVersion}-windows-x64-setup
#if FileExists(Root + "\packaging\generated\icon.ico")
SetupIconFile={#Root}\packaging\generated\icon.ico
#endif
UninstallDisplayIcon={app}\GluonSlides.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile={#Root}\LICENSE

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#Root}\dist\GluonSlides\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; An update replaces the bundled files completely.
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\GluonSlides"; Filename: "{app}\GluonSlides.exe"
Name: "{autodesktop}\GluonSlides"; Filename: "{app}\GluonSlides.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\GluonSlides.exe"; Description: "{cm:LaunchProgram,GluonSlides}"; Flags: nowait postinstall skipifsilent
