namespace CleanroomRadio.Desktop.Shell;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        return ShellApplication.Run(
            initialize: () => { },
            createForm: () => new MainForm(),
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
