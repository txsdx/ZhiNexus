# Send a real OS close request to the test-owned pinned window, independent of localized or WebView-updated captions.
param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$ApplicationProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CaptureOwnedWindowClose {
    private delegate bool EnumWindowProc(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr handle, int index);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
    /// Select exactly one visible topmost window in the supplied application process, then exercise its WM_CLOSE handler.
    public static void ClosePinned(uint applicationProcessId) {
        var matches = new List<IntPtr>();
        EnumWindows((handle, parameter) => {
            uint owner;
            GetWindowThreadProcessId(handle, out owner);
            if (owner == applicationProcessId && IsWindowVisible(handle) && (GetWindowLongPtr(handle, -20).ToInt64() & 0x8L) != 0) matches.Add(handle);
            return true;
        }, IntPtr.Zero);
        if (matches.Count != 1) throw new InvalidOperationException("Expected exactly one visible pinned application window, found " + matches.Count);
        if (!PostMessage(matches[0], 0x10, IntPtr.Zero, IntPtr.Zero)) throw new InvalidOperationException("WM_CLOSE failed");
    }
}
'@
[CaptureOwnedWindowClose]::ClosePinned([uint32]$ApplicationProcessId)
