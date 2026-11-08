using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PersonalOS.Api.Modules.Tasks;

// Domain contract only: no HTTP endpoint, database writes or permissions are enabled here.
public enum TaskWriteKind { Create, Rename }
public sealed record TaskWriteCommand(Guid OperationId, Guid TaskId, TaskWriteKind Kind, long ExpectedRevision, string Title);

// Loaded by a future writer from an account-scoped, committed operation journal. Never client input.
public sealed record TaskWriteReceipt(Guid AccountId, Guid OperationId, string Fingerprint, long AppliedRevision);
public enum TaskWriteOutcome { Create, Rename, Replay, Invalid, NotFound, Conflict, OperationConflict, Unavailable }
public sealed record TaskWriteDecision(TaskWriteOutcome Outcome, string? Title = null, string? Fingerprint = null, long? AppliedRevision = null);

public static class TaskWriteRules
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    // The caller must supply an authenticated account, lock/load its task and operation receipt,
    // evaluate and persist the mutation + receipt in ONE transaction. This function is not a lock.
    public static TaskWriteDecision Decide(Guid account, TaskWriteCommand command, TaskRecord? current, TaskWriteReceipt? receipt)
    {
        if (account == Guid.Empty || command.OperationId == Guid.Empty || command.TaskId == Guid.Empty
            || !Enum.IsDefined(command.Kind) || command.Title is null
            || (command.Kind == TaskWriteKind.Create ? command.ExpectedRevision != 0 : command.ExpectedRevision <= 0))
            return new(TaskWriteOutcome.Invalid);
        // Bound raw input before normalization and reject malformed UTF-16 rather than replacing it.
        if (command.Title.Length > 400 || command.Title.Any(char.IsControl)) return new(TaskWriteOutcome.Invalid);
        var title = command.Title.Trim();
        if (title.Length == 0 || title.EnumerateRunes().Count() > 200) return new(TaskWriteOutcome.Invalid);
        try { StrictUtf8.GetByteCount(title); }
        catch (EncoderFallbackException) { return new(TaskWriteOutcome.Invalid); }

        // Versioned canonical payload: no culture-dependent formatting or ambiguous concatenation.
        var payload = JsonSerializer.SerializeToUtf8Bytes(new { version = 1, account, command.OperationId,
            command.TaskId, command.Kind, command.ExpectedRevision, title });
        var fingerprint = Convert.ToHexString(SHA256.HashData(payload));
        if (receipt is not null)
        {
            if (receipt.AccountId != account || receipt.OperationId != command.OperationId || receipt.AppliedRevision < 1)
                return new(TaskWriteOutcome.Unavailable);
            return receipt.Fingerprint == fingerprint
                ? new(TaskWriteOutcome.Replay, AppliedRevision: receipt.AppliedRevision)
                : new(TaskWriteOutcome.OperationConflict);
        }
        if (current is not null && (current.UserId != account || current.Id != command.TaskId || current.Revision < 1))
            return new(TaskWriteOutcome.Unavailable);
        if (command.Kind == TaskWriteKind.Create)
            return current is null ? new(TaskWriteOutcome.Create, title, fingerprint) : new(TaskWriteOutcome.Conflict);
        if (current is null || current.DeletedAt is not null) return new(TaskWriteOutcome.NotFound);
        if (current.Revision != command.ExpectedRevision) return new(TaskWriteOutcome.Conflict);
        if (current.Revision == long.MaxValue) return new(TaskWriteOutcome.Unavailable);
        return new(TaskWriteOutcome.Rename, title, fingerprint);
    }
}
