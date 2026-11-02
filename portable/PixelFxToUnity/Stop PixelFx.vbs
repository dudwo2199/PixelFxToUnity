Option Explicit

Dim fso, root, portPath, stream, port, request
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
portPath = fso.BuildPath(root, ".server-port")

If Not fso.FileExists(portPath) Then
  MsgBox "실행 중인 PixelFx 서버를 찾지 못했습니다.", vbInformation, "PixelFx → Unity"
  WScript.Quit 0
End If

Set stream = fso.OpenTextFile(portPath, 1, False)
port = Trim(stream.ReadAll)
stream.Close

On Error Resume Next
Set request = CreateObject("MSXML2.XMLHTTP")
request.Open "POST", "http://127.0.0.1:" & port & "/__shutdown", False
request.Send
If Err.Number <> 0 Then
  MsgBox "서버에 연결하지 못했습니다. 앱이 이미 종료되었을 수 있습니다.", vbExclamation, "PixelFx → Unity"
Else
  MsgBox "PixelFx 서버를 종료했습니다.", vbInformation, "PixelFx → Unity"
End If
On Error GoTo 0
