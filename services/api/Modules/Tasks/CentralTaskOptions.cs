using Microsoft.Extensions.Options;
using PersonalOS.Api.Modules.Identity;
using System.Text.RegularExpressions;
using Npgsql;

namespace PersonalOS.Api.Modules.Tasks;

public sealed class CentralTaskOptions
{
    public string Provider { get; set; } = "Disabled";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 5432;
    public string Database { get; set; } = "postgres";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string ProjectRef { get; set; } = "";
    public string? RootCertificate { get; set; }
    public bool AllowLocalDevelopment { get; set; }

    internal string ConnectionString() => new NpgsqlConnectionStringBuilder
    {
        Host = Host, Port = Port, Database = Database, Username = Username, Password = Password,
        SslMode = AllowLocalDevelopment ? SslMode.Disable : SslMode.VerifyFull,
        RootCertificate = string.IsNullOrWhiteSpace(RootCertificate) ? null : RootCertificate, GssEncryptionMode = GssEncryptionMode.Disable,
        Timeout = 5, CommandTimeout = 5, CancellationTimeout = 1000,
        MinPoolSize = 0, MaxPoolSize = 4, ConnectionIdleLifetime = 60,
        NoResetOnClose = false, IncludeErrorDetail = false, LogParameters = false,
        PersistSecurityInfo = false, MaxAutoPrepare = 0, ApplicationName = "Metis.ReadOnly",
    }.ConnectionString;
}

public sealed class CentralTaskOptionsValidator(IHostEnvironment environment, IOptions<IdentityOptions> identity) : IValidateOptions<CentralTaskOptions>
{
    public ValidateOptionsResult Validate(string? name, CentralTaskOptions options)
    {
        if (options.Provider == "Disabled") return ValidateOptionsResult.Success;
        const string error = "CentralTasks configuration is invalid. Use the documented read-only role, matching project and verified TLS; do not put credentials in logs.";
        if (options.Provider != "PostgreSql" || options.Port is < 1 or > 65535
            || options.Database != "postgres" || string.IsNullOrWhiteSpace(options.Password)
            || string.IsNullOrWhiteSpace(options.ProjectRef) || !Regex.IsMatch(options.ProjectRef, "^[a-z0-9][a-z0-9-]{0,62}$")
            || string.IsNullOrWhiteSpace(options.Host)
            || identity.Value.Provider != "Supabase"
            || identity.Value.Authority?.TrimEnd('/') != $"https://{options.ProjectRef}.supabase.co/auth/v1")
            return ValidateOptionsResult.Fail(error);
        if (options.AllowLocalDevelopment)
            return environment.IsDevelopment() && options.Host == "127.0.0.1" && options.Username == "metis_reader"
                ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(error);
        var direct = options.Host == $"db.{options.ProjectRef}.supabase.co" && options.Username == "metis_reader";
        var pooler = Regex.IsMatch(options.Host, "^aws-[0-9]+-[a-z0-9-]+\\.pooler\\.supabase\\.com$")
            && options.Username == $"metis_reader.{options.ProjectRef}";
        return options.Port == 5432 && (direct || pooler)
            ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(error);
    }
}
