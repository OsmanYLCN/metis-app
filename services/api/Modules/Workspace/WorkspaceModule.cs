using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Npgsql;
using NpgsqlTypes;
using PersonalOS.Api.Modules.Tasks;

namespace PersonalOS.Api.Modules.Workspace;

public sealed record WorkspaceOperation(string OperationId, string Action, long ExpectedRevision, JsonElement Payload);
public sealed record WorkspaceReceipt(string Outcome, long? Revision);
public static class WorkspaceModule
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow, MaxDepth=8 };
    public static IServiceCollection AddWorkspace(this IServiceCollection services) => services.AddSingleton<WorkspaceWriter>();
    public static IEndpointRouteBuilder MapWorkspace(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGroup("/api/v1/workspace").AddEndpointFilter<TaskAccountFilter>()
            .MapPost("/{kind}/{id}/operations", Apply);
        return endpoints;
    }
    public static bool Valid(string kind, WorkspaceOperation op)
    {
        if((kind is not ("note" or "project") && !DomainPayload.IsKind(kind)) || !Guid.TryParseExact(op.OperationId,"N",out var operation) || operation==Guid.Empty
            || op.Action is not ("create" or "update" or "delete")
            || (op.Action=="create" ? op.ExpectedRevision!=0 : op.ExpectedRevision<1)
            || op.Payload.ValueKind!=JsonValueKind.Object) return false;
        var props=op.Payload.EnumerateObject().ToArray();
        if(op.Action=="delete") return props.Length==0;
        if(DomainPayload.IsKind(kind)) return DomainPayload.Valid(kind,op.Payload);
        if(props.Length!=4 || props.Select(p=>p.Name).Distinct().Count()!=4
            || props.Any(p=>p.Name is not ("title" or "body" or "state" or "pinned"))) return false;
        if(op.Payload.GetProperty("title").ValueKind!=JsonValueKind.String || op.Payload.GetProperty("body").ValueKind!=JsonValueKind.String
            || op.Payload.GetProperty("state").ValueKind!=JsonValueKind.String || op.Payload.GetProperty("pinned").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        var title=op.Payload.GetProperty("title").GetString()!; var body=op.Payload.GetProperty("body").GetString()!;
        var state=op.Payload.GetProperty("state").GetString();var pinned=op.Payload.GetProperty("pinned").GetBoolean();
        try { var utf8=new UTF8Encoding(false,true); utf8.GetByteCount(title);utf8.GetByteCount(body); }
        catch(EncoderFallbackException) { return false; }
        return title.Length>0 && title==title.Trim() && title.EnumerateRunes().Count()<=200 && !title.Any(char.IsControl)
            && body.EnumerateRunes().Count()<=20000 && !body.Any(c=>char.IsControl(c) && c is not ('\n' or '\r' or '\t'))
            && (kind=="note" ? state=="active" : !pinned && state is "active" or "paused" or "done");
    }
    private static async Task<IResult> Apply(string kind,string id,HttpContext context,WorkspaceWriter writer)
    {
        if(context.Request.Query.Count!=0 || !Guid.TryParseExact(id,"N",out var entity) || entity==Guid.Empty
            || context.Request.ContentType?.Split(';')[0].Trim()!="application/json") return Invalid();
        WorkspaceOperation? op;
        try
        {
            // Bound actual bytes, including chunked requests, before parsing JSON.
            var bytes=new byte[131073];var count=0;
            while(count<bytes.Length) { var read=await context.Request.Body.ReadAsync(bytes.AsMemory(count),context.RequestAborted);if(read==0)break;count+=read; }
            if(count>131072) return Invalid();
            op=JsonSerializer.Deserialize<WorkspaceOperation>(bytes.AsSpan(0,count),Json);
            if(op is null || !Valid(kind,op)) return Invalid();
        }
        catch(Exception e) when(e is JsonException or ArgumentException or InvalidOperationException) { return Invalid(); }
        try
        {
            var result=await writer.Apply(context.Features.Get<VerifiedTaskAccount>()!.Id,entity,kind,op,context.RequestAborted);
            return result.Outcome switch {
                "applied" or "replay" => Results.Ok(new { operationId=op.OperationId, id, kind, revision=result.Revision, replay=result.Outcome=="replay" }),
                "invalid" => Invalid(), "not_found" => Results.NotFound(new {code="workspace_not_found"}),
                "conflict" or "operation_conflict" => Results.Conflict(new {code="workspace_"+result.Outcome}),
                _ => Unavailable()
            };
        }
        catch(TaskStoreUnavailableException) { return Unavailable(); }
    }
    private static IResult Invalid()=>Results.BadRequest(new {code="invalid_workspace_write"});
    private static IResult Unavailable()=>Results.Json(new {code="workspace_store_unavailable"},statusCode:503);
}

