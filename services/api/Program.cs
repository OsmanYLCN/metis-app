using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using PersonalOS.Api.Modules.Identity;
using PersonalOS.Api.Modules.Tasks;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddIdentityFoundation(builder.Configuration);
builder.Services.AddTasksFoundation(builder.Configuration);
builder.Services.AddHealthChecks()
    .AddCheck("process", () => HealthCheckResult.Healthy());

// Development-only origins, including Tauri's Windows production-webview origin.
// Development-only desktop origins; authentication and task ownership are still enforced by the API.
builder.Services.AddCors(options => options.AddPolicy("LocalDesktop", policy =>
    policy.WithOrigins("http://127.0.0.1:1420", "http://localhost:1420",
                       "http://127.0.0.1:4173", "http://tauri.localhost")
        .WithMethods("GET", "POST", "PATCH")
        .WithHeaders("Content-Type", "Authorization")));

var app = builder.Build();
app.UseExceptionHandler();
if (app.Environment.IsDevelopment()) app.UseCors("LocalDesktop");
app.MapIdentityFoundation();
app.MapTasksFoundation();

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
