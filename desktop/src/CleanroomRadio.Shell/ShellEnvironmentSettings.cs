using System.Collections;
using System.Globalization;

namespace CleanroomRadio.Desktop.Shell;

public sealed record ShellEnvironmentSettings(Uri PanelUri, ShellLaunchMode LaunchMode)
{
    public static ShellEnvironmentSettings FromCurrentProcessEnvironment(string[]? commandLineArgs = null)
    {
        var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            if (entry.Key is string key)
            {
                environment[key] = entry.Value as string;
            }
        }

        return FromEnvironment(environment, commandLineArgs);
    }

    public static ShellEnvironmentSettings FromEnvironment(
        IReadOnlyDictionary<string, string?> environment,
        string[]? commandLineArgs = null)
    {
        ArgumentNullException.ThrowIfNull(environment);

        var host = GetValueOrDefault(environment, "CLEANROOM_HOST", "127.0.0.1");
        var port = ParsePort(environment, "CLEANROOM_PORT", "8100");
        var stationId = ParseStationId(environment, "CLEANROOM_STATION_ID", "0");
        var mode = ParseLaunchMode(
            GetValueOrDefault(environment, "CLEANROOM_SHELL_MODE", "operator"),
            commandLineArgs ?? Array.Empty<string>());
        var baseUri = new Uri($"http://{host}:{port}");

        if (mode == ShellLaunchMode.HealthWall && !baseUri.IsLoopback)
        {
            throw new FormatException("Health Wall mode requires CLEANROOM_HOST to be a loopback host.");
        }

        var panelUri = mode == ShellLaunchMode.HealthWall
            ? new Uri(ShellUrlBuilder.BuildHealthWallUrl(baseUri.AbsoluteUri))
            : new Uri(ShellUrlBuilder.BuildAppUrl(baseUri.AbsoluteUri, stationId));
        return new ShellEnvironmentSettings(panelUri, mode);
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

    private static ShellLaunchMode ParseLaunchMode(string configured, IReadOnlyList<string> commandLineArgs)
    {
        var selected = configured.Trim().ToLowerInvariant() switch
        {
            "" or "operator" => ShellLaunchMode.Operator,
            "health-wall" => ShellLaunchMode.HealthWall,
            _ => throw new FormatException("CLEANROOM_SHELL_MODE must be 'operator' or 'health-wall'."),
        };

        foreach (var argument in commandLineArgs)
        {
            if (string.Equals(argument, "--health-wall", StringComparison.OrdinalIgnoreCase))
            {
                selected = ShellLaunchMode.HealthWall;
            }
            else if (string.Equals(argument, "--operator", StringComparison.OrdinalIgnoreCase))
            {
                selected = ShellLaunchMode.Operator;
            }
            else
            {
                throw new FormatException("Only --health-wall or --operator launch arguments are supported.");
            }
        }

        return selected;
    }
}
