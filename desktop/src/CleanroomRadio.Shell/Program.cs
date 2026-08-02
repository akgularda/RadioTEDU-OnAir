namespace CleanroomRadio.Desktop.Shell;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        ShellEnvironmentSettings settings;
        try
        {
            settings = ShellEnvironmentSettings.FromCurrentProcessEnvironment(args);
        }
        catch (Exception exception)
        {
            ShowStartupError("RadioTEDU OnAir", $"RadioTEDU OnAir could not start.\n\n{exception.Message}");
            return 1;
        }

        using var healthWallInstance = settings.LaunchMode == ShellLaunchMode.HealthWall
            ? HealthWallSingleInstance.Acquire()
            : null;
        if (healthWallInstance is { IsPrimary: false })
        {
            return 0;
        }

        return ShellApplication.Run(
            initialize: () => { },
            createForm: () => new MainForm(settings),
            runForm: Application.Run,
            showError: ShowStartupError);
    }

    private static void ShowStartupError(string title, string message)
    {
        MessageBox.Show(
            message,
            title,
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }
}
