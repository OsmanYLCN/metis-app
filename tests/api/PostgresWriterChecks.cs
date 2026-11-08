using Npgsql;
using PersonalOS.Api.Modules.Tasks;

internal static class PostgresWriterChecks
{
    public static async Task<int> Run(string port)
    {
        var connection=new NpgsqlConnectionStringBuilder { Host="127.0.0.1",Port=int.Parse(port),Database="postgres",Username="metis_writer",
            Password="synthetic",SslMode=SslMode.Disable,Timeout=5,CommandTimeout=5,MaxPoolSize=4,NoResetOnClose=false }.ConnectionString;
        await using var source=NpgsqlDataSource.Create(connection);
        var writer=new PostgresTaskWriter(source,"test-project");
        var a=Guid.Parse("11111111-1111-4111-8111-111111111111");
        var b=Guid.Parse("22222222-2222-4222-8222-222222222222");
        var id=Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        var op=Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        var create=new TaskWriteCommand(op,id,TaskWriteKind.Create,0,"  Cloud task  ");
        Check((await writer.ApplyAsync(a,create,CancellationToken.None)).Outcome==TaskWriteOutcome.Create,"create");
        var replay=await writer.ApplyAsync(a,create with { Title="Cloud task" },CancellationToken.None);
        Check(replay.Outcome==TaskWriteOutcome.Replay&&replay.AppliedRevision==1,"replay");
        Check((await writer.ApplyAsync(a,create with {Title="Changed"},CancellationToken.None)).Outcome==TaskWriteOutcome.OperationConflict,"operation conflict");
        var rename=new TaskWriteCommand(Guid.NewGuid(),id,TaskWriteKind.Rename,1,"Renamed cloud task");
        Check((await writer.ApplyAsync(a,rename,CancellationToken.None)).Outcome==TaskWriteOutcome.Rename,"rename");
        Check((await writer.ApplyAsync(a,rename with {OperationId=Guid.NewGuid()},CancellationToken.None)).Outcome==TaskWriteOutcome.Conflict,"stale revision");
        Check((await writer.ApplyAsync(b,rename with {OperationId=Guid.NewGuid(),ExpectedRevision=2},CancellationToken.None)).Outcome==TaskWriteOutcome.NotFound,"account isolation");
        using var cancelled=new CancellationTokenSource(); cancelled.Cancel();
        try { await writer.ApplyAsync(a,rename with {OperationId=Guid.NewGuid(),ExpectedRevision=2},cancelled.Token); throw new InvalidOperationException("Cancellation ignored"); }
        catch(OperationCanceledException){}
        await using var raw=await source.OpenConnectionAsync();
        await using var forbidden=new NpgsqlCommand("DELETE FROM metis.tasks",raw);
        try { await forbidden.ExecuteNonQueryAsync(); throw new InvalidOperationException("Writer can delete"); }
        catch(PostgresException error) when(error.SqlState=="42501"){}
        Console.WriteLine("PASS PostgreSQL writer: create, replay, operation conflict, revision conflict, account RLS, cancellation and denied delete");
        return 1;
    }
    private static void Check(bool value,string message){if(!value)throw new InvalidOperationException(message);}
}
