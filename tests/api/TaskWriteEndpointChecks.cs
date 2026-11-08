using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using PersonalOS.Api.Modules.Tasks;

internal static class TaskWriteEndpointChecks
{
    private const string UserA = "11111111-1111-4111-8111-111111111111";
    private const string UserB = "22222222-2222-4222-8222-222222222222";
    private const string Operation = "aaaaaaaa000040008000000000000001";
    private const string Task = "bbbbbbbb000040008000000000000001";

    public static async Task<int> Run(Func<ITaskWriter?, Task<WebApplication>> start,
        Func<string, string> token, string[] invalidTokens)
    {
        var count = 0;
        void Pass(string label) { count++; Console.WriteLine($"PASS task writes: {label}"); }
        await using (var app = await start(null))
        using (var client = app.GetTestClient())
        {
            var unavailable = await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), HttpStatusCode.ServiceUnavailable, token(UserA));
            Check(unavailable.GetProperty("code").GetString() == "central_writer_not_configured", "Disabled writer concealed");
            Pass("disabled writer fails closed without a fake success");
        }

        var writer = new FixtureWriter();
        await using (var app = await start(writer))
        using (var client = app.GetTestClient())
        {
            foreach (var invalid in invalidTokens)
                await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), HttpStatusCode.Unauthorized, invalid);
            Check(writer.Calls == 0, "Invalid authentication reached writer");
            Pass("invalid, anonymous and elevated tokens cannot reach writer");

            var created = await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), HttpStatusCode.Created, token(UserA));
            Check(created.GetProperty("outcome").GetString() == "applied" && created.GetProperty("revision").GetInt64() == 1, "Create response");
            Check(writer.LastAccount == Guid.Parse(UserA) && writer.LastCommand?.Kind == TaskWriteKind.Create
                && writer.LastCommand.TaskId.ToString("N") == Task && writer.LastCommand.Title == "New task", "Create mapping");
            Pass("create uses verified account and server command shape");

            writer.Next = new(TaskWriteOutcome.Replay, AppliedRevision: 1);
            var replay = await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), HttpStatusCode.OK, token(UserA));
            Check(replay.GetProperty("outcome").GetString() == "replayed", "Replay response");
            writer.Next = new(TaskWriteOutcome.Rename, AppliedRevision: 2);
            var renamed = await Send(client, HttpMethod.Patch, $"/api/v1/tasks/{Task}",
                JsonSerializer.Serialize(new { operationId = Operation, expectedRevision = 1, title = "Renamed" }), HttpStatusCode.OK, token(UserB));
            Check(renamed.GetProperty("revision").GetInt64() == 2 && writer.LastAccount == Guid.Parse(UserB)
                && writer.LastCommand?.ExpectedRevision == 1 && writer.LastCommand.Kind == TaskWriteKind.Rename, "Rename mapping");
            Pass("replay and rename return bounded receipts; path task and verified account win");

            var before = writer.Calls;
            foreach (var request in new[] {
                (HttpMethod.Post, "/api/v1/tasks", "{}", "application/json"),
                (HttpMethod.Post, "/api/v1/tasks?userId=" + UserB, CreateBody(), "application/json"),
                (HttpMethod.Post, "/api/v1/tasks", CreateBody(extra: true), "application/json"),
                (HttpMethod.Post, "/api/v1/tasks", CreateBody(), "text/plain"),
                (HttpMethod.Patch, "/api/v1/tasks/not-an-id", "{}", "application/json"),
            }) await Send(client, request.Item1, request.Item2, request.Item3, HttpStatusCode.BadRequest, token(UserA), request.Item4);
            Check(writer.Calls == before, "Malformed HTTP input reached writer");
            Pass("unknown fields, owner overrides, malformed IDs and media types are rejected before storage");

            foreach (var (decision, status, code) in new[] {
                (TaskWriteOutcome.Invalid, HttpStatusCode.BadRequest, "invalid_task_write"),
                (TaskWriteOutcome.NotFound, HttpStatusCode.NotFound, "task_not_found"),
                (TaskWriteOutcome.Conflict, HttpStatusCode.Conflict, "task_revision_conflict"),
                (TaskWriteOutcome.OperationConflict, HttpStatusCode.Conflict, "task_operation_conflict"),
            }) {
                writer.Next = new(decision);
                var body = await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), status, token(UserA));
                Check(body.GetProperty("code").GetString() == code, "Wrong decision mapping");
            }
            writer.Unavailable = true;
            var outage = await Send(client, HttpMethod.Post, "/api/v1/tasks", CreateBody(), HttpStatusCode.ServiceUnavailable, token(UserA));
            Check(outage.GetProperty("code").GetString() == "central_writer_unavailable", "Outage leaked");
            Pass("validation, missing task, conflicts and outages have stable safe responses");
        }
        return count;
    }

    private static string CreateBody(bool extra = false) => extra
        ? JsonSerializer.Serialize(new { operationId = Operation, taskId = Task, title = "New task", ownerId = UserB })
        : JsonSerializer.Serialize(new { operationId = Operation, taskId = Task, title = "New task" });

    private static async Task<JsonElement> Send(HttpClient client, HttpMethod method, string path, string json,
        HttpStatusCode expected, string token, string mediaType = "application/json")
    {
        using var request = new HttpRequestMessage(method, path) { Content = new StringContent(json, Encoding.UTF8, mediaType) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("X-User-Id", UserB);
        using var response = await client.SendAsync(request);
        Check(response.StatusCode == expected, $"{method} {path}: expected {expected}, got {response.StatusCode}");
        Check(response.Headers.CacheControl?.NoStore == true && !response.Headers.Contains("Set-Cookie"), "Write caching/cookie violation");
        var body = await response.Content.ReadAsStringAsync();
        Check(!body.Contains(token, StringComparison.Ordinal) && !body.Contains(UserA) && !body.Contains(UserB), "Identity/token leaked");
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private sealed class FixtureWriter : ITaskWriter
    {
        public bool IsConfigured => true;
        public int Calls { get; private set; }
        public Guid LastAccount { get; private set; }
        public TaskWriteCommand? LastCommand { get; private set; }
        public TaskWriteDecision? Next { get; set; }
        public bool Unavailable { get; set; }
        public ValueTask<TaskWriteDecision> ApplyAsync(Guid account, TaskWriteCommand command, CancellationToken cancellationToken)
        {
            Calls++; LastAccount = account; LastCommand = command;
            if (Unavailable) throw new TaskStoreUnavailableException();
            var result = Next ?? new(command.Kind == TaskWriteKind.Create ? TaskWriteOutcome.Create : TaskWriteOutcome.Rename,
                AppliedRevision: command.Kind == TaskWriteKind.Create ? 1 : command.ExpectedRevision + 1);
            Next = null;
            return ValueTask.FromResult(result);
        }
    }

    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
}
