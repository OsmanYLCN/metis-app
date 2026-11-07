using Microsoft.AspNetCore.Authentication;
using PersonalOS.Api.Modules.Identity;

namespace PersonalOS.Api.Modules.Tasks;

internal sealed record VerifiedTaskAccount(Guid Id);

internal sealed class TaskAccountFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        var context = invocation.HttpContext;
        context.Response.Headers.CacheControl = "no-store";
        // Neither HttpContext.User injected by another middleware nor client IDs grant access.
        var authentication = await context.AuthenticateAsync(SupabaseBearerOptions.Scheme);
        if (!authentication.Succeeded || !Guid.TryParse(authentication.Principal?.FindFirst("sub")?.Value, out var id) || id == Guid.Empty)
        {
            context.Response.Headers.WWWAuthenticate = "Bearer";
            return Results.Json(new { code = "authentication_required" }, statusCode: StatusCodes.Status401Unauthorized);
        }
        context.Features.Set(new VerifiedTaskAccount(id));
        return await next(invocation);
    }
}
