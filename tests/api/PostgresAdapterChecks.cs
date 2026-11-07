using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Options;
using PersonalOS.Api.Modules.Tasks;

internal static class PostgresAdapterChecks
{
    public static async Task<int> Run(string port, Func<Dictionary<string, string?>, Task<WebApplication>> start, Func<string, string> token)
    {
        const string userA = "11111111-1111-4111-8111-111111111111";
        const string userB = "22222222-2222-4222-8222-222222222222";
        var expectedBlocked = Environment.GetEnvironmentVariable("METIS_TEST_PG_BLOCKED") == "1";
        var settings = new Dictionary<string, string?> {
            ["CentralTasks:Provider"] = "PostgreSql", ["CentralTasks:Host"] = "127.0.0.1", ["CentralTasks:Port"] = port,
            ["CentralTasks:Username"] = "metis_reader", ["CentralTasks:Password"] = "synthetic-local-password",
            ["CentralTasks:ProjectRef"] = "test-project", ["CentralTasks:AllowLocalDevelopment"] = "true",
        };
        await using var app = await start(settings);
        using var client = app.GetTestClient();
        async Task<JsonElement> Get(string path, string user, HttpStatusCode expected)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token(user));
            using var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            if (response.StatusCode != expected) throw new InvalidOperationException($"PG adapter expected {expected}; got {response.StatusCode}: {body}");
            if (body.Contains("synthetic-local-password") || body.Contains("Host=")) throw new InvalidOperationException("Private configuration leaked.");
            return JsonDocument.Parse(body).RootElement.Clone();
        }
        var status = await Get("/api/v1/tasks/status", userA, HttpStatusCode.OK);
        if (expectedBlocked)
        {
            Check(status.GetProperty("storage").GetString() == "unavailable" && !status.GetProperty("readAvailable").GetBoolean(), "Unsafe role reported ready");
            await Get("/api/v1/tasks", userA, HttpStatusCode.ServiceUnavailable);
            Console.WriteLine("PASS PostgreSQL adapter: unsafe database role or unavailable server fails closed");
            return 1;
        }
        Check(status.GetProperty("readAvailable").GetBoolean() && status.GetProperty("storage").GetString() == "ready", "Configured database failed readiness");
        for (var i = 0; i < 3; i++)
        {
            var a = await Get("/api/v1/tasks?limit=1", userA, HttpStatusCode.OK);
            Check(a.GetProperty("items")[0].GetProperty("title").GetString() == "A first", "Wrong A row");
            var cursor = a.GetProperty("nextCursor").GetString();
            var next = await Get($"/api/v1/tasks?limit=1&after={cursor}", userA, HttpStatusCode.OK);
            Check(next.GetProperty("items")[0].GetProperty("title").GetString() == "A second" && next.GetProperty("nextCursor").ValueKind == JsonValueKind.Null, "Bad PG cursor");
            var b = await Get("/api/v1/tasks", userB, HttpStatusCode.OK);
            Check(b.GetProperty("items").GetArrayLength() == 1 && b.GetProperty("items")[0].GetProperty("title").GetString() == "B private", "Connection context leaked between accounts");
            await Get("/api/v1/tasks/00000000000000000000000000000003", userA, HttpStatusCode.NotFound);
            await Get("/api/v1/tasks/00000000000000000000000000000004", userA, HttpStatusCode.NotFound);
        }
        var wrongProject = Options.Create(new CentralTaskOptions { Provider = "PostgreSql", Host = "127.0.0.1", Port = int.Parse(port),
            Username = "metis_reader", Password = "synthetic-local-password", ProjectRef = "wrong-project", AllowLocalDevelopment = true });
        await using var mismatch = new PostgresTaskReader(wrongProject);
        Check(!await mismatch.CanReadAsync(Guid.Parse(userA), CancellationToken.None), "Wrong project database accepted");
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        try { await mismatch.ListAsync(Guid.Parse(userA), null, 1, cancelled.Token); throw new InvalidOperationException("Cancellation ignored"); }
        catch (OperationCanceledException) { }
        Console.WriteLine("PASS PostgreSQL adapter: real Npgsql TCP reads, signed-user scope, pool reuse, cursor, tombstones, project binding and cancellation");
        return 1;
    }
    private static void Check(bool ok, string message) { if (!ok) throw new InvalidOperationException(message); }
}
