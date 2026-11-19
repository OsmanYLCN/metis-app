using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;

internal static class WorkspaceChecks
{
 public static async Task<int> Run(string port,Func<Dictionary<string,string?>,Task<WebApplication>> start,Func<string,string> token)
 {
  const string a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
  const string note="aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",project="bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  await using var app=await start(new() {
   ["CentralTaskWriter:Provider"]="PostgreSql",["CentralTaskWriter:Host"]="127.0.0.1",["CentralTaskWriter:Port"]=port,
   ["CentralTaskWriter:Username"]="metis_writer",["CentralTaskWriter:Password"]="synthetic",
   ["CentralTaskWriter:ProjectRef"]="test-project",["CentralTaskWriter:AllowLocalDevelopment"]="true"
  });
  using var client=app.GetTestClient();
  async Task Send(string kind,string id,object body,HttpStatusCode status,string? user=a) {
   using var request=new HttpRequestMessage(HttpMethod.Post,$"/api/v1/workspace/{kind}/{id}/operations") {Content=JsonContent.Create(body)};
   if(user is not null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));
   using var response=await client.SendAsync(request);
   if(response.StatusCode!=status)throw new Exception($"Workspace expected {status}, got {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
   if(response.Headers.CacheControl?.NoStore!=true)throw new Exception("Workspace response cached");
  }
  object Payload(string title="Note",string state="active",bool pinned=false)=>new {title,body="First line\nSecond line",state,pinned};
  object Op(string action,long rev,object payload,string? operation=null)=>new {operationId=operation??Guid.NewGuid().ToString("N"),action,expectedRevision=rev,payload};
  var create=Op("create",0,Payload(),"cccccccccccc4ccc8ccccccccccccccc");
  await Send("note",note,create,HttpStatusCode.Unauthorized,null);
  await Send("note",note,create,HttpStatusCode.OK);
  await Send("note",note,create,HttpStatusCode.OK);
  await Send("note",note,Op("create",0,Payload("Changed"),"cccccccccccc4ccc8ccccccccccccccc"),HttpStatusCode.Conflict);
  await Send("note",note,Op("update",1,Payload("Updated")),HttpStatusCode.OK);
  await Send("note",note,Op("update",1,Payload("Stale")),HttpStatusCode.Conflict);
  await Send("note",note,Op("update",2,Payload("Other")),HttpStatusCode.NotFound,b);
  await Send("project",note,Op("update",2,Payload()),HttpStatusCode.NotFound);
  var delete=Op("delete",2,new {});
  await Send("note",note,delete,HttpStatusCode.OK);await Send("note",note,delete,HttpStatusCode.OK);
  await Send("note",note,Op("create",0,Payload()),HttpStatusCode.Conflict);
  await Send("note",note,Op("create",0,Payload("Other account")),HttpStatusCode.OK,b);
  await Send("project",project,Op("create",0,Payload("Project","active",true)),HttpStatusCode.BadRequest);
  await Send("note",project,Op("create",0,Payload("Note","done")),HttpStatusCode.BadRequest);
  await Send("note",project,Op("create",0,Payload(new string('x',201))),HttpStatusCode.BadRequest);
  await Send("note",project,Op("create",0,new{title="N",body=new string('x',20001),state="active",pinned=false}),HttpStatusCode.BadRequest);
  await Send("note",project,Op("create",0,new{title="N",body="",state="active",pinned=false,userId=b}),HttpStatusCode.BadRequest);
  await Send("project",project,Op("create",0,Payload("Project")),HttpStatusCode.OK);
  await Send("project",project,Op("update",1,Payload("Project","done")),HttpStatusCode.OK);
  Console.WriteLine("PASS workspace HTTP: notes/projects lifecycle, replay, revision conflict, owner isolation, tombstones and payload limits");
  return 1;
 }
}
