using System.IO;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CleanroomRadio.Desktop.Shell;

public sealed class MainForm : Form
{
    private readonly WebView2 _webView;
    private readonly Uri _panelUri;
    private readonly string _webViewUserDataFolder;
    private CloseIntent _closeIntent = CloseIntent.ExitApplication;

    public MainForm()
        : this(ShellEnvironmentSettings.FromCurrentProcessEnvironment().PanelUri)
    {
    }

    public MainForm(Uri panelUri)
    {
        _panelUri = panelUri ?? throw new ArgumentNullException(nameof(panelUri));
        _webViewUserDataFolder = GetWebViewUserDataFolder();
        Directory.CreateDirectory(_webViewUserDataFolder);
        Environment.SetEnvironmentVariable(
            "WEBVIEW2_USER_DATA_FOLDER",
            _webViewUserDataFolder,
            EnvironmentVariableTarget.Process);

        Text = "RadioTEDU OnAir";
        Width = 1280;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = _webViewUserDataFolder,
            },
        };

        Controls.Add(_webView);
        Load += HandleLoad;
        FormClosing += HandleFormClosing;
    }

    public bool HideToTrayEnabled { get; set; }

    public void RequestClose(CloseIntent intent)
    {
        _closeIntent = intent;
        Close();
    }

    private async void HandleLoad(object? sender, EventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            HandleWebViewInitializationFailure(ex);
        }
    }

    private void HandleFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (e.CloseReason != CloseReason.UserClosing)
        {
            return;
        }

        if (!ShellClosePolicy.ShouldHideOnUserClose(_closeIntent, HideToTrayEnabled))
        {
            return;
        }

        e.Cancel = true;
        Hide();
    }

    private static string GetWebViewUserDataFolder()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, "RadioTEDU OnAir", "EBWebView");
    }

    private async Task InitializeWebViewAsync()
    {
        var env = await CoreWebView2Environment.CreateAsync(
            userDataFolder: _webViewUserDataFolder);

        await _webView.EnsureCoreWebView2Async(env);
        _webView.Source = _panelUri;
    }

    private void HandleWebViewInitializationFailure(Exception exception)
    {
        MessageBox.Show(
            this,
            $"RadioTEDU OnAir could not start the embedded browser control.\n\n{exception.Message}",
            Text,
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);

        _closeIntent = CloseIntent.ExitApplication;
        Close();
    }
}
