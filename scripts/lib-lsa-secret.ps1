# LSA private-data helper — shared by kiosk-launch-install.ps1 and
# kiosk-launch-uninstall.ps1. Lets Windows autologon read the kiosk account's
# password from the LSA secret store instead of a plaintext registry value
# (HKLM:\...\Winlogon\DefaultPassword), which any local admin can read at a
# glance. Functionally identical autologon behavior either way — this just
# avoids leaving the password sitting in the open.
#
# Pass $null/empty to SetSecret to clear a previously stored secret.

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class LsaSecret {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint LsaOpenPolicy(ref LSA_UNICODE_STRING SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern uint LsaStorePrivateData(IntPtr PolicyHandle, ref LSA_UNICODE_STRING KeyName, ref LSA_UNICODE_STRING PrivateData);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint LsaClose(IntPtr PolicyHandle);

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public int Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    private static LSA_UNICODE_STRING InitLsaString(string s) {
        var lus = new LSA_UNICODE_STRING();
        if (string.IsNullOrEmpty(s)) {
            lus.Buffer = IntPtr.Zero;
            lus.Length = 0;
            lus.MaximumLength = 0;
        } else {
            lus.Buffer = Marshal.StringToHGlobalUni(s);
            lus.Length = (ushort)(s.Length * 2);
            lus.MaximumLength = (ushort)((s.Length + 1) * 2);
        }
        return lus;
    }

    public static void SetSecret(string key, string value) {
        var oa = new LSA_OBJECT_ATTRIBUTES();
        var system = new LSA_UNICODE_STRING();
        IntPtr policyHandle;

        uint result = LsaOpenPolicy(ref system, ref oa, 0x02000000 /* MAXIMUM_ALLOWED */, out policyHandle);
        if (result != 0) throw new Exception("LsaOpenPolicy failed with code " + result);

        var secretName = InitLsaString(key);
        var secretData = InitLsaString(value);

        result = LsaStorePrivateData(policyHandle, ref secretName, ref secretData);
        LsaClose(policyHandle);
        if (result != 0) throw new Exception("LsaStorePrivateData failed with code " + result);
    }
}
"@
