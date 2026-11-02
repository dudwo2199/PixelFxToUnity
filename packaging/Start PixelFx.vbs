Option Explicit

Dim fso, shell, root, nodePath, serverPath, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(root, "runtime\node.exe")
serverPath = fso.BuildPath(root, "server.cjs")

If Not fso.FileExists(nodePath) Or Not fso.FileExists(serverPath) Then
  MsgBox "실행 파일 구성이 올바르지 않습니다. 압축 파일을 모두 푼 뒤 다시 실행해 주세요.", vbCritical, "PixelFx → Unity"
  WScript.Quit 1
End If

command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & serverPath & Chr(34)
shell.Run command, 0, False
