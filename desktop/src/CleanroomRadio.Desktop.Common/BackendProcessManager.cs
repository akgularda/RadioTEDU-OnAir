using System.Diagnostics;
using System.Globalization;

namespace CleanroomRadio.Desktop.Common;

public static class BackendProcessManager
{
    public static ProcessStartInfo CreateStartInfo(BackendOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var executablePath = Path.GetFullPath(options.ExecutablePath);
        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            WorkingDirectory = Path.GetDirectoryName(executablePath) ?? string.Empty,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        startInfo.EnvironmentVariables["CLEANROOM_OPEN_PANEL"] = "0";
        startInfo.EnvironmentVariables["CLEANROOM_HOST"] = "127.0.0.1";
        startInfo.EnvironmentVariables["CLEANROOM_PORT"] = options.Port.ToString(CultureInfo.InvariantCulture);
        startInfo.EnvironmentVariables["CLEANROOM_DB_PATH"] = options.DatabasePath;

        return startInfo;
    }
}
