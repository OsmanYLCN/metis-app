using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using PersonalOS.Api.Modules.Tasks;

internal static class ChangeFeedChecks
{
    public static async Task<int> Run(string port, Func<Dictionary<string,string?>,Task<WebApplication>> start, Func<string,string> token)
    {
        const string a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222";
        await using var app=await start(new() {
            ["CentralTasks:Provider"]="PostgreSql", ["CentralTasks:Host"]="127.0.0.1", ["CentralTasks:Port"]=port,
            ["CentralTasks:Username"]="metis_reader", ["CentralTasks:Password"]="synthetic-local-password",
            ["CentralTasks:ProjectRef"]="test-project", ["CentralTasks:AllowLocalDevelopment"]="true"
        });
        using var client=app.GetTestClient();
        async Task<JsonElement> Get(string query, string? user, HttpStatusCode status)
        {
            using var request=new HttpRequestMessage(HttpMethod.Get,"/api/v1/sync/changes"+query);
            if(user is not null) request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));
            using var response=await client.SendAsync(request);
            Check(response.StatusCode==status,$"Expected {status}, got {response.StatusCode}");
            Check(response.Headers.CacheControl?.NoStore==true,"Feed must not be cached");
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
        }
        await Get("",null,HttpStatusCode.Unauthorized);
        foreach(var query in new[]{"?limit=0","?limit=101","?limit=1&limit=2","?owner="+b,"?cursor=broken"})
            await Get(query,a,HttpStatusCode.BadRequest);
        var first=await Get("?limit=1",a,HttpStatusCode.OK);
        var cursor=first.GetProperty("nextCursor").GetString()!;
        Check(first.GetProperty("items").GetArrayLength()==1 && first.GetProperty("hasMore").GetBoolean(),"First page");
        Check(first.GetProperty("items")[0].GetProperty("snapshot").GetProperty("title").GetString()=="Baseline","Baseline snapshot changed");
        await Get("?cursor="+cursor,b,HttpStatusCode.BadRequest);
        Check(ChangeCursor.TryParse(cursor,Guid.Parse(a),out var parsed),"Own cursor parse");
        await Get("?cursor="+(parsed! with {Position=long.MaxValue}),a,HttpStatusCode.Conflict);
        await Get("?cursor="+(parsed! with {Epoch=Guid.NewGuid()}),a,HttpStatusCode.Conflict);
        await Get("?cursor="+cursor+"0",a,HttpStatusCode.Conflict);
        var second=await Get("?cursor="+cursor+"&limit=1",a,HttpStatusCode.OK);
        Check(second.GetProperty("items")[0].GetProperty("snapshot").GetProperty("title").GetString()=="Updated","Delta rename missing");
        var third=await Get("?cursor="+second.GetProperty("nextCursor").GetString(),a,HttpStatusCode.OK);
        Check(third.GetProperty("items").GetArrayLength()==1 && third.GetProperty("items")[0].GetProperty("deleted").GetBoolean()
            && !third.GetProperty("hasMore").GetBoolean(),"Tombstone missing or duplicate operation");
        var tail=third.GetProperty("nextCursor").GetString();
        var empty=await Get("?cursor="+tail,a,HttpStatusCode.OK);
        Check(empty.GetProperty("items").GetArrayLength()==0 && empty.GetProperty("nextCursor").GetString()==tail,"Stable empty page");
        var other=await Get("",b,HttpStatusCode.OK);
        Check(other.GetProperty("items").GetArrayLength()==1 && other.GetProperty("items")[0].GetProperty("snapshot").GetProperty("title").GetString()=="Other account","Account isolation");
        var replay=await Get("?limit=1",a,HttpStatusCode.OK);
        Check(replay.GetProperty("nextCursor").GetString()==cursor,"Pool account context leaked");
        Console.WriteLine("PASS PostgreSQL change feed: authenticated HTTP, baseline, pagination, immutable snapshots, tombstones, account and epoch cursors, empty tail, pool isolation");
        return 1;
    }
    private static void Check(bool condition,string message) { if(!condition) throw new InvalidOperationException(message); }
}
