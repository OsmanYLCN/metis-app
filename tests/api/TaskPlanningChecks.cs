using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;

internal static class TaskPlanningChecks
{
 public static async Task<int> Run(string port,Func<Dictionary<string,string?>,Task<WebApplication>> start,Func<string,string> token)
 {
  const string a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
  const string task="aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",project="bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb",note="cccccccccccc4ccc8ccccccccccccccc";
  var read=Environment.GetEnvironmentVariable("METIS_TEST_PLAN_READ")=="1";
  var prefix=read?"CentralTasks":"CentralTaskWriter";
  await using var app=await start(new() {
   [prefix+":Provider"]="PostgreSql",[prefix+":Host"]="127.0.0.1",[prefix+":Port"]=port,
   [prefix+":Username"]=read?"metis_reader":"metis_writer",[prefix+":Password"]="synthetic",
   [prefix+":ProjectRef"]="test-project",[prefix+":AllowLocalDevelopment"]="true"
  });
  using var client=app.GetTestClient();
  async Task<JsonElement> Send(string path,object? body,HttpStatusCode status,string user=a) {
   using var req=new HttpRequestMessage(body is null?HttpMethod.Get:HttpMethod.Post,path);
   if(body is not null)req.Content=new StringContent(JsonSerializer.Serialize(body),System.Text.Encoding.UTF8,"application/json");
   req.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));
   using var response=await client.SendAsync(req);
   if(response.StatusCode!=status)throw new Exception($"Planning expected {status}, got {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
   return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
  }
  if(read) {
   var item=await Send("/api/v1/tasks/"+task,null,HttpStatusCode.OK);
   Check(item.GetProperty("projectId").ValueKind==JsonValueKind.Null && item.GetProperty("dueDate").GetString()=="2028-02-29" && item.GetProperty("priority").GetInt32()==3,"Read planning fields");
   Check(item.GetProperty("revision").GetInt64()==3,"Detach revision");
   await Send("/api/v1/tasks/"+task,null,HttpStatusCode.NotFound,b);
   var page=await Send("/api/v1/sync/changes",null,HttpStatusCode.OK);
   var changes=page.GetProperty("items").EnumerateArray().ToArray();
   var tasks=changes.Where(v=>v.GetProperty("entity").GetString()=="task").ToArray();
   Check(tasks.Length==3 && tasks[1].GetProperty("snapshot").GetProperty("projectId").GetString()==Guid.ParseExact(project,"N").ToString(),"Linked snapshot missing");
   Check(tasks[2].GetProperty("snapshot").GetProperty("projectId").ValueKind==JsonValueKind.Null && !tasks[2].GetProperty("deleted").GetBoolean(),"Detached task lost");
   Check(changes[^1].GetProperty("entity").GetString()=="project" && changes[^1].GetProperty("deleted").GetBoolean(),"Project tombstone order");
   Console.WriteLine("PASS task planning reads: real Npgsql task snapshot, account scope, link/detach deltas and preserved date/priority");return 1;
  }
  object Op(string action,long rev,object payload,string? operation=null)=>new {operationId=operation??Guid.NewGuid().ToString("N"),action,expectedRevision=rev,payload};
  object Plan(string? projectId=project,int priority=3,string? dueDate="2028-02-29")=>new{projectId,priority,dueDate};
  var path="/api/v1/workspace/taskPlan/"+task+"/operations";
  await Send("/api/v1/tasks",new{operationId=Guid.NewGuid().ToString("N"),taskId=task,title="Planned task"},HttpStatusCode.Created);
  await Send("/api/v1/workspace/project/"+project+"/operations",Op("create",0,new{title="Project",body="",state="active",pinned=false}),HttpStatusCode.OK);
  await Send("/api/v1/workspace/note/"+note+"/operations",Op("create",0,new{title="Note",body="",state="active",pinned=false}),HttpStatusCode.OK);
  await Send(path,Op("update",1,Plan(note)),HttpStatusCode.NotFound);
  await Send(path,Op("update",1,Plan()),HttpStatusCode.NotFound,b);
  foreach(var payload in new[]{Plan(priority:4),Plan(dueDate:"2027-02-29")})await Send(path,Op("update",1,payload),HttpStatusCode.BadRequest);
  await Send(path,Op("create",0,Plan()),HttpStatusCode.BadRequest);
  var operation=Guid.NewGuid().ToString("N");var planning=Op("update",1,Plan(),operation);
  await Send(path,planning,HttpStatusCode.OK);await Send(path,planning,HttpStatusCode.OK);
  await Send(path,Op("update",1,Plan(null)),HttpStatusCode.Conflict);
  await Send(path,Op("update",1,Plan(null),operation),HttpStatusCode.Conflict);
  var deletion=Op("delete",1,new{});
  await Send("/api/v1/workspace/project/"+project+"/operations",deletion,HttpStatusCode.OK);
  await Send("/api/v1/workspace/project/"+project+"/operations",deletion,HttpStatusCode.OK);
  await Send(path,planning,HttpStatusCode.OK); // Replay acknowledges old result, never reattaches a deleted project.
  await Send(path,Op("update",3,Plan()),HttpStatusCode.NotFound);
  Console.WriteLine("PASS task planning writes: real project ownership, revision conflict, replay, validation and safe project deletion");return 1;
 }
 private static void Check(bool condition,string message){if(!condition)throw new Exception(message);}
}

