namespace PersonalOS.Api.Modules.Tasks;

// An internal owner is mandatory; transport responses never contain it.
public sealed record TaskRecord(Guid Id, Guid UserId, string Title, bool Completed,
    long Revision, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);
public sealed record TaskSnapshot(string Id, string Title, bool Completed, long Revision,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt)
{
    public static TaskSnapshot From(TaskRecord task) => new(task.Id.ToString("N"), task.Title,
        task.Completed, task.Revision, task.CreatedAt, task.UpdatedAt);
}
public sealed record TaskPage(IReadOnlyList<TaskSnapshot> Items, string? NextCursor);

// Implementations must filter by the supplied verified account, exclude tombstones,
// sort by UUID ascending and apply the requested take bound. No unscoped read API exists.
public interface ITaskReader
{
    bool IsConfigured { get; }
    ValueTask<bool> CanReadAsync(Guid account, CancellationToken cancellationToken);
    ValueTask<IReadOnlyList<TaskRecord>> ListAsync(Guid account, Guid? after, int take, CancellationToken cancellationToken);
    ValueTask<TaskRecord?> FindAsync(Guid account, Guid id, CancellationToken cancellationToken);
}

public sealed class TaskStoreUnavailableException : Exception { }

// Disabled configuration has no fake/in-memory fallback.
internal sealed class UnconfiguredTaskReader : ITaskReader
{
    public bool IsConfigured => false;
    public ValueTask<bool> CanReadAsync(Guid account, CancellationToken cancellationToken) => ValueTask.FromResult(false);
    public ValueTask<IReadOnlyList<TaskRecord>> ListAsync(Guid account, Guid? after, int take, CancellationToken cancellationToken)
        => ValueTask.FromException<IReadOnlyList<TaskRecord>>(new TaskStoreUnavailableException());
    public ValueTask<TaskRecord?> FindAsync(Guid account, Guid id, CancellationToken cancellationToken)
        => ValueTask.FromException<TaskRecord?>(new TaskStoreUnavailableException());
}
