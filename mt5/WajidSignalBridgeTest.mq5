#property strict
#property version "1.0"
#property description "Wajid Swing Liquidity - API connectivity test (NO TRADE EXECUTION)"

input string ApiUrl = "https://wajid-ai-signals.vercel.app/api/liquidity?symbol=XAU%2FUSD&interval=15min&outputsize=5";
input int PollSeconds = 15;
input int TimeoutMs = 8000;

string JsonString(const string json,const string key)
{
   string needle="\""+key+"\"";
   int p=StringFind(json,needle);
   if(p<0) return "";
   p=StringFind(json,":",p+StringLen(needle));
   if(p<0) return "";
   p++;
   while(p<StringLen(json) && (StringGetCharacter(json,p)==' ' || StringGetCharacter(json,p)=='\t')) p++;
   if(p>=StringLen(json) || StringGetCharacter(json,p)!='\"') return "";
   p++;
   int e=StringFind(json,"\"",p);
   if(e<0) return "";
   return StringSubstr(json,p,e-p);
}

double JsonNumber(const string json,const string key)
{
   string needle="\""+key+"\"";
   int p=StringFind(json,needle);
   if(p<0) return EMPTY_VALUE;
   p=StringFind(json,":",p+StringLen(needle));
   if(p<0) return EMPTY_VALUE;
   p++;
   while(p<StringLen(json) && (StringGetCharacter(json,p)==' ' || StringGetCharacter(json,p)=='\t')) p++;
   int e=p;
   while(e<StringLen(json))
   {
      ushort c=StringGetCharacter(json,e);
      if((c>='0' && c<='9') || c=='-' || c=='+' || c=='.' || c=='e' || c=='E') e++;
      else break;
   }
   if(e==p) return EMPTY_VALUE;
   return StringToDouble(StringSubstr(json,p,e-p));
}

void CheckApi()
{
   char post[];
   char result[];
   string headers="";
   ResetLastError();
   int code=WebRequest("GET",ApiUrl,"Accept: application/json\r\n",TimeoutMs,post,0,result,headers);
   if(code==-1)
   {
      Print("Wajid Bridge: WebRequest failed. Error=",GetLastError());
      Print("Add https://wajid-ai-signals.vercel.app under MT5 Tools > Options > Expert Advisors > Allow WebRequest.");
      return;
   }
   string json=CharArrayToString(result,0,-1,CP_UTF8);
   Print("Wajid Bridge HTTP=",code);
   Print("Signal=",JsonString(json,"direction")," Probability=",JsonNumber(json,"probability")," Entry=",JsonNumber(json,"entry")," SL=",JsonNumber(json,"stopLoss")," TP2=",JsonNumber(json,"tp2"));
}

int OnInit()
{
   EventSetTimer(MathMax(5,PollSeconds));
   Print("Wajid Signal Bridge TEST initialized. NO TRADES WILL BE OPENED.");
   CheckApi();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick(){}
void OnTimer(){CheckApi();}
