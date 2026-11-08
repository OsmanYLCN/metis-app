using Npgsql;
using PersonalOS.Api.Modules.Tasks;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;

internal static class PostgresWriterChecks
{
    public static async Task<int> Run(string port, Func<ITaskWriter, Task<WebApplication>> start, Func<string, string> token)
    {
        var connection=new NpgsqlConnectionStringBuilder { Host="127.0.0.1",Port=int.Parse(port),Database="postgres",Username="metis_writer",
            Password="synthetic",SslMode=SslMode.Disable,Timeout=5,CommandTimeout=5,MaxPoolSize=4,NoResetOnClose=false }.ConnectionString;
        await using var source=NpgsqlDataSource.Create(connection);
        var writer=new PostgresTaskWriter(source,"test-project");
        await using(var diagnostic=await source.OpenConnectionAsync())
        {
            foreach(var (name,sql) in new (string,string)[] {
                ("identity","select current_user='metis_writer' and session_user='metis_writer'"),
                ("auth isolation","select not has_schema_privilege(current_user,'auth','USAGE')"),
                ("migration","select exists(select 1 from metis.schema_migrations where version=4 and name='task_writer_claims')"),
                ("installation","select exists(select 1 from metis.installation where id=1 and project_ref='test-project')") })
            {
                await using var command=new NpgsqlCommand(sql,diagnostic);
                Check(await command.ExecuteScalarAsync() is true,$"writer diagnostic: {name}");
            }
        }
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
        await using var app=await start(writer);
        using var client=app.GetTestClient();
        const string httpOperation="cccccccc000040008000000000000001";
        const string httpTask="dddddddd000040008000000000000001";
        var json=$"{{\"operationId\":\"{httpOperation}\",\"taskId\":\"{httpTask}\",\"title\":\"HTTP cloud task\"}}";
        using(var created=await Send(client,json,token(a.ToString())))
            Check(created.StatusCode==HttpStatusCode.Created,"HTTP create did not reach PostgreSQL writer");
        using(var replayed=await Send(client,json,token(a.ToString())))
            Check(replayed.StatusCode==HttpStatusCode.OK,"HTTP replay failed");
        Console.WriteLine("PASS PostgreSQL writer: create, replay, operation conflict, revision conflict, account RLS, cancellation, denied delete and real HTTP adapter");
        return 1;
    }
    private static async Task<HttpResponseMessage> Send(HttpClient client,string json,string token)
    {
        using var request=new HttpRequestMessage(HttpMethod.Post,"/api/v1/tasks")
        { Content=new StringContent(json,Encoding.UTF8,"application/json") };
        request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token);
        return await client.SendAsync(request);
    }
    private static void Check(bool value,string message){if(!value)throw new InvalidOperationException(message);}
}
