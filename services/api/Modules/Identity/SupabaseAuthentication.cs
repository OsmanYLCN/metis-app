using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace PersonalOS.Api.Modules.Identity;

public sealed class SupabaseBearerOptions(
    IOptions<IdentityOptions> identityOptions,
    IHttpClientFactory clients) : IConfigureNamedOptions<JwtBearerOptions>
{
    public const string Scheme = "Supabase";
    public const string KeyClient = "SupabaseSigningKeys";

    public void Configure(JwtBearerOptions options) => Configure(Scheme, options);

    public void Configure(string? name, JwtBearerOptions options)
    {
        if (name != Scheme) return;
        var identity = identityOptions.Value;
        options.MapInboundClaims = false;
        options.SaveToken = false;
        options.IncludeErrorDetails = false;
        options.RequireHttpsMetadata = true;
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (identity.Provider == "Disabled") context.NoResult();
                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                // Only a signed, non-anonymous Supabase user token can identify an account.
                // Do not trust user_metadata for identity or authorization.
                if (!IsAccount(context.Principal)) context.Fail("Invalid account token.");
                return Task.CompletedTask;
            },
        };
        if (identity.Provider != "Supabase") return;

        var issuer = identity.Authority!.TrimEnd('/');
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidIssuer = issuer,
            ValidateAudience = true, ValidAudience = "authenticated",
            RequireAudience = true,
            ValidateLifetime = true, RequireExpirationTime = true,
            RequireSignedTokens = true, ValidateIssuerSigningKey = true,
            ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.RsaSha256],
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "sub", RoleClaimType = "role",
            IncludeTokenOnFailedValidation = false,
            LogTokenId = false,
        };

        // Supabase publishes JWKS directly. Discovery URLs in tokens are never followed.
        var retriever = new HttpDocumentRetriever(clients.CreateClient(KeyClient)) { RequireHttps = true };
        options.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
            issuer + "/.well-known/jwks.json", new SupabaseJwksRetriever(issuer), retriever)
        {
            AutomaticRefreshInterval = TimeSpan.FromMinutes(5),
            RefreshInterval = TimeSpan.FromMinutes(1),
            UseLastKnownGoodConfiguration = false,
        };
        options.RefreshOnIssuerKeyNotFound = true;
    }

    private static bool IsAccount(ClaimsPrincipal? principal)
    {
        var subjects = principal?.FindAll("sub").ToArray() ?? [];
        var roles = principal?.FindAll("role").ToArray() ?? [];
        var anonymous = principal?.FindAll("is_anonymous").ToArray() ?? [];
        return subjects.Length == 1 && Guid.TryParse(subjects[0].Value, out var userId) && userId != Guid.Empty
            && roles.Length == 1 && roles[0].Value == "authenticated"
            && anonymous.Length == 1 && anonymous[0].Value == "false";
    }
}

internal sealed class SupabaseJwksRetriever(string issuer) : IConfigurationRetriever<OpenIdConnectConfiguration>
{
    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(
        string address, IDocumentRetriever retriever, CancellationToken cancel)
    {
        var document = await retriever.GetDocumentAsync(address, cancel);
        var keys = new JsonWebKeySet(document).GetSigningKeys();
        if (keys.Count == 0) throw new InvalidOperationException("No asymmetric signing keys available.");
        var configuration = new OpenIdConnectConfiguration { Issuer = issuer };
        foreach (var key in keys) configuration.SigningKeys.Add(key);
        return configuration;
    }
}
