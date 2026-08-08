using System.IO;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CleanroomRadio.Desktop.Shell;

public sealed class MainForm : Form
{
    private readonly WebView2 _webView;
    private readonly Uri _panelUri;
    private readonly ShellLaunchMode _launchMode;
    private readonly ShellNavigationPolicy _navigationPolicy;
    private readonly string _webViewUserDataFolder;
    private readonly System.Windows.Forms.Timer _healthWallRetryTimer;
    private CloseIntent _closeIntent = CloseIntent.ExitApplication;
    private int _healthWallConsecutiveFailures;
    private bool _webViewInitialized;
    private bool _healthWallSupportExitRequested;

    public MainForm()
        : this(ShellEnvironmentSettings.FromCurrentProcessEnvironment())
    {
    }

    public MainForm(Uri panelUri)
        : this(new ShellEnvironmentSettings(panelUri, ShellLaunchMode.Operator))
    {
    }

    public MainForm(ShellEnvironmentSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _panelUri = settings.PanelUri ?? throw new ArgumentNullException(nameof(settings));
        _launchMode = settings.LaunchMode;
        _navigationPolicy = new ShellNavigationPolicy(_panelUri, _launchMode == ShellLaunchMode.HealthWall);
        _healthWallRetryTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        _healthWallRetryTimer.Tick += HandleHealthWallRetry;
        _webViewUserDataFolder = GetWebViewUserDataFolder(_launchMode);
        Directory.CreateDirectory(_webViewUserDataFolder);
        Environment.SetEnvironmentVariable(
            "WEBVIEW2_USER_DATA_FOLDER",
            _webViewUserDataFolder,
            EnvironmentVariableTarget.Process);

        Text = _launchMode == ShellLaunchMode.HealthWall ? "RadioTEDU OnAir Health Wall" : "RadioTEDU OnAir";
        Width = 1280;
        Height = 800;
        StartPosition = FormStartPosition.CenterScreen;
        if (_launchMode == ShellLaunchMode.HealthWall)
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = FormWindowState.Normal;
            StartPosition = FormStartPosition.Manual;
            Bounds = HealthWallRuntimePolicy.WindowBounds(
                Screen.PrimaryScreen?.WorkingArea ?? SystemInformation.WorkingArea);
            MinimumSize = new Size(
                Math.Min(HealthWallRuntimePolicy.MinimumWindowWidth, Bounds.Width),
                Math.Min(HealthWallRuntimePolicy.MinimumWindowHeight, Bounds.Height));
            MaximizeBox = true;
            MinimizeBox = true;
            SizeGripStyle = SizeGripStyle.Show;
            HideToTrayEnabled = false;
        }

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
        FormClosed += (_, _) => _healthWallRetryTimer.Dispose();
    }

    public bool HideToTrayEnabled { get; set; }

    public void RequestClose(CloseIntent intent)
    {
        _closeIntent = intent;
        _healthWallSupportExitRequested =
            _launchMode == ShellLaunchMode.HealthWall && intent == CloseIntent.ExitApplication;
        Close();
    }

    private async void HandleLoad(object? sender, EventArgs e)
    {
        await InitializeOrRecoverHealthWallAsync();
    }

    private void HandleFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (e.CloseReason != CloseReason.UserClosing)
        {
            return;
        }

        if (HealthWallRuntimePolicy.ShouldCancelUserClose(
                _launchMode,
                _healthWallSupportExitRequested))
        {
            e.Cancel = true;
            Activate();
            return;
        }

        if (!ShellClosePolicy.ShouldHideOnUserClose(_closeIntent, HideToTrayEnabled))
        {
            return;
        }

        e.Cancel = true;
        Hide();
    }

    private static string GetWebViewUserDataFolder(ShellLaunchMode launchMode)
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var profile = launchMode == ShellLaunchMode.HealthWall ? "EBWebView-HealthWall" : "EBWebView-OnAir";
        return Path.Combine(localAppData, "RadioTEDU OnAir", profile);
    }

    private async Task InitializeWebViewAsync()
    {
        var env = await CoreWebView2Environment.CreateAsync(
            userDataFolder: _webViewUserDataFolder);

        await _webView.EnsureCoreWebView2Async(env);
        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = _launchMode != ShellLaunchMode.HealthWall;
        _webView.CoreWebView2.Settings.AreDevToolsEnabled = _launchMode != ShellLaunchMode.HealthWall;
        _webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = _launchMode != ShellLaunchMode.HealthWall;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = _launchMode != ShellLaunchMode.HealthWall;
        _webView.CoreWebView2.NavigationStarting += HandleNavigationStarting;
        _webView.CoreWebView2.NavigationCompleted += HandleNavigationCompleted;
        _webView.CoreWebView2.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
        if (_launchMode == ShellLaunchMode.Operator)
        {
            _webView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
        }
        _webView.Source = _panelUri;
        _webViewInitialized = true;
    }

    private void HandleWebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (_launchMode != ShellLaunchMode.Operator
            || _webView.CoreWebView2 is null
            || !NativePickerBridge.IsTrustedSource(_panelUri, eventArgs.Source)
            || !NativePickerBridge.TryParseRequest(eventArgs.WebMessageAsJson, out var request)
            || request is null)
        {
            return;
        }

        NativePickerResponse response;
        try
        {
            response = ShowNativePicker(request);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Trace.TraceError(
                "RadioTEDU native picker failed: {0}",
                ex.Message);
            response = new NativePickerResponse(
                request.RequestId,
                false,
                string.Empty,
                "The desktop folder window could not be opened. Enter the absolute path instead.");
        }

        _webView.CoreWebView2.PostWebMessageAsJson(
            NativePickerBridge.CreateResponseJson(response));
    }

    private NativePickerResponse ShowNativePicker(NativePickerRequest request)
    {
        if (request.Kind == "folder")
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = request.Description,
                ShowNewFolderButton = true,
                UseDescriptionForTitle = true,
                SelectedPath = Directory.Exists(request.InitialPath)
                    ? request.InitialPath
                    : string.Empty,
            };
            var selected = dialog.ShowDialog(this) == DialogResult.OK
                && !string.IsNullOrWhiteSpace(dialog.SelectedPath);
            return new NativePickerResponse(
                request.RequestId,
                selected,
                selected ? dialog.SelectedPath : string.Empty);
        }

        using var fileDialog = new OpenFileDialog
        {
            Title = request.Description,
            Filter = "Environment files (*.env)|*.env|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (File.Exists(request.InitialPath))
        {
            fileDialog.InitialDirectory = Path.GetDirectoryName(request.InitialPath) ?? string.Empty;
            fileDialog.FileName = Path.GetFileName(request.InitialPath);
        }
        else if (Directory.Exists(request.InitialPath))
        {
            fileDialog.InitialDirectory = request.InitialPath;
        }

        var fileSelected = fileDialog.ShowDialog(this) == DialogResult.OK
            && !string.IsNullOrWhiteSpace(fileDialog.FileName);
        return new NativePickerResponse(
            request.RequestId,
            fileSelected,
            fileSelected ? fileDialog.FileName : string.Empty);
    }

    private async Task InitializeOrRecoverHealthWallAsync()
    {
        try
        {
            await InitializeWebViewAsync();
            ResetHealthWallRetry();
        }
        catch (Exception ex) when (_launchMode == ShellLaunchMode.HealthWall)
        {
            System.Diagnostics.Trace.TraceError(
                "RadioTEDU Health Wall WebView initialization failed: {0}",
                ex.Message);
            ScheduleHealthWallRetry();
        }
        catch (Exception ex)
        {
            HandleWebViewInitializationFailure(ex);
        }
    }

    private void HandleNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var target) && _navigationPolicy.Allows(target))
        {
            return;
        }

        eventArgs.Cancel = true;
    }

    private void HandleNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (_launchMode != ShellLaunchMode.HealthWall)
        {
            return;
        }

        if (eventArgs.IsSuccess)
        {
            ResetHealthWallRetry();
            return;
        }

        ScheduleHealthWallRetry();
    }

    private void HandleHealthWallRetry(object? sender, EventArgs eventArgs)
    {
        _healthWallRetryTimer.Stop();
        if (_launchMode != ShellLaunchMode.HealthWall)
        {
            return;
        }

        if (!_webViewInitialized || _webView.CoreWebView2 is null)
        {
            _ = InitializeOrRecoverHealthWallAsync();
            return;
        }

        _webView.CoreWebView2.Navigate(_panelUri.AbsoluteUri);
    }

    private void ScheduleHealthWallRetry()
    {
        if (_launchMode != ShellLaunchMode.HealthWall)
        {
            return;
        }

        _healthWallConsecutiveFailures++;
        _healthWallRetryTimer.Interval = HealthWallRuntimePolicy.RetryDelayMilliseconds(
            _healthWallConsecutiveFailures);
        _healthWallRetryTimer.Start();
    }

    private void ResetHealthWallRetry()
    {
        _healthWallConsecutiveFailures = 0;
        _healthWallRetryTimer.Stop();
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
