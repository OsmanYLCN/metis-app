using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PersonalOS.Api.Modules.Identity;
using PersonalOS.Api.Modules.Tasks;

// Real authentication + HTTP pipeline in memory. Only the remote JWKS transport is fake.
// All signing keys are generated per run; no accounts, secrets or network ports are used.
const string issuer = "https://test-project.supabase.co/auth/v1";
const string subject = "11111111-1111-4111-8111-111111111111";
var passed = 0;
void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
void Pass(string name) { passed++; Console.WriteLine($"PASS {name}"); }

var validator = new IdentityOptionsValidator();
Check(validator.Validate(null, new()).Succeeded, "Default configuration must be disabled.");
Check(validator.Validate(null, new() { Provider = "Supabase", Authority = issuer }).Succeeded, "Valid issuer rejected.");
Pass("default disabled and valid public issuer");
foreach (var invalid in new[] {
    "", "http://test-project.supabase.co/auth/v1", "https://127.0.0.1/auth/v1",
    "https://test-project.supabase.co.attacker.example/auth/v1", "https://example.com/auth/v1",
    "https://user:private-value@test-project.supabase.co/auth/v1",
    "https://test-project.supabase.co/auth/v1?key=private-value",
    "https://test-project.supabase.co/auth/v1#private-value",
    "https://test-project.supabase.co:444/auth/v1", "https://test-project.supabase.co/wrong-path",
})
{
    var result = validator.Validate(null, new() { Provider = "Supabase", Authority = invalid });
    Check(result.Failed && !(result.FailureMessage ?? "").Contains("private-value"), "Unsafe issuer accepted or echoed.");
}
Check(validator.Validate(null, new() { Provider = "Other" }).Failed, "Unknown provider accepted.");
Check(validator.Validate(null, new() { Authority = issuer }).Failed, "Contradictory config accepted.");
Pass("unsafe and contradictory settings rejected without echoing values");

using var rsa = RSA.Create(2048);
using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
using var attacker = RSA.Create(2048);
var rsaKey = new RsaSecurityKey(rsa) { KeyId = "rsa-test" };
var ecKey = new ECDsaSecurityKey(ec) { KeyId = "ec-test" };
var rsaSigning = new SigningCredentials(rsaKey, SecurityAlgorithms.RsaSha256);
var ecSigning = new SigningCredentials(ecKey, SecurityAlgorithms.EcdsaSha256);
var publicRsa = new RsaSecurityKey(rsa.ExportParameters(false)) { KeyId = rsaKey.KeyId };
using var publicEcAlgorithm = ECDsa.Create(ec.ExportParameters(false));
var publicEc = new ECDsaSecurityKey(publicEcAlgorithm) { KeyId = ecKey.KeyId };
var jwks = JsonSerializer.Serialize(new { keys = new[] {
    JsonWebKeyConverter.ConvertFromRSASecurityKey(publicRsa),
    JsonWebKeyConverter.ConvertFromECDsaSecurityKey(publicEc),
} });

string Token(Action<SecurityTokenDescriptor>? edit = null, SigningCredentials? signing = null)
{
    var descriptor = new SecurityTokenDescriptor
    {
        Issuer = issuer, Audience = "authenticated",
        IssuedAt = DateTime.UtcNow.AddMinutes(-1), NotBefore = DateTime.UtcNow.AddMinutes(-1),
        Expires = DateTime.UtcNow.AddMinutes(5), SigningCredentials = signing ?? rsaSigning,
        Claims = new Dictionary<string, object> { ["sub"] = subject, ["role"] = "authenticated", ["is_anonymous"] = false },
    };
    edit?.Invoke(descriptor);
    return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(descriptor);
}

