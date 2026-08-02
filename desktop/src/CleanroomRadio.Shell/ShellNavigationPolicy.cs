namespace CleanroomRadio.Desktop.Shell;

public sealed class ShellNavigationPolicy
{
    private readonly Uri _fixedUri;

    public ShellNavigationPolicy(Uri fixedUri, bool fixedNavigation)
    {
        _fixedUri = fixedUri ?? throw new ArgumentNullException(nameof(fixedUri));
        FixedNavigation = fixedNavigation;
    }

    public bool FixedNavigation { get; }

    public bool Allows(Uri target)
    {
        ArgumentNullException.ThrowIfNull(target);
        return !FixedNavigation || Uri.Compare(
            _fixedUri,
            target,
            UriComponents.HttpRequestUrl,
            UriFormat.SafeUnescaped,
            StringComparison.OrdinalIgnoreCase) == 0;
    }
}
