#!/usr/bin/env python3
"""Bulk-import every GHL-linked client's native GoHighLevel tasks.
Dry-run by default; --commit to write. Deduped by tasks.ghl_task_id.
Imports open AND completed (completed -> done)."""
import os, sys, json, re, time, secrets, urllib.request, urllib.parse
SB=os.environ["NEXT_PUBLIC_SUPABASE_URL"]; KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SBH={"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json"}
COMMIT="--commit" in sys.argv
GHL="https://services.leadconnectorhq.com"
SUB2LOC={"c_agency":"7B0Y8xCOblcTHzYnM1Kc","c_directory":"GN4HK1ybbTBWcolEjLHl"}

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

tokens={t["location_id"]:t["token"] for t in sb("ghl_tokens?select=location_id,token")}
clients={c["id"]:c for c in sb("clients?select=id,name")}
projects=sb("projects?select=id,client_id,name")
proj_by={(p["client_id"],p["name"]):p["id"] for p in projects}
seen={t["ghl_task_id"] for t in sb("tasks?select=ghl_task_id&ghl_task_id=not.is.null") if t.get("ghl_task_id")}
# cl_ct_ clients only
targets=[cid for cid in clients if cid.startswith("cl_ct_")]
# resolve their contacts
cids=",".join(cid[3:] for cid in targets)
contacts={c["id"]:c for c in sb("contacts?select=id,name,ghl_contact_id,client_id&id=in.("+cids+")")}

new_tasks=[]; created_projects=[]; summary=[]; errors=[]
def ensure_proj(cid):
    key=(cid,"Tasks")
    if key in proj_by: return proj_by[key]
    pid=nid("p_"); created_projects.append((cid,pid))
    if COMMIT: sb("projects","POST",[{"id":pid,"client_id":cid,"name":"Tasks","description":""}])
    proj_by[key]=pid; return pid

for cid in targets:
    ct=contacts.get(cid[3:])
    if not ct or not ct.get("ghl_contact_id"): continue
    loc=SUB2LOC.get(ct["client_id"])
    tok=tokens.get(loc)
    if not tok: continue
    try:
        req=urllib.request.Request(f"{GHL}/contacts/{ct['ghl_contact_id']}/tasks",
            headers={"Authorization":"Bearer "+tok,"Version":"2021-07-28","Accept":"application/json","User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
        gtasks=json.load(urllib.request.urlopen(req)).get("tasks",[])
    except Exception as e:
        errors.append((clients[cid]["name"], str(e)[:80])); continue
    if not gtasks: continue
    pid=ensure_proj(cid)
    new=0; dup=0
    for t in gtasks:
        if t["id"] in seen: dup+=1; continue
        seen.add(t["id"])
        due=t.get("dueDate"); due=due[:10] if isinstance(due,str) else None
        row={"id":nid("t_"),"project_id":pid,"client_id":cid,"title":(t.get("title") or "Untitled task")[:200],
             "description":strip(t.get("body","")),"status":"done" if t.get("completed") else "todo","priority":"none",
             "assignee_id":None,"contact_id":cid[3:],"due":due,"recurrence":"none","ghl_task_id":t["id"],
             "label_ids":[],"subtasks":[],"attachments":[],"comments":[],"is_private":False,"delegated_to":[],"clickup_task_id":None}
        new_tasks.append(row); new+=1
    summary.append((clients[cid]["name"], len(gtasks), new, dup))
    time.sleep(0.1)

if COMMIT and new_tasks:
    for i in range(0,len(new_tasks),50): sb("tasks","POST",new_tasks[i:i+50])

print("=== COMMITTED ===" if COMMIT else "=== DRY RUN (no writes) ===")
print(f"new projects: {len(created_projects)}  tasks to insert: {len(new_tasks)}")
print("\nper-client (client : ghl_total / NEW / dup):")
for nm,tot,new,dup in sorted(summary,key=lambda x:-x[2]): print(f"  {nm:24} : {tot:3} / {new:3} / {dup}")
if errors:
    print("\nerrors:")
    for nm,e in errors: print(f"  {nm}: {e}")
