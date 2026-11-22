using System.Globalization;
using System.Text;
using System.Text.Json;

namespace PersonalOS.Api.Modules.Workspace;

// Explicit domain contracts; JSON is a storage envelope, not arbitrary user data.
public static class DomainPayload
{
    public static bool IsKind(string kind) => kind is "goal" or "event" or "finance" or "budget";
    public static bool Valid(string kind,JsonElement p)
    {
        string[] fields=kind switch {
            "goal" => ["title","description","state","targetDate","progress"],
            "event" => ["title","details","eventDate","startTime","endTime"],
            "finance" => ["title","direction","category","amountCents","entryDate","currency"],
            "budget" => ["month","category","limitCents","currency"], _ => []
        };
        if(fields.Length==0 || p.ValueKind!=JsonValueKind.Object) return false;
        var properties=p.EnumerateObject().ToArray();
        if(properties.Length!=fields.Length || properties.Select(v=>v.Name).Distinct().Count()!=fields.Length
            || properties.Any(v=>!fields.Contains(v.Name))) return false;
        if(kind!="budget" && !Text(p.GetProperty("title"),200,false)) return false;
        return kind switch {
            "goal" => Text(p.GetProperty("description"),10000,true) && String(p,"state") is "active" or "paused" or "done"
                && Integer(p,"progress",0,100) && (p.GetProperty("targetDate").ValueKind==JsonValueKind.Null || Date(String(p,"targetDate"))),
            "event" => Text(p.GetProperty("details"),5000,true) && Date(String(p,"eventDate")) && EventTimes(p),
            "finance" => Text(p.GetProperty("category"),60,false) && String(p,"currency")=="TRY"
                && String(p,"direction") is "income" or "expense" && Integer(p,"amountCents",1,999999999999) && Date(String(p,"entryDate")),
            "budget" => Text(p.GetProperty("category"),60,false) && String(p,"currency")=="TRY"
                && Integer(p,"limitCents",1,999999999999) && String(p,"month") is {Length:7} month && Date(month+"-01"),
            _ => false
        };
    }
    private static string? String(JsonElement p,string key) => p.GetProperty(key).ValueKind==JsonValueKind.String ? p.GetProperty(key).GetString() : null;
    private static bool Integer(JsonElement p,string key,long min,long max) => p.GetProperty(key).ValueKind==JsonValueKind.Number
        && p.GetProperty(key).TryGetDecimal(out var value) && value==decimal.Truncate(value) && value>=min && value<=max;
    private static bool Date(string? value) => value?.Length==10 && DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out _);
    private static bool Time(string? value) => value?.Length==5 && TimeOnly.TryParseExact(value,"HH:mm",CultureInfo.InvariantCulture,DateTimeStyles.None,out _);
    private static bool EventTimes(JsonElement p)
    {
        var start=String(p,"startTime");var end=String(p,"endTime");
        return (p.GetProperty("startTime").ValueKind==JsonValueKind.Null || Time(start))
            && (p.GetProperty("endTime").ValueKind==JsonValueKind.Null || (Time(end) && Time(start) && string.CompareOrdinal(end,start)>0));
    }
    private static bool Text(JsonElement element,int max,bool multiline)
    {
        if(element.ValueKind!=JsonValueKind.String) return false;
        var value=element.GetString()!;
        try { new UTF8Encoding(false,true).GetByteCount(value); } catch(EncoderFallbackException) { return false; }
        return value.EnumerateRunes().Count()<=max && (multiline || value.Length>0 && value==value.Trim())
            && !value.Any(c=>char.IsControl(c) && !(multiline && c is '\n' or '\r' or '\t'));
    }
}
