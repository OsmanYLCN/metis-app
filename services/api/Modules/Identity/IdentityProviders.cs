namespace PersonalOS.Api.Modules.Identity;

public sealed class DisabledIdentityProvider : IIdentityProvider
{
    public IdentityStatus GetStatus() => new("notConfigured", null, false, "none");
}

/// <summary>
/// Configured verification is not a live provider health check or an available sign-in UI.
/// </summary>
public sealed class SupabaseIdentityProvider(string issuer) : IIdentityProvider
{
    public IdentityStatus GetStatus() => new("verificationConfigured", "supabase", false, "none", issuer.TrimEnd('/'));
}
