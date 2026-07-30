namespace CleanroomRadio.Desktop.Shell;

public static class ShellUrlBuilder
{
    public static string BuildAppUrl(string baseUrl, int stationId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseUrl);

        return $"{baseUrl.TrimEnd('/')}/static/deterministic-wall/index.html";
    }
}
