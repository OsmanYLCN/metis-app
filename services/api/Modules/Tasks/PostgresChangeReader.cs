using System.Data;
using System.Globalization;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace PersonalOS.Api.Modules.Tasks;

public sealed partial class PostgresTaskReader
{
    public async ValueTask<ChangePage> ReadChangesAsync(Guid account, ChangeCursor? cursor, int limit, CancellationToken cancellationToken)
    {
        if (account == Guid.Empty || limit is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(limit));
        if (cursor is not null && (cursor.Account != account || cursor.Position < 0)) throw new ChangeCursorException();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        var cancel = deadline.Token;
        try
        {
            await using var connection = await source.OpenConnectionAsync(cancel);
            // Head and rows share one committed snapshot, even while writers commit new pages.
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancel);
            await using (var setup = new NpgsqlCommand("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1500ms'; SET LOCAL row_security=on", connection, transaction))
                await setup.ExecuteNonQueryAsync(cancel);
            await using (var guard = new NpgsqlCommand("""
                SELECT current_user='metis_reader' AND session_user='metis_reader'
                  AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication
                  AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
                  AND (SELECT count(*)=2 AND bool_and(c.relowner<>r.oid AND c.relrowsecurity AND c.relforcerowsecurity)
                      FROM pg_class c WHERE c.oid IN ('metis.changes'::regclass,'metis.change_heads'::regclass))
                  AND NOT has_table_privilege(current_user,'metis.changes','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_any_column_privilege(current_user,'metis.changes','INSERT,UPDATE')
                  AND NOT has_table_privilege(current_user,'metis.change_heads','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_any_column_privilege(current_user,'metis.change_heads','INSERT,UPDATE')
                  AND NOT has_table_privilege(current_user,'metis.change_feed_config','INSERT,UPDATE,DELETE,TRUNCATE')
                  AND NOT has_any_column_privilege(current_user,'metis.change_feed_config','INSERT,UPDATE')
                  AND EXISTS(SELECT 1 FROM metis.schema_migrations WHERE version=6 AND name='change_feed')
                  AND EXISTS(SELECT 1 FROM metis.installation WHERE id=1 AND project_ref=$1)
                FROM pg_roles r WHERE r.rolname=current_user
                """, connection, transaction))
            {
                guard.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Text, Value=projectRef });
                if (await guard.ExecuteScalarAsync(cancel) is not true) throw new TaskStoreUnavailableException();
            }
            await using (var claims = new NpgsqlCommand("SELECT set_config('request.jwt.claims',$1,true)", connection, transaction))
            {
                claims.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Text, Value=JsonSerializer.Serialize(new{sub=account.ToString(),role="authenticated",is_anonymous=false}) });
                await claims.ExecuteScalarAsync(cancel);
            }
            Guid epoch;
            long head;
            await using (var state = new NpgsqlCommand("SELECT epoch,coalesce((SELECT position FROM metis.change_heads WHERE user_id=$1),0) FROM metis.change_feed_config WHERE id=1",connection,transaction))
            {
                state.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Uuid, Value=account });
                await using var row=await state.ExecuteReaderAsync(cancel);
                if (!await row.ReadAsync(cancel)) throw new TaskStoreUnavailableException();
                epoch=row.GetGuid(0); head=row.GetInt64(1);
            }
            if (cursor is not null && (cursor.Epoch!=epoch || cursor.Position>head)) throw new ChangeCursorException();
            var position=cursor?.Position ?? 0;
            var items=new List<ChangeItem>();
            await using (var query = new NpgsqlCommand("SELECT position,entity,entity_id,revision,deleted,snapshot::text FROM metis.changes WHERE user_id=$1 AND position>$2 AND position<=$3 ORDER BY position LIMIT $4",connection,transaction))
            {
                query.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Uuid, Value=account });
                query.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Bigint, Value=position });
                query.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Bigint, Value=head });
                query.Parameters.Add(new NpgsqlParameter { NpgsqlDbType=NpgsqlDbType.Integer, Value=limit });
                await using var rows=await query.ExecuteReaderAsync(cancel);
                while(await rows.ReadAsync(cancel))
                {
                    var next=rows.GetInt64(0);
                    if(next!=position+1) throw new TaskStoreUnavailableException();
                    position=next;
                    using var document=JsonDocument.Parse(rows.GetString(5));
                    items.Add(new(position.ToString(CultureInfo.InvariantCulture),rows.GetString(1),rows.GetGuid(2).ToString(),rows.GetInt64(3),rows.GetBoolean(4),document.RootElement.Clone()));
                }
            }
            if (items.Count<limit && position!=head) throw new TaskStoreUnavailableException();
            await transaction.CommitAsync(cancel);
            return new(1,items,new ChangeCursor(epoch,account,position).ToString(),position<head);
        }
        catch(OperationCanceledException) when(cancellationToken.IsCancellationRequested) { throw; }
        catch(Exception error) when(error is NpgsqlException or TimeoutException or OperationCanceledException or InvalidCastException or JsonException)
        { throw new TaskStoreUnavailableException(); }
    }
}
