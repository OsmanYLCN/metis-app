using PersonalOS.Api.Modules.Tasks;

internal static class TaskWriteRuleChecks
{
    public static int Run()
    {
        var account = Guid.NewGuid(); var other = Guid.NewGuid(); var id = Guid.NewGuid(); var operation = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var row = new TaskRecord(id, account, "Original", false, 4, now, now, null);
        var create = new TaskWriteCommand(operation, id, TaskWriteKind.Create, 0, "  A task  ");
        var rename = new TaskWriteCommand(Guid.NewGuid(), id, TaskWriteKind.Rename, 4, "Renamed");
        var passed = 0;
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException(name); }
        void Pass(string name) { passed++; Console.WriteLine($"PASS write rules: {name}"); }
        var first = TaskWriteRules.Decide(account, create, null, null);
        Check(first.Outcome == TaskWriteOutcome.Create && first.Title == "A task" && first.Fingerprint?.Length == 64, "Create contract");
        Pass("new task normalizes title and generates a canonical operation fingerprint");

        foreach (var invalid in new[] {
            create with { OperationId = Guid.Empty }, create with { TaskId = Guid.Empty }, create with { Kind = (TaskWriteKind)99 },
            create with { ExpectedRevision = 1 }, rename with { ExpectedRevision = 0 }, rename with { ExpectedRevision = -1 },
            create with { Title = null! }, create with { Title = "  " }, create with { Title = "a\nb" },
            create with { Title = new string('a',201) }, create with { Title = "\ud800" },
        }) Check(TaskWriteRules.Decide(account, invalid, null, null).Outcome == TaskWriteOutcome.Invalid, "Invalid command accepted");
        Check(TaskWriteRules.Decide(Guid.Empty, create, null, null).Outcome == TaskWriteOutcome.Invalid, "Missing account accepted");
        Pass("invalid identity, kind, revision, title and malformed Unicode fail closed");
        Check(TaskWriteRules.Decide(account, create with { Title = string.Concat(Enumerable.Repeat("🌱",200)) }, null, null).Outcome == TaskWriteOutcome.Create, "Unicode boundary");
        Pass("title limit counts Unicode code points, not UTF-16 units");

        var receipt = new TaskWriteReceipt(account, operation, first.Fingerprint!, 1);
        var replay = TaskWriteRules.Decide(account, create with { Title = "A task" }, row, receipt);
        Check(replay.Outcome == TaskWriteOutcome.Replay && replay.AppliedRevision == 1 && replay.Title is null, "Replay changed result");
        Check(TaskWriteRules.Decide(account, create, row with { DeletedAt = now }, receipt).Outcome == TaskWriteOutcome.Replay, "Replay resurrected deleted record");
        Pass("lost-response retries acknowledge original revision without a second mutation or resurrection");
        foreach (var changed in new[] { create with { Title = "Different" }, create with { TaskId = Guid.NewGuid() },
            create with { Kind = TaskWriteKind.Rename, ExpectedRevision = 4 } })
            Check(TaskWriteRules.Decide(account, changed, row, receipt).Outcome == TaskWriteOutcome.OperationConflict, "Operation ID reused");
        Pass("same operation ID with a different payload is rejected");
        Check(TaskWriteRules.Decide(account, create, null, receipt with { AccountId = other }).Outcome == TaskWriteOutcome.Unavailable, "Foreign receipt");
        Check(TaskWriteRules.Decide(account, create, null, receipt with { OperationId = Guid.NewGuid() }).Outcome == TaskWriteOutcome.Unavailable, "Wrong receipt");
        Check(TaskWriteRules.Decide(account, rename, row with { UserId = other }, null).Outcome == TaskWriteOutcome.Unavailable, "Foreign task");
        Check(TaskWriteRules.Decide(account, rename, row with { Id = Guid.NewGuid() }, null).Outcome == TaskWriteOutcome.Unavailable, "Wrong task");
        Pass("mis-scoped storage records never become write decisions");
        Check(TaskWriteRules.Decide(account, create, row, null).Outcome == TaskWriteOutcome.Conflict, "Duplicate create");
        Check(TaskWriteRules.Decide(account, create, row with { DeletedAt = now }, null).Outcome == TaskWriteOutcome.Conflict, "Reused deleted ID");
        Pass("create never overwrites an existing or deleted task ID");
        var accepted = TaskWriteRules.Decide(account, rename, row, null);
        Check(accepted.Outcome == TaskWriteOutcome.Rename && accepted.Title == "Renamed", "Valid rename");
        Check(TaskWriteRules.Decide(account, rename, row with { Revision = 5 }, null).Outcome == TaskWriteOutcome.Conflict, "Stale revision overwritten");
        Check(TaskWriteRules.Decide(account, rename with { ExpectedRevision = 5 }, row, null).Outcome == TaskWriteOutcome.Conflict, "Future revision accepted");
        Check(row.Title == "Original" && row.Revision == 4, "Input mutated");
        Pass("rename requires exact revision; decisions do not mutate the supplied record");
        Check(TaskWriteRules.Decide(account, rename, null, null).Outcome == TaskWriteOutcome.NotFound, "Missing task");
        Check(TaskWriteRules.Decide(account, rename, row with { DeletedAt = now }, null).Outcome == TaskWriteOutcome.NotFound, "Deleted task");
        Check(TaskWriteRules.Decide(account, rename with { ExpectedRevision = long.MaxValue }, row with { Revision = long.MaxValue }, null).Outcome == TaskWriteOutcome.Unavailable, "Revision overflow");
        Pass("missing/deleted tasks are indistinguishable and revision overflow is blocked");
        return passed;
    }
}
