Option Explicit

Dim fso, root, portPath, stream, port, request
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
portPath = fso.BuildPath(root, ".server-port")

If Not fso.FileExists(portPath) Then
  MsgBox "PixelFx server is not running.", vbInformation, "PixelFx to Unity"
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
  MsgBox "Could not connect to the server. It may already be stopped.", vbExclamation, "PixelFx to Unity"
Else
  MsgBox "PixelFx server stopped.", vbInformation, "PixelFx to Unity"
End If
On Error GoTo 0
