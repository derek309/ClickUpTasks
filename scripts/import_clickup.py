#!/usr/bin/env python3
"""One-time (re-runnable) ClickUp -> ClickUpTasks importer.
Reads env from the shell (source .env.local first). Dry-run by default;
pass --commit to actually write. Deduped by tasks.clickup_task_id.
"""
import os, sys, json, time, secrets, urllib.request, urllib.parse

CU  = os.environ["CLICKUP_API_TOKEN"]
SB  = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SBH = {"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json"}
COMMIT = "--commit" in sys.argv

DEREK="u_derek"; JUSTIN="e34a363b-7dda-400c-99fe-b2f9f11b4010"; MICHAELLA="c5a97dc8-1bf9-4527-8a95-8010b52decea"
ASSIGN={"derek fox":DEREK,"justin chevallier":JUSTIN,"justin chevalier":JUSTIN,"michaella pastrana":MICHAELLA,"michaela pastrana":MICHAELLA}

# new client id -> (company/business label, assign_member_or_None)
NEW={
 "cl_ct_ghl_V3yqjpK7hBGW4w6UkVDU":("Liberty Painting Services",None),
 "cl_ct_ghl_3UbFsGYHZPDZugZ96CtG":("",None),
 "cl_ct_ghl_2wVd6pQCnHAFHHoSbDuO":("Artist in Workshop",None),
 "cl_ct_ghl_sW0stBfkLKYhdRZgw0PM":("Whitman Land Group",None),
 "cl_ct_ghl_zd1f5icTEfXWig3pmOHH":("Narayan Wellness",JUSTIN),
 "cl_ct_ghl_XaIfK69d7LdVZ5QGdvSM":("Rocklin/Lincoln Pet Spa",None),
 "cl_ct_ghl_MXXU1sDN1PHgSGdfutbr":("Trinity Partners",None),
 "cl_ct_ghl_9VAWKaTs6TeRkp2AmoE3":("",None),
 "cl_workspace":("",None),  # internal/agency work — no GHL contact, never syncs
}
# name overrides for containers with no backing contact
NAMES={"cl_workspace":"Workspace"}
# clickup list id -> (client id, project name)
MAP={
 "901112840803":("cl_ct_ghl_n4vaKoznBTPc5ux4EWij","Task Manager"),
 "901113066879":("cl_cu_ac_services_elite","Blogs 1/Week"),
 "901113553766":("cl_cu_ac_services_elite","Google LSA & Ads Campaign Launch"),
 "901112884079":("cl_cu_ac_services_elite","Social Media"),
 "901112884028":("cl_cu_ac_services_elite","Support"),
 "901112884074":("cl_cu_ac_services_elite","Website Design"),
 "901113066885":("cl_ct_ghl_xa8itQslg2VPLuIZFi8e","Blogs 1/Week"),
 "901112884330":("cl_ct_ghl_xa8itQslg2VPLuIZFi8e","Phase 1 – Basic Monthly Sweepstakes (Foundation)"),
 "901112941011":("cl_ct_ghl_xa8itQslg2VPLuIZFi8e","Phase 2 – Accurate Arms Insider Membership"),
 "901112940998":("cl_ct_ghl_xa8itQslg2VPLuIZFi8e","Sweepstakes Monthly Template"),
 "901113812063":("cl_ct_ghl_xa8itQslg2VPLuIZFi8e","Support"),
 "901113066908":("cl_cu_mitchell_katz_winery","Blogs 1/Week"),
 "901112840820":("cl_cu_mitchell_katz_winery","Support"),
 "901113066909":("cl_ct_ghl_zd1f5icTEfXWig3pmOHH","Blogs 1/Week"),
 "901112884364":("cl_ct_ghl_zd1f5icTEfXWig3pmOHH","Support"),
 "901113066912":("cl_ct_ghl_sW0stBfkLKYhdRZgw0PM","Blogs 1/Month"),
 "901112884404":("cl_ct_ghl_sW0stBfkLKYhdRZgw0PM","Support"),
 "901113066906":("cl_ct_ghl_9VAWKaTs6TeRkp2AmoE3","Tasks"),
 "901113745786":("cl_ct_ghl_2wVd6pQCnHAFHHoSbDuO","Tasks"),
 "901113942896":("cl_ct_ghl_iTVkDTZiu38Qk4tdDBxv","Tasks"),
 "901112840809":("cl_ct_ghl_3LaF7qDpOs0zNI3ALHNF","Tasks"),
 "901112892624":("cl_ct_ghl_7c9zJZssZ2cbPacbaLls","Tasks"),
 "901112837042":("cl_ct_ghl_V3yqjpK7hBGW4w6UkVDU","Tasks"),
 "901112837019":("cl_ct_ghl_3Doqlm4sa9ujopYAIPYJ","Tasks"),
 "901112837056":("cl_ct_ghl_mvQJj4PNkPQXgGoi7DMk","Tasks"),
 "901113723502":("cl_ct_ghl_CFcbk6WkgjpLRLae6ega","Nightingale"),
 "901112836949":("cl_ct_ghl_3UbFsGYHZPDZugZ96CtG","Tasks"),
 "901113675117":("cl_ct_ghl_CFcbk6WkgjpLRLae6ega","Parenting Time"),
 "901112836945":("cl_ct_ghl_MXXU1sDN1PHgSGdfutbr","Tasks"),
 "901113845374":("cl_ct_ghl_XaIfK69d7LdVZ5QGdvSM","Tasks"),
 # ClickUpLocal internal ops -> Workspace container (no contact). Lincoln/Tracy
 # deliberately excluded — those are territory regions for a later feature.
 "901100555657":("cl_workspace","Administration"),
 "901113565054":("cl_workspace","For Businesses"),
 "901113346714":("cl_workspace","Idea board"),
 "901114074489":("cl_workspace","Social Media"),
}

