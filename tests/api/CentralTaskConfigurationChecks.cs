using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using PersonalOS.Api.Modules.Identity;
using PersonalOS.Api.Modules.Tasks;

internal static class CentralTaskConfigurationChecks
{
    public static int Run()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Environment.EnvironmentName = Environments.Production;
        var identity = Options.Create(new IdentityOptions { Provider = "Supabase", Authority = "https://test-project.supabase.co/auth/v1" });
        var validator = new CentralTaskOptionsValidator(builder.Environment, identity);
        CentralTaskOptions Valid() => new() { Provider = "PostgreSql", Host = "db.test-project.supabase.co", Username = "metis_reader", Password = "synthetic-private-marker", ProjectRef = "test-project" };
        Check(validator.Validate(null, new()).Succeeded, "Disabled rejected");
        Check(validator.Validate(null, Valid()).Succeeded, "Direct configuration rejected");
        var pooler = Valid(); pooler.Host = "aws-0-eu-central-1.pooler.supabase.com"; pooler.Username = "metis_reader.test-project";
        Check(validator.Validate(null, pooler).Succeeded, "Session pooler rejected");
        foreach (var mutate in new Action<CentralTaskOptions>[] {
            o => o.Host = "untrusted.example", o => o.Host = "127.0.0.1", o => o.Port = 6543,
            o => o.Username = "postgres", o => o.Username = "metis_reader.other-project",
            o => o.Password = "", o => o.ProjectRef = "other-project", o => o.Provider = "Unknown",
            o => o.AllowLocalDevelopment = true, o => o.Database = "other",
            o => o.Host = null!, o => o.ProjectRef = null!,
        }) {
            var options = Valid(); mutate(options);
            var result = validator.Validate(null, options);
            Check(result.Failed && !result.FailureMessage!.Contains("synthetic-private-marker"), "Invalid setting accepted or secret echoed");
        }
        builder.Environment.EnvironmentName = Environments.Development;
        var local = Valid(); local.Host = "127.0.0.1"; local.AllowLocalDevelopment = true; local.Port = 54321;
        Check(validator.Validate(null, local).Succeeded, "Explicit local development rejected");
        local.Host = "10.0.0.1";
        Check(validator.Validate(null, local).Failed, "TLS bypass allowed off loopback");
        Console.WriteLine("PASS central config: strict roles, matching project, session pooler, loopback-only development, no secret echo");
        return 1;
    }
    private static void Check(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
}
