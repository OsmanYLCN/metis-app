using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace PersonalOS.Api.Modules.Identity;

public static class IdentityModule
{
    public static IServiceCollection AddIdentityFoundation(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<IdentityOptions>, IdentityOptionsValidator>();
        services.AddOptions<IdentityOptions>()
            .Bind(configuration.GetSection(IdentityOptions.SectionName), options => options.ErrorOnUnknownConfiguration = true)
            .ValidateOnStart();
        services.AddHttpClient(SupabaseBearerOptions.KeyClient, client =>
        {
            client.Timeout = TimeSpan.FromSeconds(5);
            client.MaxResponseContentBufferSize = 256 * 1024;
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddAuthentication().AddJwtBearer(SupabaseBearerOptions.Scheme, _ => { });
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, SupabaseBearerOptions>();
        services.AddSingleton<IIdentityProvider>(provider =>
        {
            var options = provider.GetRequiredService<IOptions<IdentityOptions>>().Value;
            return options.Provider == "Supabase"
                ? new SupabaseIdentityProvider()
                : new DisabledIdentityProvider();
        });
        return services;
    }

    public static IEndpointRouteBuilder MapIdentityFoundation(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/auth");
        group.MapGet("/status", (HttpContext context, IIdentityProvider identity) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(identity.GetStatus());
        });
        group.MapGet("/session", async (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            // Authenticate explicitly: an arbitrary HttpContext.User must never grant a session.
            var result = await context.AuthenticateAsync(SupabaseBearerOptions.Scheme);
            if (!result.Succeeded)
            {
                context.Response.Headers.WWWAuthenticate = "Bearer";
                return Results.Json(SessionSnapshot.SignedOut, statusCode: StatusCodes.Status401Unauthorized);
            }
            var userId = result.Principal!.FindFirst("sub")!.Value;
            return Results.Ok(new SessionSnapshot(true, "signedIn", new SessionUser(userId, null)));
        });
        return endpoints;
    }
}
