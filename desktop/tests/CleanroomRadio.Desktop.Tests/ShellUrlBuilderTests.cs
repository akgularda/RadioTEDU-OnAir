using CleanroomRadio.Desktop.Shell;
using Xunit;

namespace CleanroomRadio.Desktop.Tests;

public class ShellUrlBuilderTests
{
    [Fact]
    public void BuildAppUrl_TargetsLocalPanelRoute()
    {
        var url = ShellUrlBuilder.BuildAppUrl("http://127.0.0.1:8100", 4);

        Assert.Equal("http://127.0.0.1:8100/static/deterministic-wall/index.html", url);
    }

    [Fact]
    public void BuildHealthWallUrl_TargetsDedicatedWallPage()
    {
        var url = ShellUrlBuilder.BuildHealthWallUrl("http://127.0.0.1:8100");

        Assert.Equal("http://127.0.0.1:8100/static/health-wall/index.html", url);
    }
}
