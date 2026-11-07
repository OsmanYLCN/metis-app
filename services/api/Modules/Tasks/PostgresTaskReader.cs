using System.Data;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Npgsql;
using NpgsqlTypes;

namespace PersonalOS.Api.Modules.Tasks;

public sealed class PostgresTaskReader : ITaskReader, IAsyncDisposable
{
    private readonly NpgsqlDataSource source;
    private readonly string projectRef;
    public PostgresTaskReader(IOptions<CentralTaskOptions> options)
    {
        projectRef = options.Value.ProjectRef;
        source = new NpgsqlDataSourceBuilder(options.Value.ConnectionString()).Build();
    }
    public bool IsConfigured => true;
    public async ValueTask<bool> CanReadAsync(Guid account, CancellationToken cancellationToken)
    {
        try { await ListAsync(account, null, 1, cancellationToken); return true; }
        catch (TaskStoreUnavailableException) { return false; }
    }
    public ValueTask<IReadOnlyList<TaskRecord>> ListAsync(Guid account, Guid? after, int take, CancellationToken cancellationToken)
    {
        if (take is < 1 or > 101) throw new ArgumentOutOfRangeException(nameof(take));
        return Read(account, null, after, take, cancellationToken);
    }
    public async ValueTask<TaskRecord?> FindAsync(Guid account, Guid id, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) throw new ArgumentException("A task ID is required.", nameof(id));
        return (await Read(account, id, null, 1, cancellationToken)).SingleOrDefault();
    }
    private async ValueTask<IReadOnlyList<TaskRecord>> Read(Guid account, Guid? id, Guid? after, int take, CancellationToken cancellationToken)
    {
        if (account == Guid.Empty) throw new ArgumentException("A verified account is required.", nameof(account));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        var cancel = deadline.Token;
        try
        {
            await using var connection = await source.OpenConnectionAsync(cancel);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancel);
            await using (var setup = new NpgsqlCommand("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL row_security=on", connection, transaction))
                await setup.ExecuteNonQueryAsync(cancel);
            // Verify the login role itself; never elevate with SET ROLE or accept an owner/BYPASSRLS connection.
            await using (var guard = new NpgsqlCommand("""
                SELECT current_user = 'metis_reader' AND session_user = 'metis_reader'
                  AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole
                  AND NOT r.rolcreatedb AND NOT r.rolreplication
                  AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
                  AND c.relowner <> r.oid AND c.relrowsecurity AND c.relforcerowsecurity
                  AND has_table_privilege(current_user,'metis.tasks','SELECT')
                  AND NOT has_table_privilege(current_user,'metis.tasks','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_any_column_privilege(current_user,'metis.tasks','INSERT,UPDATE')
                  AND EXISTS (SELECT 1 FROM metis.schema_migrations WHERE version=2 AND name='task_reader')
                  AND EXISTS (SELECT 1 FROM metis.installation WHERE id=1 AND project_ref=$1)
                FROM pg_roles r CROSS JOIN pg_class c
                WHERE r.rolname=current_user AND c.oid='metis.tasks'::regclass
                """, connection, transaction))
            {
                guard.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = projectRef });
                if (await guard.ExecuteScalarAsync(cancel) is not true) throw new TaskStoreUnavailableException();
            }
            // Transaction-local, parameterized claims: rollback/commit clears them before pool reuse.
            await using (var claims = new NpgsqlCommand("SELECT set_config('request.jwt.claims',$1,true)", connection, transaction))
            {
                claims.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text,
                    Value = JsonSerializer.Serialize(new { sub = account.ToString(), role = "authenticated", is_anonymous = false }) });
                await claims.ExecuteScalarAsync(cancel);
            }
            await using var command = new NpgsqlCommand("""
                SELECT id,user_id,title,completed,revision,created_at,updated_at,deleted_at
                FROM metis.tasks WHERE user_id=$1 AND deleted_at IS NULL
                  AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR id>$3)
                ORDER BY id LIMIT $4
                """, connection, transaction);
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = account });
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)id ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)after ?? DBNull.Value });
            command.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = take });
            var rows = new List<TaskRecord>();
            await using (var reader = await command.ExecuteReaderAsync(cancel))
            {
                while (await reader.ReadAsync(cancel))
                    rows.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetBoolean(3), reader.GetInt64(4),
                        reader.GetFieldValue<DateTimeOffset>(5), reader.GetFieldValue<DateTimeOffset>(6),
                        reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7)));
            }
            await transaction.CommitAsync(cancel);
            return rows;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is NpgsqlException or TimeoutException or OperationCanceledException or InvalidCastException)
        {
            // Never propagate/log server details, parameters, passwords or the connection string.
            throw new TaskStoreUnavailableException();
        }
    }
    public ValueTask DisposeAsync() => source.DisposeAsync();
}