async Task<WebApplication> Start(string provider, FakeKeys keys, Dictionary<string, string?>? extra = null, ITaskReader? tasks = null, string environment = "Production")
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
    builder.WebHost.UseTestServer();
    builder.Logging.ClearProviders();
    builder.Configuration.Sources.Clear();
    var settings = new Dictionary<string, string?> {
        ["Identity:Provider"] = provider, ["Identity:Authority"] = provider == "Supabase" ? issuer : null,
    };
    if (extra is not null) foreach (var pair in extra) settings[pair.Key] = pair.Value;
    builder.Configuration.AddInMemoryCollection(settings);
    builder.Services.AddIdentityFoundation(builder.Configuration);
    if (tasks is not null) builder.Services.AddSingleton(tasks);
    builder.Services.AddTasksFoundation(builder.Configuration);
    builder.Services.AddHttpClient(SupabaseBearerOptions.KeyClient).ConfigurePrimaryHttpMessageHandler(() => keys);
    var app = builder.Build();
    // Inject an untrusted principal to ensure only the Bearer handler result is used.
    app.Use(async (context, next) =>
    {
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", subject)], "untrusted"));
        await next(context);
    });
    app.MapIdentityFoundation();
    app.MapTasksFoundation();
    try { await app.StartAsync(); return app; }
    catch { await app.DisposeAsync(); throw; }
}

async Task<JsonElement> Request(HttpClient client, string path, HttpStatusCode expected, string? token = null)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    request.Headers.Add("X-User-Id", "fake-user");
    using var response = await client.SendAsync(request);
    Check(response.StatusCode == expected, $"Expected {(int)expected}, got {(int)response.StatusCode}.");
    Check(response.Headers.CacheControl?.NoStore == true, "Account response cached.");
    Check(!response.Headers.Contains("Set-Cookie"), "Unexpected cookie.");
    var body = await response.Content.ReadAsStringAsync();
    Check((path.EndsWith("/status", StringComparison.Ordinal) || !body.Contains("test-project"))
        && (token is null || !body.Contains(token)), "Private config or bearer token leaked.");
    if (expected == HttpStatusCode.Unauthorized) Check(response.Headers.WwwAuthenticate.ToString() == "Bearer", "Missing generic Bearer challenge.");
    var json = JsonDocument.Parse(body).RootElement.Clone();
    if (expected == HttpStatusCode.Unauthorized)
        Check(!json.GetProperty("authenticated").GetBoolean() && json.GetProperty("user").ValueKind == JsonValueKind.Null, "Unauthorized response exposed a user.");
    return json;
}

var disabledKeys = new FakeKeys(jwks);
await using (var app = await Start("Disabled", disabledKeys))
using (var client = app.GetTestClient())
{
    var status = await Request(client, "/api/v1/auth/status", HttpStatusCode.OK);
    Check(status.GetProperty("status").GetString() == "notConfigured", "Disabled status incorrect.");
    await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized);
    await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized, Token());
    Check(disabledKeys.Calls == 0, "Disabled provider requested keys.");
    Pass("disabled rejects even signed tokens and performs no JWKS request");
}

