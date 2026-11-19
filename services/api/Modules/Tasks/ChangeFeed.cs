using System.Globalization;
using System.Text.Json;

namespace PersonalOS.Api.Modules.Tasks;

public sealed record ChangeCursor(Guid Epoch, Guid Account, long Position)
{
    public override string ToString() => $"{Epoch:N}.{Account:N}.{Position.ToString(CultureInfo.InvariantCulture)}";
    public static bool TryParse(string value, Guid account, out ChangeCursor? cursor)
    {
        cursor = null;
        if (value.Length > 86) return false;
        var parts = value.Split('.');
        if (parts.Length != 3 || !Guid.TryParseExact(parts[0], "N", out var epoch) || epoch == Guid.Empty
            || !Guid.TryParseExact(parts[1], "N", out var owner) || owner != account
            || !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var position) || position < 0)
            return false;
        cursor = new(epoch, owner, position);
        return cursor.ToString() == value;
    }
}
public sealed record ChangeItem(string Position, string Entity, string EntityId, long Revision, bool Deleted, JsonElement Snapshot);
public sealed record ChangePage(int ContractVersion, IReadOnlyList<ChangeItem> Items, string NextCursor, bool HasMore);
public sealed class ChangeCursorException : Exception;
public interface IChangeReader
{
    ValueTask<ChangePage> ReadChangesAsync(Guid account, ChangeCursor? cursor, int limit, CancellationToken cancellationToken);
}

public static class ChangeFeedModule
{
    public static IEndpointRouteBuilder MapChangeFeed(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGroup("/api/v1/sync").AddEndpointFilter<TaskAccountFilter>()
            .MapGet("/changes", Read);
        return endpoints;
    }
    private static async Task<IResult> Read(HttpContext context, ITaskReader reader)
    {
        var query = context.Request.Query;
        var account = context.Features.Get<VerifiedTaskAccount>()!.Id;
        var limit = 50;
        ChangeCursor? cursor = null;
        if (query.Keys.Any(key => key is not ("cursor" or "limit")) || query.Any(pair => pair.Value.Count != 1)
            || (query.TryGetValue("limit", out var rawLimit) && (!int.TryParse(rawLimit, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > 100))
            || (query.TryGetValue("cursor", out var rawCursor) && !ChangeCursor.TryParse(rawCursor.ToString(), account, out cursor)))
            return Results.BadRequest(new { code = "invalid_change_query" });
        if (reader is not IChangeReader changes) return Unavailable();
        try { return Results.Ok(await changes.ReadChangesAsync(account, cursor, limit, context.RequestAborted)); }
        catch (ChangeCursorException) { return Results.Conflict(new { code = "change_cursor_reset_required" }); }
        catch (TaskStoreUnavailableException) { return Unavailable(); }
    }
    private static IResult Unavailable() => Results.Json(new { code = "change_feed_unavailable" }, statusCode:503);
}
