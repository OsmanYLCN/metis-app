using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using PersonalOS.Api.Modules.Identity;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddIdentityFoundation(builder.Configuration);
builder.Services.AddHealthChecks()
    .AddCheck("process", () => HealthCheckResult.Healthy());

// Development-only origins, including Tauri's Windows production-webview origin.
// Business endpoints remain absent in M0.4.
builder.Services.AddCors(options => options.AddPolicy("LocalDesktop", policy =>
    policy.WithOrigins("http://127.0.0.1:1420", "http://localhost:1420",
                       "http://127.0.0.1:4173", "http://tauri.localhost")
        .WithMethods("GET")
        .WithHeaders("Content-Type", "Authorization")));

var app = builder.Build();
app.UseExceptionHandler();
if (app.Environment.IsDevelopment()) app.UseCors("LocalDesktop");
app.MapIdentityFoundation();

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        await context.Response.WriteAsJsonAsync(new
        {
            status = report.Status.ToString(),
            service = "personal-os-api",
            scope = "process-only"
        }, context.RequestAborted);
    }
}).WithMetadata(new HttpMethodMetadata(["GET"]));

app.Run();
