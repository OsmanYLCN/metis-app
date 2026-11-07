using System.Globalization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace PersonalOS.Api.Modules.Tasks;

public static class TasksModule
{
    public static IServiceCollection AddTasksFoundation(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<CentralTaskOptions>, CentralTaskOptionsValidator>();
        services.AddOptions<CentralTaskOptions>()
            .Bind(configuration.GetSection("CentralTasks"), options => options.ErrorOnUnknownConfiguration = true).ValidateOnStart();
        services.TryAddSingleton<ITaskReader>(provider => provider.GetRequiredService<IOptions<CentralTaskOptions>>().Value.Provider == "PostgreSql"
            ? new PostgresTaskReader(provider.GetRequiredService<IOptions<CentralTaskOptions>>()) : new UnconfiguredTaskReader());
        return services;
    }

    public static IEndpointRouteBuilder MapTasksFoundation(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/tasks").AddEndpointFilter<TaskAccountFilter>();
        group.MapGet("/status", async (HttpContext context, ITaskReader reader) =>
        {
            var ready = await reader.CanReadAsync(context.Features.Get<VerifiedTaskAccount>()!.Id, context.RequestAborted);
            return Results.Ok(new { storage = !reader.IsConfigured ? "notConfigured" : ready ? "ready" : "unavailable",
                readAvailable = ready, syncAvailable = false });
        });
        group.MapGet("", List);
        group.MapGet("/{id}", Find);
        return endpoints;
    }

    private static async Task<IResult> List(HttpContext context, ITaskReader reader)
    {
        var query = context.Request.Query;
        if (query.Keys.Any(key => key is not ("limit" or "after")) || query.Any(pair => pair.Value.Count != 1))
            return BadQuery();
        var limit = 50;
        if (query.TryGetValue("limit", out var rawLimit)
            && (!int.TryParse(rawLimit.ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > 100))
            return BadQuery();
        Guid? after = null;
        if (query.TryGetValue("after", out var rawCursor))
        {
            if (!ParseId(rawCursor.ToString(), out var parsed)) return BadQuery();
            after = parsed;
        }
        var account = context.Features.Get<VerifiedTaskAccount>()!.Id;
        try
        {
            var rows = await reader.ListAsync(account, after, limit + 1, context.RequestAborted);
            // Fail closed if a future adapter violates the owner/tombstone contract.
            if (rows.Count > limit + 1 || rows.Any(row => !CanExpose(row, account))
                || rows.Select(row => row.Id).Distinct().Count() != rows.Count) return Unavailable(reader);
            var items = rows.Take(limit).Select(TaskSnapshot.From).ToArray();
            return Results.Ok(new TaskPage(items, rows.Count > limit ? items[^1].Id : null));
        }
        catch (TaskStoreUnavailableException) { return Unavailable(reader); }
    }

    private static async Task<IResult> Find(string id, HttpContext context, ITaskReader reader)
    {
        if (context.Request.Query.Count != 0 || !ParseId(id, out var parsed)) return BadQuery();
        var account = context.Features.Get<VerifiedTaskAccount>()!.Id;
        try
        {
            var row = await reader.FindAsync(account, parsed, context.RequestAborted);
            if (row is null || row.UserId != account || row.DeletedAt is not null)
                return Results.NotFound(new { code = "task_not_found" });
            if (row.Id != parsed || !CanExpose(row, account)) return Unavailable(reader);
            return Results.Ok(TaskSnapshot.From(row));
        }
        catch (TaskStoreUnavailableException) { return Unavailable(reader); }
    }

    private static bool CanExpose(TaskRecord row, Guid account) => row.UserId == account && row.DeletedAt is null
        && row.Id != Guid.Empty && row.Revision > 0 && !string.IsNullOrWhiteSpace(row.Title)
        && row.Title.EnumerateRunes().Count() <= 200 && !row.Title.Any(char.IsControl)
        && row.UpdatedAt >= row.CreatedAt;
    private static bool ParseId(string value, out Guid id) => Guid.TryParseExact(value, "N", out id) && id != Guid.Empty;
    private static IResult BadQuery() => Results.BadRequest(new { code = "invalid_task_query" });
    private static IResult Unavailable(ITaskReader reader) => Results.Json(new
    {
        code = reader.IsConfigured ? "central_store_unavailable" : "central_store_not_configured",
    }, statusCode: StatusCodes.Status503ServiceUnavailable);
}
