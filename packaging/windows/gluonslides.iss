; Windows installer (Inno Setup 6). Built by packaging/build.py --package
; from dist/GluonSlides/, with /DAppVersion=<version>.
;
; Installs for the current user (no administrator rights needed): the app
; in %LOCALAPPDATA%\Programs\GluonSlides, a Start-menu entry, an optional
; desktop shortcut, .gl files opening in GluonSlides (optional, on by
; default), and an entry in Settings -> Apps to uninstall it.
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
ChangesAssociations=yes
LicenseFile={#Root}\LICENSE

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "glfiles"; Description: "Open .gl project files with GluonSlides (double-click)"; GroupDescription: "File types:"

[Registry]
; Per user (HKA = HKCU here); removed on uninstall.
Root: HKA; Subkey: "Software\Classes\.gl"; ValueType: string; ValueName: ""; ValueData: "GluonSlides.Project"; Flags: uninsdeletevalue; Tasks: glfiles
Root: HKA; Subkey: "Software\Classes\.gl\OpenWithProgids"; ValueType: string; ValueName: "GluonSlides.Project"; ValueData: ""; Flags: uninsdeletevalue; Tasks: glfiles
Root: HKA; Subkey: "Software\Classes\GluonSlides.Project"; ValueType: string; ValueName: ""; ValueData: "GluonSlides project"; Flags: uninsdeletekey; Tasks: glfiles
Root: HKA; Subkey: "Software\Classes\GluonSlides.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\GluonSlides.exe,0"; Tasks: glfiles
Root: HKA; Subkey: "Software\Classes\GluonSlides.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\GluonSlides.exe"" ""%1"""; Tasks: glfiles

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
