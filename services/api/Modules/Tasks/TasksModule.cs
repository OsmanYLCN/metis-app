using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace PersonalOS.Api.Modules.Tasks;

public static class TasksModule
{
    private static readonly JsonSerializerOptions WriteJson = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8,
    };

    private sealed record CreateTaskBody(string? OperationId, string? TaskId, string? Title);
    private sealed record RenameTaskBody(string? OperationId, long? ExpectedRevision, string? Title);

    public static IServiceCollection AddTasksFoundation(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<IValidateOptions<CentralTaskOptions>, CentralTaskOptionsValidator>();
        services.AddSingleton<IValidateOptions<CentralTaskWriterOptions>, CentralTaskWriterOptionsValidator>();
        services.AddOptions<CentralTaskOptions>()
            .Bind(configuration.GetSection("CentralTasks"), options => options.ErrorOnUnknownConfiguration = true).ValidateOnStart();
        services.AddOptions<CentralTaskWriterOptions>()
            .Bind(configuration.GetSection("CentralTaskWriter"), options => options.ErrorOnUnknownConfiguration = true).ValidateOnStart();
        services.TryAddSingleton<ITaskReader>(provider => provider.GetRequiredService<IOptions<CentralTaskOptions>>().Value.Provider == "PostgreSql"
            ? new PostgresTaskReader(provider.GetRequiredService<IOptions<CentralTaskOptions>>()) : new UnconfiguredTaskReader());
        services.TryAddSingleton<ITaskWriter>(provider => provider.GetRequiredService<IOptions<CentralTaskWriterOptions>>().Value.Provider == "PostgreSql"
            ? new PostgresTaskWriter(provider.GetRequiredService<IOptions<CentralTaskWriterOptions>>()) : new UnconfiguredTaskWriter());
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
        group.MapPost("", Create);
        group.MapMethods("/{id}", ["PATCH"], Rename);
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

    private static async Task<IResult> Create(HttpContext context, ITaskWriter writer)
    {
        if (context.Request.Query.Count != 0) return BadWrite();
        var body = await ReadBody<CreateTaskBody>(context);
        if (body is null || !ParseId(body.OperationId, out var operationId) || !ParseId(body.TaskId, out var taskId))
            return BadWrite();
        return await ApplyWrite(context, writer,
            new TaskWriteCommand(operationId, taskId, TaskWriteKind.Create, 0, body.Title!), true);
    }

    private static async Task<IResult> Rename(string id, HttpContext context, ITaskWriter writer)
    {
        if (context.Request.Query.Count != 0 || !ParseId(id, out var taskId)) return BadWrite();
        var body = await ReadBody<RenameTaskBody>(context);
        if (body is null || !ParseId(body.OperationId, out var operationId) || body.ExpectedRevision is null)
            return BadWrite();
        return await ApplyWrite(context, writer,
            new TaskWriteCommand(operationId, taskId, TaskWriteKind.Rename, body.ExpectedRevision.Value, body.Title!), false);
    }

    private static async Task<IResult> ApplyWrite(HttpContext context, ITaskWriter writer, TaskWriteCommand command, bool create)
    {
        var account = context.Features.Get<VerifiedTaskAccount>()!.Id;
        try
        {
            var decision = await writer.ApplyAsync(account, command, context.RequestAborted);
            if (decision.Outcome is TaskWriteOutcome.Create or TaskWriteOutcome.Rename or TaskWriteOutcome.Replay)
            {
                if (decision.AppliedRevision is null or < 1) return WriterUnavailable(writer);
                var response = new { outcome = decision.Outcome == TaskWriteOutcome.Replay ? "replayed" : "applied",
                    taskId = command.TaskId.ToString("N"), revision = decision.AppliedRevision.Value };
                return create && decision.Outcome == TaskWriteOutcome.Create
                    ? Results.Created($"/api/v1/tasks/{command.TaskId:N}", response)
                    : Results.Ok(response);
            }
            return decision.Outcome switch
            {
                TaskWriteOutcome.Invalid => BadWrite(),
                TaskWriteOutcome.NotFound => Results.NotFound(new { code = "task_not_found" }),
                TaskWriteOutcome.Conflict => Results.Conflict(new { code = "task_revision_conflict" }),
                TaskWriteOutcome.OperationConflict => Results.Conflict(new { code = "task_operation_conflict" }),
                _ => WriterUnavailable(writer),
            };
        }
        catch (TaskStoreUnavailableException) { return WriterUnavailable(writer); }
    }

    private static async ValueTask<T?> ReadBody<T>(HttpContext context) where T : class
    {
        var request = context.Request;
        var mediaType = request.ContentType?.Split(';', 2)[0].Trim();
        if (request.ContentLength is null or < 2 or > 4096
            || !string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase)) return null;
        try { return await JsonSerializer.DeserializeAsync<T>(request.Body, WriteJson, context.RequestAborted); }
        catch (JsonException) { return null; }
        catch (NotSupportedException) { return null; }
    }

    private static bool CanExpose(TaskRecord row, Guid account) => row.UserId == account && row.DeletedAt is null
        && row.Id != Guid.Empty && row.Revision > 0 && !string.IsNullOrWhiteSpace(row.Title)
        && row.Title.EnumerateRunes().Count() <= 200 && !row.Title.Any(char.IsControl)
        && row.UpdatedAt >= row.CreatedAt;
    private static bool ParseId(string? value, out Guid id) => Guid.TryParseExact(value, "N", out id) && id != Guid.Empty;
    private static IResult BadQuery() => Results.BadRequest(new { code = "invalid_task_query" });
    private static IResult BadWrite() => Results.BadRequest(new { code = "invalid_task_write" });
    private static IResult Unavailable(ITaskReader reader) => Results.Json(new
    {
        code = reader.IsConfigured ? "central_store_unavailable" : "central_store_not_configured",
    }, statusCode: StatusCodes.Status503ServiceUnavailable);
    private static IResult WriterUnavailable(ITaskWriter writer) => Results.Json(new
    {
        code = writer.IsConfigured ? "central_writer_unavailable" : "central_writer_not_configured",
    }, statusCode: StatusCodes.Status503ServiceUnavailable);
}
