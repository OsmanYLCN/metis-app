using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using PersonalOS.Api.Modules.Tasks;

internal static class TaskFoundationChecks
{
    private static readonly Guid UserA = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid UserB = Guid.Parse("22222222-2222-4222-8222-222222222222");
    public static async Task<int> Run(Func<ITaskReader?, Task<WebApplication>> start,
        Func<string?, string> token, string[] invalidTokens)
    {
        var count = 0;
        void Pass(string label) { count++; Console.WriteLine($"PASS tasks: {label}"); }
        await using (var app = await start(null))
        using (var client = app.GetTestClient())
        {
            await Get(client, "/api/v1/tasks", HttpStatusCode.Unauthorized);
            await Get(client, "/api/v1/tasks/status", HttpStatusCode.Unauthorized);
            var status = await Get(client, "/api/v1/tasks/status", HttpStatusCode.OK, token(null));
            Check(status.GetProperty("storage").GetString() == "notConfigured" && !status.GetProperty("syncAvailable").GetBoolean(), "Fake configured storage.");
            var list = await Get(client, "/api/v1/tasks", HttpStatusCode.ServiceUnavailable, token(null));
            Check(list.GetProperty("code").GetString() == "central_store_not_configured", "Missing connection concealed.");
            Pass("unconfigured production store never returns a fake empty list; status requires authentication");
        }
        var reader = new FixtureReader();
        await using (var app = await start(reader))
        using (var client = app.GetTestClient())
        {
            foreach (var bad in invalidTokens) await Get(client, "/api/v1/tasks", HttpStatusCode.Unauthorized, bad);
            Check(reader.Calls == 0, "Invalid authentication reached storage.");
            Pass("anonymous/service-role/foreign-issuer/malformed tokens cannot reach task storage");

            var page = await Get(client, "/api/v1/tasks?limit=1", HttpStatusCode.OK, token(null));
            Check(page.GetProperty("items").GetArrayLength() == 1 && page.GetProperty("items")[0].GetProperty("title").GetString() == "Account A first", "Wrong first page.");
            var cursor = page.GetProperty("nextCursor").GetString();
            Check(cursor == reader.Rows[0].Id.ToString("N"), "Bad cursor.");
            var next = await Get(client, $"/api/v1/tasks?limit=1&after={cursor}", HttpStatusCode.OK, token(null));
            Check(next.GetProperty("items")[0].GetProperty("title").GetString() == "Account A second"
                && next.GetProperty("nextCursor").ValueKind == JsonValueKind.Null, "Bad continuation.");
            Check(reader.LastAccount == UserA && reader.LastTake == 2, "Client spoofed account or unbounded read.");
            Pass("verified owner, bounded cursor pages and tombstone exclusion");

            var own = await Get(client, $"/api/v1/tasks/{reader.Rows[0].Id:N}", HttpStatusCode.OK, token(null));
            Check(!own.TryGetProperty("userId", out _), "Owner identifier leaked in task DTO.");
            var other = await Get(client, $"/api/v1/tasks/{reader.Rows[2].Id:N}", HttpStatusCode.NotFound, token(null));
            var missing = await Get(client, "/api/v1/tasks/ffffffffffffffffffffffffffffffff", HttpStatusCode.NotFound, token(null));
            Check(other.GetRawText() == missing.GetRawText(), "Other owner existence leaked.");
            await Get(client, $"/api/v1/tasks/{reader.Rows[3].Id:N}", HttpStatusCode.NotFound, token(null));
            var b = await Get(client, "/api/v1/tasks", HttpStatusCode.OK, token(UserB.ToString()));
            Check(b.GetProperty("items").GetArrayLength() == 1 && b.GetProperty("items")[0].GetProperty("title").GetString() == "Account B private", "Account B mixed with A.");
            Pass("other owner, missing and deleted task look alike; no query/header identity trust");

            foreach (var query in new[] { "limit=0", "limit=101", "limit=-1", "limit=x", "limit=1&limit=2", "after=invalid", "after=", $"userId={UserB}", "includeDeleted=true" })
            {
                var calls = reader.Calls;
                await Get(client, "/api/v1/tasks?" + query, HttpStatusCode.BadRequest, token(null));
                Check(reader.Calls == calls, "Invalid query reached storage.");
            }
            await Get(client, "/api/v1/tasks/not-an-id", HttpStatusCode.BadRequest, token(null));
            Pass("invalid cursors, excessive limits and owner override parameters are rejected");

            reader.Unavailable = true;
            await Get(client, "/api/v1/tasks", HttpStatusCode.ServiceUnavailable, token(null));
            reader.Unavailable = false;
            reader.BrokenScope = true;
            await Get(client, "/api/v1/tasks", HttpStatusCode.ServiceUnavailable, token(null));
            await Get(client, $"/api/v1/tasks/{reader.Rows[2].Id:N}", HttpStatusCode.NotFound, token(null));
            Pass("storage outage and mis-scoped adapter fail closed without exposing rows");

            using var post = new HttpRequestMessage(HttpMethod.Post, "/api/v1/tasks") { Content = new StringContent("{}") };
            post.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token(null));
            using var response = await client.SendAsync(post);
            Check(response.StatusCode == HttpStatusCode.MethodNotAllowed, "Writes unexpectedly enabled.");
            Pass("central writes remain unavailable in the read-model slice");
        }
        return count;
    }

    private static async Task<JsonElement> Get(HttpClient client, string path, HttpStatusCode expected, string? token = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("X-User-Id", UserB.ToString());
        using var response = await client.SendAsync(request);
        Check(response.StatusCode == expected, $"{path}: expected {expected}, got {response.StatusCode}");
        Check(response.Headers.CacheControl?.NoStore == true && !response.Headers.Contains("Set-Cookie"), "Caching/cookie violation.");
        if (expected == HttpStatusCode.Unauthorized) Check(response.Headers.WwwAuthenticate.ToString() == "Bearer", "Missing challenge.");
        var body = await response.Content.ReadAsStringAsync();
        Check(token is null || !body.Contains(token, StringComparison.Ordinal), "Token exposed.");
        return JsonDocument.Parse(body).RootElement.Clone();
    }
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

    private sealed class FixtureReader : ITaskReader
    {
        public bool IsConfigured => true;
        public ValueTask<bool> CanReadAsync(Guid account, CancellationToken cancellationToken) => ValueTask.FromResult(!Unavailable);
        public int Calls { get; private set; }
        public int LastTake { get; private set; }
        public Guid LastAccount { get; private set; }
        public bool Unavailable { get; set; }
        public bool BrokenScope { get; set; }
        public List<TaskRecord> Rows { get; } = [
            Row(1, UserA, "Account A first"), Row(2, UserA, "Account A second"),
            Row(3, UserB, "Account B private"), Row(4, UserA, "Deleted", true),
        ];
        private static TaskRecord Row(int id, Guid user, string title, bool deleted = false)
        {
            var now = DateTimeOffset.UtcNow;
            return new(Guid.Parse(id.ToString("x32")), user, title, false, 1, now, now, deleted ? now : null);
        }
        public ValueTask<IReadOnlyList<TaskRecord>> ListAsync(Guid account, Guid? after, int take, CancellationToken cancellationToken)
        {
            Calls++; LastTake = take; LastAccount = account;
            if (Unavailable) throw new TaskStoreUnavailableException();
            return ValueTask.FromResult<IReadOnlyList<TaskRecord>>(Rows.Where(row => (BrokenScope || row.UserId == account)
                && row.DeletedAt is null && (after is null || row.Id.CompareTo(after.Value) > 0)).OrderBy(row => row.Id).Take(take).ToArray());
        }
        public ValueTask<TaskRecord?> FindAsync(Guid account, Guid id, CancellationToken cancellationToken)
        {
            Calls++; LastAccount = account;
            if (Unavailable) throw new TaskStoreUnavailableException();
            return ValueTask.FromResult(Rows.FirstOrDefault(row => row.Id == id && (BrokenScope || row.UserId == account) && row.DeletedAt is null));
        }
    }
}
