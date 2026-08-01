using CleanroomRadio.ServiceHost;
using Xunit;

namespace CleanroomRadio.Desktop.Tests;

public sealed class ServiceHostTests
{
    [Fact]
    public void ReadDefinitions_AcceptsLegacyFiveFieldShapeWithoutPersistingArguments()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test process path is unavailable.");
            var configPath = Path.Combine(root, "example.services");
            File.WriteAllText(configPath, $"# legacy compatible{Environment.NewLine}worker|{executable}|--config worker.settings.json|{Path.GetDirectoryName(executable)}|true{Environment.NewLine}");

            var definitions = ServiceHostSettings.ReadDefinitions(configPath);

            var definition = Assert.Single(definitions);
            Assert.Equal("worker", definition.Id);
            Assert.Equal(executable, definition.ExecutablePath);
            Assert.Equal("--config worker.settings.json", definition.Arguments);
            Assert.True(definition.RestartOnExit);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void ReadDefinitions_RejectsMalformedPipeDelimitedLine()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var configPath = Path.Combine(root, "invalid.services");
            File.WriteAllText(configPath, "only|four|fields|here");

            var exception = Assert.Throws<InvalidDataException>(() => ServiceHostSettings.ReadDefinitions(configPath));

            Assert.Contains("five pipe-delimited", exception.Message, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void ReadDefinitions_PreservesFalseRestartOnExitForOneShotChild()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test process path is unavailable.");
            var configPath = Path.Combine(root, "one-shot.services");
            File.WriteAllText(configPath, $"one-shot|{executable}||{Path.GetDirectoryName(executable)}|false{Environment.NewLine}");

            var definition = Assert.Single(ServiceHostSettings.ReadDefinitions(configPath));

            Assert.False(definition.RestartOnExit);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("--token=example-value")]
    [InlineData("--password example-value")]
    [InlineData("--api-key example-value")]
    [InlineData("https://user:example-value@localhost/health")]
    public void ReadDefinitions_RejectsInlineCredentialsWithoutEchoingArguments(string arguments)
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Test process path is unavailable.");
            var configPath = Path.Combine(root, "credential.services");
            File.WriteAllText(configPath, $"worker|{executable}|{arguments}|{Path.GetDirectoryName(executable)}|true{Environment.NewLine}");

            var exception = Assert.Throws<InvalidDataException>(() => ServiceHostSettings.ReadDefinitions(configPath));

            Assert.Contains("forbidden inline credential", exception.Message, StringComparison.Ordinal);
            Assert.DoesNotContain(arguments, exception.Message, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void RestartBackoff_DoublesAndCapsThenResetsAfterStableRun()
    {
        var backoff = new RestartBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(4), TimeSpan.FromSeconds(10));

        Assert.Equal(TimeSpan.FromSeconds(1), backoff.RegisterExit(TimeSpan.Zero));
        Assert.Equal(TimeSpan.FromSeconds(2), backoff.RegisterExit(TimeSpan.Zero));
        Assert.Equal(TimeSpan.FromSeconds(4), backoff.RegisterExit(TimeSpan.Zero));
        Assert.Equal(TimeSpan.FromSeconds(4), backoff.RegisterExit(TimeSpan.Zero));
        Assert.Equal(TimeSpan.FromSeconds(1), backoff.RegisterExit(TimeSpan.FromSeconds(10)));
    }

    [Theory]
    [InlineData("token=super-secret", "token=<redacted>")]
    [InlineData("Authorization: Bearer abc.def-123", "Authorization=<redacted>")]
    [InlineData("password: \"unsafe\"", "password=<redacted>")]
    public void SecretRedactor_RemovesCommonCredentialValues(string input, string expected)
    {
        Assert.Equal(expected, SecretRedactor.Redact(input));
    }

    [Fact]
    public async Task ServiceStateWriter_WritesOperatorStateWithoutArguments()
    {
        var root = CreateTemporaryDirectory();
        try
        {
            var settings = new ServiceHostSettings("RadioTEDU.Example", Path.Combine(root, "unused.services"), root, root);
            var writer = new ServiceStateWriter(settings);
            var state = new ServiceHostState(
                settings.ServiceName,
                "Running",
                DateTimeOffset.UtcNow,
                [new ChildProcessState("worker", "Running", 1234, 0, DateTimeOffset.UtcNow, null, null)]);

            await writer.WriteAsync(state, CancellationToken.None);
            var json = await File.ReadAllTextAsync(writer.Path);

            Assert.Contains("RadioTEDU.Example", json, StringComparison.Ordinal);
            Assert.DoesNotContain("Arguments", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Installer_HardensOnlyServiceHostDirectoriesWithWellKnownSids()
    {
        var repositoryRoot = FindRepositoryRoot();
        var helper = File.ReadAllText(Path.Combine(repositoryRoot, "installer", "HardenServiceHostAcl.ps1"));
        var installer = File.ReadAllText(Path.Combine(repositoryRoot, "installer", "RadioTEDUBroadcastRoomSetup.iss"));

        Assert.Contains("S-1-5-18", helper, StringComparison.Ordinal);
        Assert.Contains("S-1-5-32-544", helper, StringComparison.Ordinal);
        Assert.Contains("[System.Security.AccessControl.DirectorySecurity]::new()", helper, StringComparison.Ordinal);
        Assert.Contains("$acl.SetAccessRuleProtection($true, $false)", helper, StringComparison.Ordinal);
        Assert.Contains("Set-Acl -LiteralPath $target -AclObject $acl", helper, StringComparison.Ordinal);
        Assert.Contains("\"Services\"", helper, StringComparison.Ordinal);
        Assert.Contains("Join-Path \"State\" \"ServiceHost\"", helper, StringComparison.Ordinal);
        Assert.Contains("Join-Path \"Logs\" \"ServiceHost\"", helper, StringComparison.Ordinal);
        Assert.DoesNotContain("S-1-5-32-545", helper, StringComparison.Ordinal);

        Assert.Contains("Source: \"HardenServiceHostAcl.ps1\"", installer, StringComparison.Ordinal);
        Assert.Contains("HardenServiceHostDirectories;", installer, StringComparison.Ordinal);
        Assert.Contains("Name: \"{commonappdata}\\RadioTEDU\\OnAir\\Services\"; Flags: uninsneveruninstall", installer, StringComparison.Ordinal);
        Assert.Contains("Name: \"{commonappdata}\\RadioTEDU\\OnAir\\Logs\\ServiceHost\"; Flags: uninsneveruninstall", installer, StringComparison.Ordinal);
        Assert.Contains("Name: \"{commonappdata}\\RadioTEDU\\OnAir\\State\\ServiceHost\"; Flags: uninsneveruninstall", installer, StringComparison.Ordinal);
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "RadioTEDU-ServiceHost-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "build_desktop_bundle.ps1")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Repository root could not be located from the test output directory.");
    }
}
