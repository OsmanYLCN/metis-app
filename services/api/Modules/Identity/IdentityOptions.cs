using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace PersonalOS.Api.Modules.Identity;

public sealed class IdentityOptions
{
    public const string SectionName = "Identity";
    public string Provider { get; set; } = "Disabled";
    public string? Authority { get; set; }
}

public sealed partial class IdentityOptionsValidator : IValidateOptions<IdentityOptions>
{
    public ValidateOptionsResult Validate(string? name, IdentityOptions options)
    {
        if (options.Provider == "Disabled")
        {
            return string.IsNullOrWhiteSpace(options.Authority)
                ? ValidateOptionsResult.Success
                : ValidateOptionsResult.Fail("Identity.Authority must be empty while the provider is Disabled.");
        }

        if (options.Provider != "Supabase")
            return ValidateOptionsResult.Fail("Identity.Provider must be Disabled or Supabase.");

        // Constrain the trusted issuer without accepting secrets,
        // credentials, query parameters, IP addresses, custom domains or arbitrary endpoints.
        if (string.IsNullOrWhiteSpace(options.Authority)
            || options.Authority != options.Authority.Trim()
            || !Uri.TryCreate(options.Authority, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !uri.IsDefaultPort
            || !SupabaseHost().IsMatch(uri.Host)
            || uri.UserInfo.Length != 0
            || uri.Query.Length != 0
            || uri.Fragment.Length != 0
            || uri.AbsolutePath.TrimEnd('/') != "/auth/v1")
        {
            // Never include the supplied value in errors or logs.
            return ValidateOptionsResult.Fail("Identity.Authority must be a Supabase HTTPS /auth/v1 issuer without credentials, query or fragment.");
        }

        return ValidateOptionsResult.Success;
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9-]*\\.supabase\\.co$", RegexOptions.CultureInvariant)]
    private static partial Regex SupabaseHost();
}
