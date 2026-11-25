using Microsoft.Extensions.Configuration;
using Npgsql;
using System.Text.RegularExpressions;

// Explicit opt-in, metadata-only production preflight. No account claims, rows or secrets printed.
internal static class LiveReadinessChecks
{
    public static async Task<int> Run()
    {
        var config=new ConfigurationBuilder().AddUserSecrets("metis-local-api").Build();
        var ok=true;
        string? project=null;
        foreach(var (section,role) in new[]{("CentralTasks","metis_reader"),("CentralTaskWriter","metis_writer")}) {
            var c=config.GetSection(section);var reference=c["ProjectRef"]??"";var host=c["Host"]??"";
            var direct=host==$"db.{reference}.supabase.co" && c["Username"]==role;
            var pool=Regex.IsMatch(host,@"^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$") && c["Username"]==$"{role}.{reference}";
            if(c["Provider"]!="PostgreSql" || !Regex.IsMatch(reference,"^[a-z0-9][a-z0-9-]{0,62}$") || (!direct&&!pool)
                || c["Port"]!="5432" || c["Database"]!="postgres" || string.IsNullOrEmpty(c["Password"]) || c["AllowLocalDevelopment"]=="true") {
                Console.WriteLine(section+": configuration missing or unsafe; no connection attempted.");ok=false;continue;
            }
            if(project is not null && project!=reference){Console.WriteLine(section+": project mismatch; no connection attempted.");ok=false;continue;}
            project=reference;
            try {
                var settings=new NpgsqlConnectionStringBuilder{Host=host,Port=5432,Database="postgres",Username=c["Username"],Password=c["Password"],
                    SslMode=SslMode.VerifyFull,GssEncryptionMode=GssEncryptionMode.Disable,RootCertificate=string.IsNullOrWhiteSpace(c["RootCertificate"])?null:c["RootCertificate"],
                    Pooling=false,Timeout=8,CommandTimeout=5,IncludeErrorDetail=false,LogParameters=false,PersistSecurityInfo=false,ApplicationName="Metis.MetadataReadiness"};
                await using var db=new NpgsqlConnection(settings.ConnectionString);await db.OpenAsync();await using var tx=await db.BeginTransactionAsync();
                await using(var setup=new NpgsqlCommand("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s'",db))await setup.ExecuteNonQueryAsync();
                await using(var guard=new NpgsqlCommand("SELECT current_user=@role AND session_user=@role AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication FROM pg_roles WHERE rolname=current_user",db)) {
                    guard.Parameters.AddWithValue("role",role);if(await guard.ExecuteScalarAsync() is not true)throw new InvalidOperationException();
                }
                if(role=="metis_reader") {
                    await using(var installation=new NpgsqlCommand("SELECT count(*)=1 FROM metis.installation WHERE id=1 AND project_ref=@project",db)){
                        installation.Parameters.AddWithValue("project",reference);if(await installation.ExecuteScalarAsync() is not true)throw new InvalidOperationException();
                    }
                    await using var versions=new NpgsqlCommand("SELECT version FROM metis.schema_migrations WHERE version BETWEEN 1 AND 9 ORDER BY version",db);
                    var present=new HashSet<int>();await using(var reader=await versions.ExecuteReaderAsync())while(await reader.ReadAsync())present.Add(reader.GetInt32(0));
                    var missing=Enumerable.Range(1,9).Where(v=>!present.Contains(v)).ToArray();
                    if(missing.Length>0){Console.WriteLine("CentralTasks: missing migrations "+string.Join(", ",missing.Select(v=>v.ToString("0000"))));ok=false;}
                    else Console.WriteLine("CentralTasks: verified TLS, restricted reader, matching installation, migrations 0001–0009 present.");
                } else {
                    await using var functions=new NpgsqlCommand("SELECT has_function_privilege(current_user,to_regprocedure('metis.apply_workspace_write(uuid,uuid,uuid,text,text,bigint,jsonb)'),'EXECUTE') AND has_function_privilege(current_user,to_regprocedure('metis.apply_task_plan(uuid,uuid,uuid,text,text,bigint,jsonb)'),'EXECUTE')",db);
                    if(await functions.ExecuteScalarAsync() is not true){Console.WriteLine("CentralTaskWriter: workspace/taskPlan functions or permissions missing.");ok=false;}
                    else Console.WriteLine("CentralTaskWriter: verified TLS, restricted writer, workspace/taskPlan permissions present.");
                }
                await tx.RollbackAsync();
            } catch(Exception e) when(e is NpgsqlException or InvalidOperationException or System.IO.IOException or System.Security.Cryptography.CryptographicException) {
                Console.WriteLine(section+": could not verify connection/role (details and credentials suppressed).");ok=false;
            }
        }
        Console.WriteLine("Read-only metadata check; no user records read or changed. This is not two-device acceptance.");return ok?0:1;
    }
}
