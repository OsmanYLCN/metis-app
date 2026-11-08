using System.Data;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Microsoft.Extensions.Options;

namespace PersonalOS.Api.Modules.Tasks;

public sealed class PostgresTaskWriter : ITaskWriter, IAsyncDisposable
{
    private readonly NpgsqlDataSource source;
    private readonly string projectRef;
    private readonly bool ownsSource;

    public PostgresTaskWriter(IOptions<CentralTaskWriterOptions> options)
    {
        projectRef = options.Value.ProjectRef;
        source = new NpgsqlDataSourceBuilder(options.Value.ConnectionString()).Build();
        ownsSource = true;
    }

    public PostgresTaskWriter(NpgsqlDataSource source, string projectRef)
    {
        this.source = source;
        this.projectRef = projectRef;
    }

    public bool IsConfigured => true;

    public async ValueTask<TaskWriteDecision> ApplyAsync(Guid account, TaskWriteCommand command, CancellationToken cancellationToken)
    {
        var now=DateTimeOffset.UnixEpoch;
        var validationRow=command.Kind==TaskWriteKind.Rename
            ? new TaskRecord(command.TaskId,account,"validation",false,command.ExpectedRevision,now,now,null) : null;
        var validated = TaskWriteRules.Decide(account, command, validationRow, null);
        if (validated.Outcome is not (TaskWriteOutcome.Create or TaskWriteOutcome.Rename)) return validated;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        var cancel = deadline.Token;
        try
        {
            await using var connection = await source.OpenConnectionAsync(cancel);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancel);
            await using (var setup = new NpgsqlCommand("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL row_security=on",connection,transaction))
                await setup.ExecuteNonQueryAsync(cancel);
            await using (var guard = new NpgsqlCommand("""
                SELECT current_user='metis_writer' AND session_user='metis_writer'
                  AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
                  AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
                  AND t.relowner<>r.oid AND o.relowner<>r.oid AND t.relrowsecurity AND t.relforcerowsecurity AND o.relrowsecurity AND o.relforcerowsecurity
                  AND has_table_privilege(current_user,'metis.tasks','SELECT')
                  AND has_column_privilege(current_user,'metis.tasks','title','UPDATE')
                  AND has_column_privilege(current_user,'metis.tasks','user_id','INSERT')
                  AND has_column_privilege(current_user,'metis.tasks','id','INSERT')
                  AND has_column_privilege(current_user,'metis.tasks','title','INSERT')
                  AND NOT has_table_privilege(current_user,'metis.tasks','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','user_id','UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','id','UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','completed','INSERT,UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','revision','INSERT,UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','created_at','INSERT,UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','updated_at','INSERT,UPDATE')
                  AND NOT has_column_privilege(current_user,'metis.tasks','deleted_at','INSERT,UPDATE')
                  AND has_table_privilege(current_user,'metis.task_operations','SELECT')
                  AND NOT has_table_privilege(current_user,'metis.task_operations','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_any_column_privilege(current_user,'metis.task_operations','UPDATE')
                  AND has_function_privilege(current_user,'metis.apply_task_write(uuid,uuid,uuid,smallint,bigint,text,character)','EXECUTE')
                  AND NOT has_schema_privilege(current_user,'auth','USAGE')
                  AND EXISTS(SELECT 1 FROM metis.schema_migrations WHERE version=4 AND name='task_writer_claims')
                  AND EXISTS(SELECT 1 FROM metis.installation WHERE id=1 AND project_ref=$1)
                FROM pg_roles r CROSS JOIN pg_class t CROSS JOIN pg_class o
                WHERE r.rolname=current_user AND t.oid='metis.tasks'::regclass AND o.oid='metis.task_operations'::regclass
                """,connection,transaction))
            {
                guard.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Text,Value=projectRef });
                if (await guard.ExecuteScalarAsync(cancel) is not true) throw new TaskStoreUnavailableException();
            }
            await using (var claims = new NpgsqlCommand("SELECT set_config('request.jwt.claims',$1,true)",connection,transaction))
            {
                claims.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Text,Value=JsonSerializer.Serialize(new{sub=account.ToString(),role="authenticated",is_anonymous=false}) });
                await claims.ExecuteScalarAsync(cancel);
            }
            await using var apply = new NpgsqlCommand("SELECT outcome,applied_revision FROM metis.apply_task_write($1,$2,$3,$4,$5,$6,$7)",connection,transaction);
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Uuid,Value=account });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Uuid,Value=command.OperationId });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Uuid,Value=command.TaskId });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Smallint,Value=(short)command.Kind });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Bigint,Value=command.ExpectedRevision });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Text,Value=validated.Title! });
            apply.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Char,Value=validated.Fingerprint! });
            await using var reader=await apply.ExecuteReaderAsync(cancel);
            if (!await reader.ReadAsync(cancel)) throw new TaskStoreUnavailableException();
            var outcome=reader.GetString(0) switch {"created"=>TaskWriteOutcome.Create,"renamed"=>TaskWriteOutcome.Rename,"replay"=>TaskWriteOutcome.Replay,
                "invalid"=>TaskWriteOutcome.Invalid,"not_found"=>TaskWriteOutcome.NotFound,"conflict"=>TaskWriteOutcome.Conflict,
                "operation_conflict"=>TaskWriteOutcome.OperationConflict,_=>TaskWriteOutcome.Unavailable};
            long? revision=reader.IsDBNull(1)?null:reader.GetInt64(1);
            await reader.DisposeAsync();
            if (outcome==TaskWriteOutcome.Unavailable) throw new TaskStoreUnavailableException();
            await transaction.CommitAsync(cancel);
            return new(outcome,AppliedRevision:revision);
        }
        catch(OperationCanceledException) when(cancellationToken.IsCancellationRequested){throw;}
        catch(Exception error) when(error is NpgsqlException or TimeoutException or OperationCanceledException or InvalidCastException){throw new TaskStoreUnavailableException();}
    }

    public ValueTask DisposeAsync() => ownsSource ? source.DisposeAsync() : ValueTask.CompletedTask;
}
