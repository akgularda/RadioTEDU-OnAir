using System.Threading;

namespace CleanroomRadio.Desktop.Shell;

/// <summary>
/// Keeps the unattended wall to one instance across Windows sessions.
/// </summary>
public sealed class HealthWallSingleInstance : IDisposable
{
    public const string MutexName = @"Global\RadioTEDU.OnAir.HealthWall";

    private readonly Mutex _mutex;
    private bool _disposed;

    private HealthWallSingleInstance(Mutex mutex, bool isPrimary)
    {
        _mutex = mutex;
        IsPrimary = isPrimary;
    }

    public bool IsPrimary { get; }

    public static HealthWallSingleInstance Acquire()
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        return new HealthWallSingleInstance(mutex, createdNew);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (IsPrimary)
        {
            _mutex.ReleaseMutex();
        }

        _mutex.Dispose();
    }
}