public sealed class WorkspaceWriter : IAsyncDisposable
{
    private readonly NpgsqlDataSource? source;
    private readonly string project;
    public WorkspaceWriter(IOptions<CentralTaskWriterOptions> options)
    {
        project=options.Value.ProjectRef;
        if(options.Value.Provider=="PostgreSql") source=NpgsqlDataSource.Create(options.Value.ConnectionString());
    }
    public async ValueTask<WorkspaceReceipt> Apply(Guid account,Guid id,string kind,WorkspaceOperation op,CancellationToken cancellationToken)
    {
        if(source is null) throw new TaskStoreUnavailableException();
        if(account==Guid.Empty || id==Guid.Empty || !WorkspaceModule.Valid(kind,op)) return new("invalid",null);
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);deadline.CancelAfter(TimeSpan.FromSeconds(8));var ct=deadline.Token;
        try
        {
            await using var connection=await source.OpenConnectionAsync(ct);
            await using var tx=await connection.BeginTransactionAsync(ct);
            await using(var setup=new NpgsqlCommand("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL row_security=on",connection,tx)) await setup.ExecuteNonQueryAsync(ct);
            // These identifiers are selected from server constants, never from route text.
            var domain=DomainPayload.IsKind(kind);
            var entries=domain?"domain_records":"workspace_entries";
            var operations=domain?"domain_operations":"workspace_operations";
            var version=domain?8:7;
            var migration=domain?"domain_records":"workspace";
            await using(var guard=new NpgsqlCommand($"""
                SELECT current_user='metis_writer' AND session_user='metis_writer'
                AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
                AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
                AND (SELECT count(*)=2 AND bool_and(c.relowner<>r.oid AND c.relrowsecurity AND c.relforcerowsecurity)
                    FROM pg_class c WHERE c.oid IN ('metis.{entries}'::regclass,'metis.{operations}'::regclass))
                AND NOT has_table_privilege(current_user,'metis.{entries}','INSERT,UPDATE,DELETE,TRUNCATE')
                AND NOT has_any_column_privilege(current_user,'metis.{entries}','INSERT,UPDATE')
                AND NOT has_table_privilege(current_user,'metis.{operations}','INSERT,UPDATE,DELETE,TRUNCATE')
                AND NOT has_any_column_privilege(current_user,'metis.{operations}','INSERT,UPDATE')
                AND EXISTS(SELECT 1 FROM metis.schema_migrations WHERE version={version} AND name='{migration}')
                AND EXISTS(SELECT 1 FROM metis.installation WHERE id=1 AND project_ref=$1)
                FROM pg_roles r WHERE r.rolname=current_user
                """,connection,tx))
            {
                guard.Parameters.AddWithValue(NpgsqlDbType.Text,project);
                if(await guard.ExecuteScalarAsync(ct) is not true)throw new TaskStoreUnavailableException();
            }
            await using(var claims=new NpgsqlCommand("SELECT set_config('request.jwt.claims',$1,true)",connection,tx))
            {
                claims.Parameters.AddWithValue(NpgsqlDbType.Text,JsonSerializer.Serialize(new{sub=account.ToString(),role="authenticated",is_anonymous=false}));
                await claims.ExecuteScalarAsync(ct);
            }
            await using var command=new NpgsqlCommand(domain
                ? "SELECT outcome,applied_revision FROM metis.apply_domain_write($1,$2,$3,$4,$5,$6,$7)"
                : "SELECT outcome,applied_revision FROM metis.apply_workspace_write($1,$2,$3,$4,$5,$6,$7)",connection,tx);
            command.Parameters.AddWithValue(NpgsqlDbType.Uuid,account);command.Parameters.AddWithValue(NpgsqlDbType.Uuid,Guid.ParseExact(op.OperationId,"N"));
            command.Parameters.AddWithValue(NpgsqlDbType.Uuid,id);command.Parameters.AddWithValue(NpgsqlDbType.Text,kind);command.Parameters.AddWithValue(NpgsqlDbType.Text,op.Action);
            command.Parameters.AddWithValue(NpgsqlDbType.Bigint,op.ExpectedRevision);command.Parameters.AddWithValue(NpgsqlDbType.Jsonb,op.Payload.GetRawText());
            WorkspaceReceipt result;
            await using(var row=await command.ExecuteReaderAsync(ct)) {
                if(!await row.ReadAsync(ct))throw new TaskStoreUnavailableException();
                result=new(row.GetString(0),row.IsDBNull(1)?null:row.GetInt64(1));
            }
            await tx.CommitAsync(ct);return result;
        }
        catch(OperationCanceledException) when(cancellationToken.IsCancellationRequested) { throw; }
        catch(Exception e) when(e is NpgsqlException or TimeoutException or OperationCanceledException) { throw new TaskStoreUnavailableException(); }
    }
    public ValueTask DisposeAsync()=>source?.DisposeAsync() ?? ValueTask.CompletedTask;
}