var keys = new FakeKeys(jwks);
await using (var app = await Start("Supabase", keys))
using (var client = app.GetTestClient())
{
    var status = await Request(client, "/api/v1/auth/status", HttpStatusCode.OK);
    Check(status.GetProperty("status").GetString() == "verificationConfigured"
        && status.GetProperty("issuer").GetString() == issuer
        && !status.GetProperty("signInAvailable").GetBoolean()
        && status.GetProperty("sessionPersistence").GetString() == "none", "Status claims sign-in or persistence.");
    await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized);
    Check(keys.Calls == 0, "Status or absent token caused a remote request.");
    Pass("configuration status and missing/spoofed identity do not contact provider");

    foreach (var signing in new[] { rsaSigning, ecSigning })
    {
        var session = await Request(client, "/api/v1/auth/session", HttpStatusCode.OK, Token(signing: signing));
        Check(session.GetProperty("authenticated").GetBoolean() && session.GetProperty("state").GetString() == "signedIn"
            && session.GetProperty("user").GetProperty("id").GetString() == subject
            && session.GetProperty("user").GetProperty("displayName").ValueKind == JsonValueKind.Null, "Wrong verified account.");
        Pass($"valid {signing.Algorithm} account token verified through real JWT handler");
    }
    Check(keys.Calls == 1 && keys.LastUri == issuer + "/.well-known/jwks.json", "JWKS not cached or wrong endpoint.");
    Pass("trusted public JWKS fetched once and cached across requests");

    var invalidTokens = new Dictionary<string, string>
    {
        ["malformed"] = "not-a-token",
        ["wrong issuer"] = Token(d => d.Issuer = "https://another.supabase.co/auth/v1"),
        ["wrong audience"] = Token(d => d.Audience = "other"),
        ["missing audience"] = Token(d => d.Audience = null),
        ["expired"] = Token(d => { d.NotBefore = DateTime.UtcNow.AddHours(-2); d.Expires = DateTime.UtcNow.AddHours(-1); }),
        ["future token"] = Token(d => { d.NotBefore = DateTime.UtcNow.AddHours(1); d.Expires = DateTime.UtcNow.AddHours(2); }),
        ["missing expiry"] = Token(d => d.Expires = null),
        ["missing subject"] = Token(d => d.Claims.Remove("sub")),
        ["invalid subject"] = Token(d => d.Claims["sub"] = "not-a-uuid"),
        ["empty subject"] = Token(d => d.Claims["sub"] = Guid.Empty.ToString()),
        ["service role"] = Token(d => d.Claims["role"] = "service_role"),
        ["missing role"] = Token(d => d.Claims.Remove("role")),
        ["anonymous user"] = Token(d => d.Claims["is_anonymous"] = true),
        ["missing anonymous flag"] = Token(d => d.Claims.Remove("is_anonymous")),
        ["unsigned"] = Token(d => d.SigningCredentials = null),
        ["HS256"] = Token(signing: new SigningCredentials(new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)), SecurityAlgorithms.HmacSha256)),
        ["wrong signature with trusted kid"] = Token(signing: new SigningCredentials(new RsaSecurityKey(attacker) { KeyId = rsaKey.KeyId }, SecurityAlgorithms.RsaSha256)),
        ["unknown key"] = Token(signing: new SigningCredentials(new RsaSecurityKey(attacker) { KeyId = "unknown" }, SecurityAlgorithms.RsaSha256)),
    };
    foreach (var (name, token) in invalidTokens)
    {
        await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized, token);
        Pass($"reject {name}");
    }
    // Authentication is per request; a previous valid token never creates a stored session.
    await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized);
    Pass("no session survives without its bearer token");
}

foreach (var mode in new[] { "unavailable", "malformed", "empty" })
{
    var fake = new FakeKeys(mode == "malformed" ? "not-json" : "{\"keys\":[]}", mode == "unavailable");
    await using var app = await Start("Supabase", fake);
    using var client = app.GetTestClient();
    await Request(client, "/api/v1/auth/session", HttpStatusCode.Unauthorized, Token());
    Pass($"{mode} JWKS cannot authenticate an account");
}

foreach (var settings in new[] {
    new Dictionary<string, string?> { ["Identity:Authority"] = "http://invalid.example/auth/v1" },
    new Dictionary<string, string?> { ["Identity:Unexpected"] = "not-a-secret" },
})
{
    var rejected = false;
    try { await using var app = await Start("Supabase", new FakeKeys(jwks), settings); }
    catch (Exception exception) when (exception is OptionsValidationException or InvalidOperationException) { rejected = true; }
    Check(rejected, "Invalid configuration reached running application.");
    Pass("invalid/unknown configuration fails at startup");
}
passed += await TaskFoundationChecks.Run(reader => Start("Supabase", new FakeKeys(jwks), tasks: reader),
    user => user is null ? Token() : Token(d => d.Claims["sub"] = user),
    [Token(d => d.Claims["role"] = "service_role"), Token(d => d.Claims["is_anonymous"] = true),
     Token(d => d.Issuer = "https://another.supabase.co/auth/v1"), "not-a-token"]);
passed += CentralTaskConfigurationChecks.Run();
passed += TaskWriteRuleChecks.Run();
if (Environment.GetEnvironmentVariable("METIS_TEST_PG_PORT") is { } testPort)
    passed += await PostgresAdapterChecks.Run(testPort,
        settings => Start("Supabase", new FakeKeys(jwks), settings, environment: Environments.Development),
        user => Token(d => d.Claims["sub"] = user));
Console.WriteLine($"{passed} checks passed; ephemeral JWT keys and mocked JWKS; task reader fixtures or opt-in local PostgreSQL, no external account.");

sealed class FakeKeys(string json, bool unavailable = false) : HttpMessageHandler
{
    public int Calls { get; private set; }
    public string? LastUri { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Calls++;
        LastUri = request.RequestUri!.AbsoluteUri;
        return Task.FromResult(new HttpResponseMessage(unavailable ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK)
        { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") });
    }
}
