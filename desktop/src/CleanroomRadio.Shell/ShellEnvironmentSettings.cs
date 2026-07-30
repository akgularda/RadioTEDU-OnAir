using System.Collections;
using System.Globalization;

namespace CleanroomRadio.Desktop.Shell;

public sealed record ShellEnvironmentSettings(Uri PanelUri)
{
    public static ShellEnvironmentSettings FromCurrentProcessEnvironment()
    {
        var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            if (entry.Key is string key)
            {
                environment[key] = entry.Value as string;
            }
        }

        return FromEnvironment(environment);
    }

    public static ShellEnvironmentSettings FromEnvironment(IReadOnlyDictionary<string, string?> environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        var host = GetValueOrDefault(environment, "CLEANROOM_HOST", "127.0.0.1");
        var port = ParsePort(environment, "CLEANROOM_PORT", "8100");
        var stationId = ParseStationId(environment, "CLEANROOM_STATION_ID", "0");

        var panelUri = new Uri(ShellUrlBuilder.BuildAppUrl($"http://{host}:{port}", stationId));
        return new ShellEnvironmentSettings(panelUri);
    }

    private static string GetValueOrDefault(
        IReadOnlyDictionary<string, string?> environment,
        string key,
        string defaultValue)
    {
        if (!environment.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value))
        {
            return defaultValue;
        }

        return value;
    }

    private static int ParsePort(
        IReadOnlyDictionary<string, string?> environment,
        string key,
        string defaultValue)
    {
        var value = GetValueOrDefault(environment, key, defaultValue);
        if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var port) ||
            port is < 1 or > 65535)
        {
            throw new FormatException($"{key} must be a valid TCP port.");
        }

        return port;
    }

    private static int ParseStationId(
        IReadOnlyDictionary<string, string?> environment,
        string key,
        string defaultValue)
    {
        var value = GetValueOrDefault(environment, key, defaultValue);
        if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var stationId))
        {
            throw new FormatException($"{key} must be an integer.");
        }

        return stationId;
    }
}
