using CleanroomRadio.Desktop.Shell;
using System.Drawing;
using Xunit;

namespace CleanroomRadio.Desktop.Tests;

public class HealthWallShellTests
{
    [Fact]
    public void FromEnvironment_HealthWallTargetsDedicatedLoopbackPage()
    {
        var settings = ShellEnvironmentSettings.FromEnvironment(
            new Dictionary<string, string?>(),
            new[] { "--health-wall" });

        Assert.Equal(ShellLaunchMode.HealthWall, settings.LaunchMode);
        Assert.Equal(new Uri("http://127.0.0.1:8100/static/health-wall/index.html"), settings.PanelUri);
    }

    [Fact]
    public void FromEnvironment_RejectsRemoteHealthWallHost()
    {
        var environment = new Dictionary<string, string?>
        {
            ["CLEANROOM_HOST"] = "10.0.0.25",
            ["CLEANROOM_SHELL_MODE"] = "health-wall",
        };

        var exception = Assert.Throws<FormatException>(() => ShellEnvironmentSettings.FromEnvironment(environment));

        Assert.Contains("loopback", exception.Message);
    }

    [Fact]
    public void HealthWallNavigationPolicy_AllowsOnlyTheFixedWallPage()
    {
        var healthWall = new Uri("http://127.0.0.1:8100/static/health-wall/index.html");
        var policy = new ShellNavigationPolicy(healthWall, fixedNavigation: true);

        Assert.True(policy.Allows(healthWall));
        Assert.False(policy.Allows(new Uri("http://127.0.0.1:8100/static/deterministic-wall/index.html")));
        Assert.False(policy.Allows(new Uri("https://example.test/")));
    }

    [Theory]
    [InlineData(1, 2_000)]
    [InlineData(2, 4_000)]
    [InlineData(3, 8_000)]
    [InlineData(5, 30_000)]
    [InlineData(100, 30_000)]
    public void HealthWallRetryDelay_UsesBoundedBackoff(int failures, int expectedDelay)
    {
        Assert.Equal(expectedDelay, HealthWallRuntimePolicy.RetryDelayMilliseconds(failures));
    }

    [Fact]
    public void HealthWallClosePolicy_RejectsOrdinaryUserCloseButAllowsSupportExit()
    {
        Assert.True(HealthWallRuntimePolicy.ShouldCancelUserClose(ShellLaunchMode.HealthWall, false));
        Assert.False(HealthWallRuntimePolicy.ShouldCancelUserClose(ShellLaunchMode.HealthWall, true));
        Assert.False(HealthWallRuntimePolicy.ShouldCancelUserClose(ShellLaunchMode.Operator, false));
    }

    [Fact]
    public void HealthWallWindowBounds_AreSmallerThanAndCenteredWithinWorkingArea()
    {
        var workingArea = new Rectangle(100, 50, 1920, 1040);

        var bounds = HealthWallRuntimePolicy.WindowBounds(workingArea);

        Assert.Equal(new Size(1651, 894), bounds.Size);
        Assert.Equal(workingArea.Left + ((workingArea.Width - bounds.Width) / 2), bounds.Left);
        Assert.Equal(workingArea.Top + ((workingArea.Height - bounds.Height) / 2), bounds.Top);
        Assert.True(workingArea.Contains(bounds));
    }

    [Fact]
    public void HealthWallWindowBounds_NeverExceedSmallWorkingArea()
    {
        var workingArea = new Rectangle(0, 0, 800, 600);

        Assert.Equal(workingArea, HealthWallRuntimePolicy.WindowBounds(workingArea));
    }

    [Fact]
    public void HealthWallSingleInstance_UsesAWindowsGlobalMutex()
    {
        Assert.Equal(@"Global\RadioTEDU.OnAir.HealthWall", HealthWallSingleInstance.MutexName);
    }
}
