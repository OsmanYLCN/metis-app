using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;

internal static class DomainChecks
{
 public static async Task<int> Run(string port,Func<Dictionary<string,string?>,Task<WebApplication>> start,Func<string,string> token)
 {
  const string a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
  await using var app=await start(new() {
   ["CentralTaskWriter:Provider"]="PostgreSql",["CentralTaskWriter:Host"]="127.0.0.1",["CentralTaskWriter:Port"]=port,
   ["CentralTaskWriter:Username"]="metis_writer",["CentralTaskWriter:Password"]="synthetic",
   ["CentralTaskWriter:ProjectRef"]="test-project",["CentralTaskWriter:AllowLocalDevelopment"]="true"
  });
  using var client=app.GetTestClient();
  async Task<JsonElement> Send(string kind,string id,object body,HttpStatusCode status,string? user=a) {
   using var request=new HttpRequestMessage(HttpMethod.Post,$"/api/v1/workspace/{kind}/{id}/operations") {Content=JsonContent.Create(body)};
   if(user is not null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token(user));
   using var response=await client.SendAsync(request);
   if(response.StatusCode!=status)throw new Exception($"{kind} expected {status}, got {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
   if(response.Headers.CacheControl?.NoStore!=true)throw new Exception("Domain response cached");
   return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
  }
  object Op(string action,long revision,object payload,string? operation=null)=>new {operationId=operation??Guid.NewGuid().ToString("N"),action,expectedRevision=revision,payload};
  object Goal(int progress=25,string? targetDate="2028-02-29")=>new {title="Goal",description="Steps",state="active",targetDate,progress};
  object Event(string date="2028-02-29",string? startTime="09:00",string? endTime="10:00")=>new {title="Event",details="Details",eventDate=date,startTime,endTime};
  object Finance(long cents=12345,string currency="TRY")=>new {title="Entry",direction="expense",category="Test",amountCents=cents,entryDate="2028-02-29",currency};
  object Budget(long cents=50000)=>new {month="2028-02",category="Test",limitCents=cents,currency="TRY"};
  var data=new (string kind,object initial,object updated)[]{("goal",Goal(),Goal(75)),("event",Event(),Event(startTime:"11:00",endTime:null)),
   ("finance",Finance(),Finance(67890)),("budget",Budget(),Budget(60000))};
  foreach(var (kind,initial,updated) in data) {
   var id=Guid.NewGuid().ToString("N");var operation=Guid.NewGuid().ToString("N");var create=Op("create",0,initial,operation);
   await Send(kind,id,create,HttpStatusCode.Unauthorized,null);
   var first=await Send(kind,id,create,HttpStatusCode.OK);
   if(first.GetProperty("revision").GetInt64()!=1 || first.GetProperty("replay").GetBoolean())throw new Exception("Wrong first receipt");
   var replay=await Send(kind,id,create,HttpStatusCode.OK);
   if(!replay.GetProperty("replay").GetBoolean())throw new Exception("Missing replay receipt");
   await Send(kind,id,Op("create",0,updated,operation),HttpStatusCode.Conflict);
   if(kind=="budget")await Send(kind,Guid.NewGuid().ToString("N"),Op("create",0,initial),HttpStatusCode.Conflict);
   await Send(kind,id,Op("update",1,updated),HttpStatusCode.OK);
   await Send(kind,id,Op("update",1,initial),HttpStatusCode.Conflict);
   await Send(kind,id,Op("update",2,initial),HttpStatusCode.NotFound,b);
   await Send(kind,id,create,HttpStatusCode.OK); // Lost old response after a later edit returns old receipt, not a new write.
   var delete=Op("delete",2,new{});await Send(kind,id,delete,HttpStatusCode.OK);await Send(kind,id,delete,HttpStatusCode.OK);
   await Send(kind,id,Op("create",0,initial),HttpStatusCode.Conflict);
   await Send(kind,id,Op("update",3,initial),HttpStatusCode.NotFound);
   await Send(kind,id,Op("create",0,initial),HttpStatusCode.OK,b);
  }
  foreach(var (kind,payload) in new (string,object)[]{
   ("goal",Goal(101)),("goal",Goal(targetDate:"2027-02-29")),("goal",Goal(targetDate:"0000-01-01")),
   ("event",Event(date:"2028-04-31")),("event",Event(startTime:null)),("event",Event(endTime:"09:00")),("event",Event(endTime:"24:00")),
   ("finance",Finance(0)),("finance",Finance(1000000000000)),("finance",Finance(currency:"USD")),("budget",Budget(0)),
   ("finance",new {title="Entry",direction="expense",category="Test",amountCents=12.5,entryDate="2028-02-29",currency="TRY"}),
   ("budget",new {month="2028-13",category="Test",limitCents=1,currency="TRY"}),
   ("goal",new {title="G",description="",state="active",targetDate=(string?)null,progress=0,userId=b})
  }) await Send(kind,Guid.NewGuid().ToString("N"),Op("create",0,payload),HttpStatusCode.BadRequest);
  Console.WriteLine("PASS domain HTTP: four module lifecycles, exact receipts, lost-response retry, account scope, budget uniqueness, dates, times, money and progress limits");
  return 1;
 }
}
