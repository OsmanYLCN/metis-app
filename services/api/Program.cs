using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using PersonalOS.Api.Modules.Identity;
using PersonalOS.Api.Modules.Tasks;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddIdentityFoundation(builder.Configuration);
builder.Services.AddTasksFoundation();
builder.Services.AddHealthChecks()
    .AddCheck("process", () => HealthCheckResult.Healthy());

// Development-only origins, including Tauri's Windows production-webview origin.
// Central task foundation is read-only; no business mutation methods are enabled.
builder.Services.AddCors(options => options.AddPolicy("LocalDesktop", policy =>
    policy.WithOrigins("http://127.0.0.1:1420", "http://localhost:1420",
                       "http://127.0.0.1:4173", "http://tauri.localhost")
        .WithMethods("GET")
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
