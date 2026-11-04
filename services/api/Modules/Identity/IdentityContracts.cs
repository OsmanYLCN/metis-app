namespace PersonalOS.Api.Modules.Identity;

public sealed record IdentityStatus(
    string Status,
    string? Provider,
    bool SignInAvailable,
    string SessionPersistence);

public sealed record SessionUser(string Id, string? DisplayName);

public sealed record SessionSnapshot(bool Authenticated, string State, SessionUser? User)
{
    public static SessionSnapshot SignedOut { get; } = new(false, "signedOut", null);
}

/// <summary>
/// Reports configuration only; account authentication is handled by the named Bearer scheme.
/// </summary>
public interface IIdentityProvider
{
    IdentityStatus GetStatus();
}
