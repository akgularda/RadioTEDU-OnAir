using CleanroomRadio.Desktop.Shell;
using Xunit;

namespace CleanroomRadio.Desktop.Tests;

public class ShellClosePolicyTests
{
    [Fact]
    public void ShouldHideOnUserClose_ReturnsFalseWhenTrayModeIsDisabled()
    {
        var shouldHide = ShellClosePolicy.ShouldHideOnUserClose(
            CloseIntent.HideToTray,
            hideToTrayEnabled: false);

        Assert.False(shouldHide);
    }

    [Fact]
    public void ShouldHideOnUserClose_ReturnsTrueWhenTrayModeIsEnabledAndHideIsRequested()
    {
        var shouldHide = ShellClosePolicy.ShouldHideOnUserClose(
            CloseIntent.HideToTray,
            hideToTrayEnabled: true);

        Assert.True(shouldHide);
    }
}

public class ShellEnvironmentTests
{
    [Fact]
    public void FromEnvironment_UsesDefaultsWhenUnset()
    {
        var environment = new Dictionary<string, string?>();

        var settings = ShellEnvironmentSettings.FromEnvironment(environment);

        Assert.Equal(new Uri("http://127.0.0.1:8100/static/deterministic-wall/index.html"), settings.PanelUri);
    }

    [Fact]
    public void FromEnvironment_ThrowsForMalformedStationId()
    {
        var environment = new Dictionary<string, string?>
        {
            ["CLEANROOM_STATION_ID"] = "abc",
        };

        var exception = Assert.Throws<FormatException>(() =>
            ShellEnvironmentSettings.FromEnvironment(environment));

        Assert.Contains("CLEANROOM_STATION_ID", exception.Message);
    }
}
