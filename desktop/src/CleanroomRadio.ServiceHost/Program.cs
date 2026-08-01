using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CleanroomRadio.ServiceHost;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            var settings = ServiceHostSettings.FromCommandLine(args);
            var builder = Host.CreateApplicationBuilder(args);
            builder.Services.AddWindowsService(options => options.ServiceName = settings.ServiceName);
            builder.Services.AddSingleton(settings);
            builder.Services.AddSingleton<RedactingRollingLog>();
            builder.Services.AddHostedService<ServiceSupervisor>();
            builder.Logging.ClearProviders();

            using var host = builder.Build();
            await host.RunAsync().ConfigureAwait(false);
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(SecretRedactor.Redact(exception.Message));
            return 1;
        }
    }
}
