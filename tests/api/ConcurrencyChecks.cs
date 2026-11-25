using Npgsql;
using NpgsqlTypes;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;

internal static class ConcurrencyChecks
{
    const string User = "11111111-1111-4111-8111-111111111111";
    const string Other = "22222222-2222-4222-8222-222222222222";
    static void Check(bool ok, string label) { if (!ok) throw new Exception(label); }
    static async Task<NpgsqlConnection> Open(string port, string role)
    {
        Check(int.TryParse(port, out var p) && p > 1024, "Isolated port required");
        var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder {
            Host="127.0.0.1", Port=p, Username=role, Database="postgres", Pooling=false,
            Timeout=5, CommandTimeout=15, SslMode=SslMode.Disable
        }.ConnectionString);
        await connection.OpenAsync(); return connection;
    }
    static async Task Claims(NpgsqlConnection db, string user = User)
    {
        await using var cmd = new NpgsqlCommand("SELECT set_config('request.jwt.claims',@claims,true)", db);
        cmd.Parameters.AddWithValue("claims", JsonSerializer.Serialize(new { sub=user, role="authenticated", is_anonymous=false }));
        await cmd.ExecuteNonQueryAsync();
    }
    static async Task<string> Write(NpgsqlConnection db, Guid id, Guid operation, long revision=0, string user=User)
    {
        await using var cmd = new NpgsqlCommand("SELECT outcome FROM metis.apply_workspace_write(@u,@op,@id,'note',@action,@revision,@payload)", db);
        cmd.Parameters.AddWithValue("u",Guid.Parse(user));cmd.Parameters.AddWithValue("op",operation);cmd.Parameters.AddWithValue("id",id);
        cmd.Parameters.AddWithValue("action",revision==0?"create":"update");cmd.Parameters.AddWithValue("revision",revision);
        cmd.Parameters.AddWithValue("payload",NpgsqlDbType.Jsonb,"{\"title\":\"Synthetic\",\"body\":\"Body\",\"state\":\"active\",\"pinned\":false}");
        return (string)(await cmd.ExecuteScalarAsync())!;
    }
    static async Task<long> Scalar(NpgsqlConnection db, string sql) { await using var cmd=new NpgsqlCommand(sql,db);return Convert.ToInt64(await cmd.ExecuteScalarAsync()); }
    static async Task Blocked(NpgsqlConnection observer, NpgsqlConnection waiting)
    {
        for(var i=0;i<50;i++) {
            if(await Scalar(observer,$"SELECT count(*) FROM pg_stat_activity WHERE pid={waiting.ProcessID} AND wait_event_type='Lock'")==1) return;
            await Task.Delay(50);
        }
        throw new Exception("Second writer did not wait on a real PostgreSQL lock");
    }
    public static async Task Run(string port, Func<Dictionary<string,string?>,Task<WebApplication>> start, Func<string,string> token)
    {
        await using var observer=await Open(port,"postgres");
        await using var a=await Open(port,"metis_writer");await using var b=await Open(port,"metis_writer");
        Check(a.ProcessID!=b.ProcessID,"Independent PostgreSQL backends required");
        // Hold the first change uncommitted. The second task writer uses a different row and
        // lock family, so it must wait specifically for the per-account feed head.
        await using(var first=await a.BeginTransactionAsync())
        await using(var second=await b.BeginTransactionAsync()) {
            await Claims(a);await Claims(b);Check(await Write(a,Guid.NewGuid(),Guid.NewGuid())=="applied","First mutation");
            var baseline=await Scalar(observer,"SELECT count(*) FROM metis.changes");
            await using var task=new NpgsqlCommand("SELECT outcome FROM metis.apply_task_write(@u,@op,@id,0::smallint,0::bigint,'Concurrent task',@fp::char(64))",b);
            task.Parameters.AddWithValue("u",Guid.Parse(User));task.Parameters.AddWithValue("op",Guid.NewGuid());task.Parameters.AddWithValue("id",Guid.NewGuid());task.Parameters.AddWithValue("fp",new string('A',64));
            var writing=task.ExecuteScalarAsync();await Blocked(observer,b);
            Check(await Scalar(observer,"SELECT count(*) FROM metis.changes")==baseline,"Uncommitted feed leaked");
            // Different account is independent even while this account waits.
            await using(var c=await Open(port,"metis_writer"))await using(var tx=await c.BeginTransactionAsync()) {
                await Claims(c,Other);Check(await Write(c,Guid.NewGuid(),Guid.NewGuid(),user:Other)=="applied","Cross-account progress");await tx.CommitAsync();
            }
            await first.CommitAsync();Check((string)(await writing)! == "created","Waiting write");await second.CommitAsync();
            Check(await Scalar(observer,$"SELECT count(*) FROM metis.changes WHERE user_id='{User}' AND position IN (1,2)")==2,"Commit order/feed gap");
        }
        Console.WriteLine("PASS native PostgreSQL: distinct backend locks, commit ordering, no dirty reads, independent accounts");

        await using(var rolled=await a.BeginTransactionAsync()) {await Claims(a);await Write(a,Guid.NewGuid(),Guid.NewGuid());await rolled.RollbackAsync();}
        await using(var next=await b.BeginTransactionAsync()) {await Claims(b);await Write(b,Guid.NewGuid(),Guid.NewGuid());await next.CommitAsync();}
        Check(await Scalar(observer,$"SELECT max(position) FROM metis.changes WHERE user_id='{User}'")==3,"Rollback left a cursor gap");
        Console.WriteLine("PASS native PostgreSQL: rollback reuses uncommitted feed position");

        var id=Guid.NewGuid();var operation=Guid.NewGuid();
        await using(var first=await a.BeginTransactionAsync())await using(var second=await b.BeginTransactionAsync()) {
            await Claims(a);await Claims(b);Check(await Write(a,id,operation)=="applied","Initial operation");
            var duplicate=Write(b,id,operation);await Blocked(observer,b);await first.CommitAsync();
            Check(await duplicate=="replay","Concurrent duplicate must replay");await second.CommitAsync();
        }
        Check(await Scalar(observer,$"SELECT count(*) FROM metis.changes WHERE user_id='{User}' AND entity_id='{id}'")==1,"Duplicate feed entry");
        await using(var first=await a.BeginTransactionAsync())await using(var second=await b.BeginTransactionAsync()) {
            await Claims(a);await Claims(b);Check(await Write(a,id,Guid.NewGuid(),1)=="applied","First revision update");
            var conflict=Write(b,id,Guid.NewGuid(),1);await Blocked(observer,b);await first.CommitAsync();
            Check(await conflict=="conflict","Concurrent revision must conflict");await second.CommitAsync();
        }
        Console.WriteLine("PASS native PostgreSQL: concurrent operation replay and stale revision conflict without duplicate writes");

        await using(var reader=await Open(port,"metis_reader")) {
            await using(var tx=await reader.BeginTransactionAsync()) {await Claims(reader,Other);
                Check(await Scalar(reader,$"SELECT count(*) FROM metis.changes WHERE user_id='{User}'")==0,"Cross-account RLS leak");await tx.CommitAsync();}
            Check(await Scalar(reader,"SELECT count(*) FROM metis.changes")==0,"Claims leaked past transaction");
        }
        Console.WriteLine("PASS native PostgreSQL: RLS and transaction claim cleanup");
        await Http(port,start,token);
    }
    static Dictionary<string,string?> Settings(string port)
    {
        var settings=new Dictionary<string,string?>();
        foreach(var prefix in new[]{"CentralTasks","CentralTaskWriter"}) {
            settings[prefix+":Provider"]="PostgreSql";settings[prefix+":Host"]="127.0.0.1";settings[prefix+":Port"]=port;
            settings[prefix+":Username"]=prefix=="CentralTasks"?"metis_reader":"metis_writer";settings[prefix+":Password"]="synthetic";
            settings[prefix+":ProjectRef"]="test-project";settings[prefix+":AllowLocalDevelopment"]="true";
        }
        return settings;
    }
    // Test-only stdin bridge joins two real native SQLite processes to the actual API pipeline.
    // Tokens stay inside this process; only synthetic fixture operations cross the bridge.
    public static async Task Bridge(string port,Func<Dictionary<string,string?>,Task<WebApplication>> start,Func<string,string> token)
    {
        await using var app=await start(Settings(port));using var client=app.GetTestClient();
        while(await Console.In.ReadLineAsync() is { } line) {
            if(line.Length>200000)throw new Exception("Bridge request too large");
            using var input=JsonDocument.Parse(line);var root=input.RootElement;var cmd=root.GetProperty("cmd").GetString();
            if(cmd=="exit")return;
            try {
                var user=root.TryGetProperty("other",out var other)&&other.GetBoolean()?Other:User;
                using var request=new HttpRequestMessage();request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));
                if(cmd=="feed") {
                    request.Method=HttpMethod.Get;
                    var cursor=root.GetProperty("cursor").GetString()??"";
                    request.RequestUri=new Uri("/api/v1/sync/changes"+(cursor.Length>0?"?cursor="+Uri.EscapeDataString(cursor):""),UriKind.Relative);
                } else if(cmd=="write") {
                    var op=root.GetProperty("operation");request.Method=HttpMethod.Post;
                    request.RequestUri=new Uri($"/api/v1/workspace/{op.GetProperty("entity").GetString()}/{op.GetProperty("id").GetString()}/operations",UriKind.Relative);
                    request.Content=new StringContent(JsonSerializer.Serialize(new {operationId=op.GetProperty("operationId").GetString(),action=op.GetProperty("action").GetString(),expectedRevision=op.GetProperty("expectedRevision").GetInt64(),payload=op.GetProperty("payload")}),System.Text.Encoding.UTF8,"application/json");
                } else throw new Exception("Unknown bridge command");
                using var response=await client.SendAsync(request);
                var body=JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
                object result;
                if(cmd=="write" && response.StatusCode==HttpStatusCode.Conflict && body.GetProperty("code").GetString()=="workspace_conflict") result=new{outcome="conflict"};
                else {
                    Check(response.IsSuccessStatusCode,"Synthetic bridge HTTP "+(int)response.StatusCode);
                    result=cmd=="feed"?(object)body:new {outcome=body.GetProperty("replay").GetBoolean()?"replay":"applied",applied_revision=body.GetProperty("revision").GetInt64()};
                }
                Console.WriteLine("METIS_RESULT:"+JsonSerializer.Serialize(new{ok=true,value=result}));
            } catch(Exception e) {Console.WriteLine("METIS_RESULT:"+JsonSerializer.Serialize(new{ok=false,error=e.Message}));}
        }
    }
    static async Task Http(string port,Func<Dictionary<string,string?>,Task<WebApplication>> start,Func<string,string> token)
    {
        await using var app=await start(Settings(port));using var clientA=app.GetTestClient();using var clientB=app.GetTestClient();
        async Task<JsonElement> Send(HttpClient client,string path,object? body,HttpStatusCode expected,string user=User) {
            using var request=new HttpRequestMessage(body is null?HttpMethod.Get:HttpMethod.Post,path);
            request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));if(body is not null)request.Content=new StringContent(JsonSerializer.Serialize(body),System.Text.Encoding.UTF8,"application/json");
            using var response=await client.SendAsync(request);Check(response.StatusCode==expected,$"HTTP {path}: {response.StatusCode}, expected {expected}");
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
        }
        object Op(string action,long revision,object payload,string? operation=null)=>new{operationId=operation??Guid.NewGuid().ToString("N"),action,expectedRevision=revision,payload};
        var records=new (string kind,object payload)[]{
            ("note",new{title="HTTP note",body="Offline draft",state="active",pinned=false}),
            ("project",new{title="HTTP project",body="",state="active",pinned=false}),
            ("goal",new{title="HTTP goal",description="",state="active",targetDate=(string?)null,progress=0}),
            ("event",new{title="HTTP event",details="",eventDate="2028-02-29",startTime=(string?)null,endTime=(string?)null}),
            ("finance",new{title="Synthetic entry",direction="expense",category="Synthetic",amountCents=123,entryDate="2028-02-29",currency="TRY"}),
            ("budget",new{month="2028-02",category="Synthetic",limitCents=500,currency="TRY"})
        };
        foreach(var (kind,payload) in records) {
            var key=Guid.NewGuid().ToString("N");var path=$"/api/v1/workspace/{kind}/{key}/operations";var body=Op("create",0,payload);
            await Send(clientA,path,body,HttpStatusCode.OK);
            Check((await Send(clientB,path,body,HttpStatusCode.OK)).GetProperty("replay").GetBoolean(),"HTTP replay missing");
            var page=await Send(clientB,"/api/v1/sync/changes",null,HttpStatusCode.OK);
            Check(page.GetProperty("items").EnumerateArray().Any(x=>x.GetProperty("entityId").GetString()!.Replace("-","")==key),"Second HTTP client cannot read mutation");
            await Send(clientB,path,Op("update",1,payload),HttpStatusCode.OK);
            await Send(clientA,path,Op("update",1,payload),HttpStatusCode.Conflict);
            await Send(clientA,path,Op("delete",2,new{}),HttpStatusCode.NotFound,Other);
            await Send(clientB,path,Op("delete",2,new{}),HttpStatusCode.OK);
        }
        var task=Guid.NewGuid().ToString("N");var createTask=new{operationId=Guid.NewGuid().ToString("N"),taskId=task,title="HTTP task"};
        await Send(clientA,"/api/v1/tasks",createTask,HttpStatusCode.Created);
        await Send(clientB,"/api/v1/tasks/"+task,null,HttpStatusCode.OK);
        await Send(clientB,"/api/v1/tasks/"+task,null,HttpStatusCode.NotFound,Other);
        Console.WriteLine("PASS two HTTP clients: seven modules, receipts, revision conflicts, tombstones and account isolation on native PostgreSQL");
    }
}
