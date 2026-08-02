namespace CleanroomRadio.Desktop.Shell;

/// <summary>
/// Pure Health Wall lifecycle rules. Keep these rules independent of WinForms so
/// the unattended behavior remains directly testable.
/// </summary>
public static class HealthWallRuntimePolicy
{
    public const int InitialRetryDelayMilliseconds = 2_000;
    public const int MaximumRetryDelayMilliseconds = 30_000;
    public const double WindowWidthRatio = 0.86;
    public const double WindowHeightRatio = 0.86;
    public const int MinimumWindowWidth = 960;
    public const int MinimumWindowHeight = 640;

    public static Rectangle WindowBounds(Rectangle workingArea)
    {
        if (workingArea.Width <= 0 || workingArea.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(workingArea));
        }

        var width = Math.Min(
            workingArea.Width,
            Math.Max(MinimumWindowWidth, (int)Math.Round(workingArea.Width * WindowWidthRatio)));
        var height = Math.Min(
            workingArea.Height,
            Math.Max(MinimumWindowHeight, (int)Math.Round(workingArea.Height * WindowHeightRatio)));

        return new Rectangle(
            workingArea.Left + ((workingArea.Width - width) / 2),
            workingArea.Top + ((workingArea.Height - height) / 2),
            width,
            height);
    }

    public static bool ShouldCancelUserClose(
        ShellLaunchMode launchMode,
        bool supportExitWasRequested)
    {
        return launchMode == ShellLaunchMode.HealthWall && !supportExitWasRequested;
    }

    public static int RetryDelayMilliseconds(int consecutiveFailures)
    {
        var boundedFailures = Math.Clamp(consecutiveFailures, 1, 5);
        var delay = InitialRetryDelayMilliseconds * (1 << (boundedFailures - 1));
        return Math.Min(delay, MaximumRetryDelayMilliseconds);
    }
}
