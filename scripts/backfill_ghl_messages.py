#!/usr/bin/env python3
"""One-time backfill of GHL email/SMS history into the `messages` table, for
clients currently in lead/prospect/onboarding/active_client status, limited to
2026 communications. Dry-run by default; --commit to write.
Deduped by messages.ghl_message_id — safe to re-run."""
import os, sys, re, json, time, secrets, urllib.request
SB=os.environ["NEXT_PUBLIC_SUPABASE_URL"]; KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SBH={"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json"}
COMMIT="--commit" in sys.argv
GHL="https://services.leadconnectorhq.com"
SUB2LOC={"c_agency":"7B0Y8xCOblcTHzYnM1Kc","c_directory":"GN4HK1ybbTBWcolEjLHl"}
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
YEAR="2026"
STATUSES={"lead","prospect","onboarding","active_client"}

def sb(path, method="GET", body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(SB+"/rest/v1/"+path, data=data, headers=SBH, method=method)
    with urllib.request.urlopen(req) as r:
        t=r.read(); return json.loads(t) if t else None
def nid(p): return p+secrets.token_hex(6)
def strip(html):
    html=html or ""
    html=re.sub(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',r'\2 (\1)',html,flags=re.I|re.S)
    html=re.sub(r'<[^>]+>','',html)
    for a,b in [("&nbsp;"," "),("&amp;","&"),("&lt;","<"),("&gt;",">")]: html=html.replace(a,b)
    return re.sub(r'\n{3,}','\n\n',html).strip()

def ghl_get(url, tok):
    req=urllib.request.Request(url, headers={"Authorization":"Bearer "+tok,"Version":"2021-04-15","Accept":"application/json","User-Agent":UA})
    return json.load(urllib.request.urlopen(req))

tokens={t["location_id"]:t["token"] for t in sb("ghl_tokens?select=location_id,token")}
clients=[c for c in sb("clients?select=id,name,status,linked_contact_id") if c.get("status") in STATUSES]
seen={m["ghl_message_id"] for m in sb("messages?select=ghl_message_id&ghl_message_id=not.is.null") if m.get("ghl_message_id")}

new_messages=[]; summary=[]; errors=[]; skipped=[]

for c in clients:
    cid=c["id"]
    contact_id = c.get("linked_contact_id") or (cid[3:] if cid.startswith("cl_") else None)
    if not contact_id:
        skipped.append((c["name"], "no linkable contact")); continue
    ct_rows = sb(f"contacts?select=id,ghl_contact_id,client_id&id=eq.{contact_id}")
    if not ct_rows:
        skipped.append((c["name"], "contact not found")); continue
    ct = ct_rows[0]
    loc = SUB2LOC.get(ct["client_id"])
    tok = tokens.get(loc) if loc else None
    if not tok:
        skipped.append((c["name"], "no GHL token for sub-account")); continue
    try:
        convs = ghl_get(f"{GHL}/conversations/search?contactId={ct['ghl_contact_id']}&locationId={loc}", tok).get("conversations", [])
    except Exception as e:
        errors.append((c["name"], str(e)[:80])); continue

    new=0; dup=0; other_year=0; non_msg=0
    for conv in convs:
        cursor=None
        while True:
            url=f"{GHL}/conversations/{conv['id']}/messages?limit=100"
            if cursor: url+=f"&lastMessageId={cursor}"
            try:
                page = ghl_get(url, tok).get("messages", {})
            except Exception as e:
                errors.append((c["name"], str(e)[:80])); break
            msgs = page.get("messages", [])
            if not msgs: break
            for m in msgs:
                mtype = m.get("messageType")
                if mtype not in ("TYPE_EMAIL", "TYPE_SMS"):
                    non_msg += 1; continue
                if not str(m.get("dateAdded","")).startswith(YEAR):
                    other_year += 1; continue
                gid = m["id"]
                if gid in seen:
                    dup += 1; continue
                seen.add(gid)
                subject = (m.get("meta", {}).get("email", {}) or {}).get("subject")
                row = {
                    "id": nid("msg_"), "contact_id": ct["id"], "client_id": cid,
                    "channel": "email" if mtype == "TYPE_EMAIL" else "sms",
                    "direction": "inbound" if m.get("direction") == "inbound" else "outbound",
                    "subject": subject, "body": strip(m.get("body","")) if mtype == "TYPE_EMAIL" else (m.get("body") or ""),
                    "ghl_message_id": gid, "created_by": None, "created_at": m["dateAdded"], "read": True,
                }
                new_messages.append(row); new += 1
            if not page.get("nextPage"):
                break
            cursor = page.get("lastMessageId")
            if not cursor:
                break
            time.sleep(0.1)
    summary.append((c["name"], new, dup, other_year, non_msg))
    time.sleep(0.15)

if COMMIT and new_messages:
    for i in range(0, len(new_messages), 50):
        sb("messages", "POST", new_messages[i:i+50])

print("=== COMMITTED ===" if COMMIT else "=== DRY RUN (no writes) ===")
print(f"clients scanned: {len(clients)}   messages to insert: {len(new_messages)}")
print("\nper-client (client : NEW / dup / other-year / non-email-sms):")
for nm, new, dup, oy, nm2 in sorted(summary, key=lambda x: -x[1]):
    if new or dup or oy or nm2: print(f"  {nm:28} : {new:3} / {dup:3} / {oy:4} / {nm2}")
if skipped:
    print("\nskipped (no data pulled):")
    for nm, why in skipped: print(f"  {nm}: {why}")
if errors:
    print("\nerrors:")
    for nm, e in errors: print(f"  {nm}: {e}")