def sb(path, method="GET", body=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(SB+"/rest/v1/"+path, data=data, headers=SBH, method=method)
    with urllib.request.urlopen(req) as r: 
        t=r.read()
        return json.loads(t) if t else None
def cu(path):
    req=urllib.request.Request("https://api.clickup.com/api/v2/"+path, headers={"Authorization":CU})
    with urllib.request.urlopen(req) as r: return json.load(r)
def nid(p): return p+secrets.token_hex(6)
def ms2date(v):
    if not v: return None
    return time.strftime("%Y-%m-%d", time.localtime(int(v)/1000))
def ms2iso(v):
    if not v: return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(v)/1000))
def mstatus(st):
    if not st: return "todo"
    nm=(st.get("status") or "").lower(); ty=(st.get("type") or "").lower()
    if ty=="closed" or nm in ("complete","completed","done","closed"): return "done"
    if "progress" in nm: return "in_progress"
    if "review" in nm or "approv" in nm: return "review"
    return "todo"
def mprio(p):
    nm=(p or {}).get("priority") if isinstance(p,dict) else None
    return {"urgent":"urgent","high":"high","normal":"medium","low":"low"}.get((nm or "").lower(),"none")

# preload state
clients={c["id"]:c for c in sb("clients?select=id,name")}
_ids=",".join(cid[3:] for cid in NEW)
contacts={c["id"]:c for c in sb("contacts?select=id,name&id=in.("+_ids+")")}
projects=sb("projects?select=id,client_id,name")
proj_by={} 
for p in projects: proj_by[(p["client_id"],p["name"])]=p["id"]
seen={t["clickup_task_id"] for t in sb("tasks?select=clickup_task_id&clickup_task_id=not.is.null") if t.get("clickup_task_id")}

new_tasks=[]; created_clients=[]; created_projects=[]; summary=[]
def ensure_client(cid):
    if cid in clients: return
    label,assign=NEW.get(cid,("",None))
    contact_app_id=cid[3:]
    nm=NAMES.get(cid) or (contacts.get(contact_app_id) or {}).get("name") or label or "Client"
    nm=" ".join(w.capitalize() for w in nm.split())
    row={"id":cid,"name":nm,"color":"#a855f7","ghl_location_id":label,"status":"active_client","type":"client","assigned_to":([assign] if assign else []),"linked_contact_id":None}
    created_clients.append((cid,nm,label,assign))
    if COMMIT: sb("clients","POST",[row])
    clients[cid]={"id":cid,"name":nm}
def ensure_project(cid,name):
    key=(cid,name)
    if key in proj_by: return proj_by[key]
    pid=nid("p_")
    created_projects.append((cid,name,pid))
    if COMMIT: sb("projects","POST",[{"id":pid,"client_id":cid,"name":name,"description":""}])
    proj_by[key]=pid
    return pid

for lst,(cid,pname) in MAP.items():
    ensure_client(cid)
    pid=ensure_project(cid,pname)
    contact_app_id=cid[3:] if cid.startswith("cl_ct_") else None
    page=0; tasks=[]
    while True:
        d=cu(f"list/{lst}/task?include_closed=true&subtasks=false&page={page}")
        tasks+=d["tasks"]
        if d.get("last_page") or not d["tasks"]: break
        page+=1
    new=0; dup=0
    for t in tasks:
        if t["id"] in seen: dup+=1; continue
        seen.add(t["id"])
        subs=[]
        for cl in (t.get("checklists") or []):
            for it in (cl.get("items") or []):
                subs.append({"id":nid("s_"),"title":it.get("name") or "","done":bool(it.get("resolved"))})
        aname=(t["assignees"][0]["username"].lower() if t.get("assignees") else "")
        desc=(t.get("description") or "").strip()
        desc=(desc+"\n\n" if desc else "")+f"Imported from ClickUp: {t.get('url','')}"
        row={"id":nid("t_"),"project_id":pid,"client_id":cid,"title":t["name"] or "(untitled)","description":desc,
             "status":mstatus(t.get("status")),"priority":mprio(t.get("priority")),
             "assignee_id":ASSIGN.get(aname),"contact_id":contact_app_id,"due":ms2date(t.get("due_date")),
             "recurrence":"none","ghl_task_id":None,"label_ids":[],"subtasks":subs,"attachments":[],"comments":[],
             "is_private":False,"delegated_to":[],"clickup_task_id":t["id"],"created_at":ms2iso(t.get("date_created"))}
        new_tasks.append(row); new+=1
    summary.append((clients[cid]["name"],pname,len(tasks),new,dup))

# write tasks in batches
if COMMIT and new_tasks:
    for i in range(0,len(new_tasks),50):
        sb("tasks","POST",new_tasks[i:i+50])

print(f"{'=== COMMITTED ===' if COMMIT else '=== DRY RUN (no writes) ==='}")
print(f"new clients: {len(created_clients)}  new projects: {len(created_projects)}  tasks to insert: {len(new_tasks)}")
print("\nnew clients:")
for cid,nm,label,assign in created_clients: print(f"  {nm}  ({label or 'no company'}){'  [assigned Justin]' if assign else ''}")
print("\nper-list (client / project : total / NEW / dup):")
for nm,pn,tot,new,dup in summary: print(f"  {nm:22} / {pn:40} : {tot:3} / {new:3} / {dup}")
