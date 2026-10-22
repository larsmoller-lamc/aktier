// Aktier – app-logik (auth, Firestore, gennemsnitsmetoden, UI)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const docRoot = db.collection(ROOT).doc("portfolio");
const colTrades = docRoot.collection("trades");

const $ = s => document.querySelector(s);
const fmt0 = new Intl.NumberFormat("da-DK",{maximumFractionDigits:0});
const fmt2 = new Intl.NumberFormat("da-DK",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtP = n => (n>=1000?fmt0:fmt2).format(n);
const sign = n => (n>0?"+":"")+fmt0.format(n);
const cls = n => n>0?"gain":(n<0?"loss":"");
const fmtDate = d => { const [y,m,dd]=d.split("-"); return `${dd}.${m}.${y}`; };
const thisYear = new Date().getFullYear();

let trades = [];          // {id, seq, date, depot, paper, ccy, type, qty, price, fee, fx, amount, source, note, nordnetId}
let prices = { papers:{}, fx:{USD:6.7,EUR:7.46,SEK:0.69,NOK:0.65,GBP:8.6,DKK:1}, updated:null };
let year = thisYear;
let calc = null;

/* ---------- auth ---------- */
$("#btnLogin").onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e=>{$("#gateMsg").textContent=e.message;});
auth.onAuthStateChanged(async u => {
  if (!u) { $("#gate").classList.remove("hide"); $("#app").classList.add("hide"); $("#actions").classList.add("hide"); $("#who").textContent=""; return; }
  if (u.email !== ALLOWED_EMAIL) { $("#gateMsg").textContent = `${u.email} har ikke adgang.`; auth.signOut(); return; }
  $("#who").innerHTML = `${u.email} · <a href="#" id="lnkOut" style="color:var(--muted)">log ud</a>`;
  $("#lnkOut").onclick = e => { e.preventDefault(); auth.signOut(); };
  $("#gate").classList.add("hide"); $("#app").classList.remove("hide"); $("#actions").classList.remove("hide");
  listen();
});

function listen(){
  docRoot.onSnapshot(s => { if (s.exists && s.data().prices) prices = Object.assign(prices, s.data().prices); render(); });
  colTrades.onSnapshot(async s => {
    trades = s.docs.map(d => ({ id:d.id, ...d.data() }));
    if (!trades.length && SEED.length && !s.metadata.fromCache) { await seedData(); return; }
    render();
  });
}
async function seedData(){
  if (!confirm(`Databasen er tom. Importér ${SEED.length} handler fra Excel + Nordnet som startdata?`)) return;
  const chunks = []; for (let i=0;i<SEED.length;i+=400) chunks.push(SEED.slice(i,i+400));
  for (const c of chunks){ const b = db.batch(); c.forEach(t => b.set(colTrades.doc(), t)); await b.commit(); }
  toast("Startdata importeret");
}

/* ---------- beregning (gennemsnitsmetoden, på tværs af depoter) ---------- */
function compute(){
  const sorted = [...trades].sort((a,b)=> a.date===b.date ? (a.seq||0)-(b.seq||0) : a.date.localeCompare(b.date));
  const pos = {};  // paper -> {qty, cost, ccy}
  const perTrade = {}; // id -> {realized, avg}
  const byYear = {};   // year -> {paper -> realized}
  const byYearDepot = {};
  for (const t of sorted){
    const p = pos[t.paper] || (pos[t.paper] = {qty:0,cost:0,ccy:t.ccy});
    if (t.type==="buy"){ p.qty += t.qty; p.cost += -t.amount; perTrade[t.id]={avg:p.cost/p.qty}; }
    else {
      const avg = p.qty>0 ? p.cost/p.qty : 0;
      const cost = avg*t.qty, g = t.amount - cost;
      perTrade[t.id] = {realized:g, avg, warn: t.qty>p.qty+1e-9};
      p.qty -= t.qty; p.cost -= cost; if (p.qty<1e-9){p.qty=0;p.cost=0;}
      const y = t.date.slice(0,4);
      (byYear[y] ||= {})[t.paper] = (byYear[y][t.paper]||0) + g;
      (byYearDepot[y] ||= {})[t.depot] = (byYearDepot[y][t.depot]||0) + g;
    }
  }
  return {pos, perTrade, byYear, byYearDepot};
}

function fxOf(ccy){ return ccy==="DKK" ? 1 : (prices.fx[ccy] || 0); }
function positions(){
  const out = [];
  for (const [paper,p] of Object.entries(calc.pos)){
    if (p.qty<=0) continue;
    const pr = prices.papers[paper]; const fx = fxOf(p.ccy);
    const value = pr && fx ? p.qty*pr*fx : null;
    out.push({paper, qty:p.qty, cost:p.cost, avg:p.cost/p.qty, ccy:p.ccy, price:pr||null, fx, value, unreal: value==null?null:value-p.cost});
  }
  return out.sort((a,b)=> (b.value||b.cost)-(a.value||a.cost));
}

/* ---------- render ---------- */
function render(){
  calc = compute();
  const years = new Set(trades.map(t=>t.date.slice(0,4)).concat([String(thisYear)]));
  const ys = [...years].sort();
  $("#years").innerHTML = ys.map(y=>`<button class="${+y===year?'on':''}" data-y="${y}">${y}</button>`).join("");
  $("#years").querySelectorAll("button").forEach(b=> b.onclick=()=>{year=+b.dataset.y; render();});

  const real = calc.byYear[year] || {};
  const realized = Object.values(real).reduce((a,b)=>a+b,0);
  const pos = positions();
  const isCurrent = year===thisYear;
  const unreal = pos.some(p=>p.unreal==null) ? null : pos.reduce((a,p)=>a+p.unreal,0);
  const value = pos.reduce((a,p)=>a+(p.value??p.cost),0);
  const total = isCurrent && unreal!=null ? realized+unreal : realized;

  $("#heroLab").textContent = isCurrent ? `Resultat ${year} indtil nu` : `Resultat ${year}`;
  $("#heroBig").textContent = sign(total); $("#heroBig").className = "big "+cls(total);
  $("#heroNote").textContent = isCurrent ? (unreal==null ? "Urealiseret mangler kurser" : "Realiseret + urealiseret på åbne positioner") : "Realiseret, gennemsnitsmetoden";
  $("#hRealized").textContent = sign(realized); $("#hRealized").className="sub "+cls(realized);
  const bd = calc.byYearDepot[year]||{}; $("#hRealizedNote").textContent = Object.entries(bd).map(([d,v])=>`${d} ${sign(v)}`).join(" · ");
  $("#hUnreal").textContent = unreal==null ? "—" : sign(unreal); $("#hUnreal").className="sub "+(unreal==null?"muted":cls(unreal));
  $("#hUnrealNote").textContent = prices.updated ? `Kurser pr. ${fmtDate(prices.updated)}` : "Ingen kurser indtastet";
  $("#hValue").textContent = fmt0.format(value); $("#hValue").className="sub";
  $("#hValueNote").textContent = pos.length ? `${pos.length} ${pos.length===1?"papir":"papirer"} · kostpris ${fmt0.format(pos.reduce((a,p)=>a+p.cost,0))}` : "Ingen åbne positioner";

  // positions
  $("#posMeta").textContent = "Nu, på tværs af depoter";
  $("#tblPos").innerHTML = pos.length ? `<thead><tr><th>Papir</th><th class="num">Antal</th><th class="num">Snit (DKK)</th><th class="num">Kostpris</th><th class="num">Kurs</th><th class="num">Værdi</th><th class="num">Urealiseret</th><th class="num">%</th></tr></thead><tbody>`+
    pos.map(p=>`<tr><td class="pap">${p.paper} <span class="tag">${p.ccy}</span></td><td class="num">${p.qty}</td><td class="num">${fmt2.format(p.avg)}</td><td class="num">${fmt0.format(p.cost)}</td><td class="num">${p.price?fmt2.format(p.price)+" "+p.ccy:'<span class="muted">—</span>'}</td><td class="num">${p.value==null?"—":fmt0.format(p.value)}</td><td class="num ${p.unreal==null?'':cls(p.unreal)}">${p.unreal==null?"—":sign(p.unreal)}</td><td class="num ${p.unreal==null?'':cls(p.unreal)}">${p.unreal==null?"—":(p.unreal/p.cost*100).toFixed(1)+" %"}</td></tr>`).join("")+
    `</tbody>` : `<tbody><tr><td colspan="8" class="empty">Ingen åbne positioner.</td></tr></tbody>`;

  // realized per paper
  $("#secRealH").textContent = `Realiseret ${year} pr. papir`;
  const rows = Object.entries(real).sort((a,b)=>b[1]-a[1]);
  $("#realMeta").textContent = rows.length ? `${rows.length} papirer` : "";
  $("#tblReal").innerHTML = rows.length ? `<thead><tr><th>Papir</th><th class="num">Realiseret</th></tr></thead><tbody>`+
    rows.map(([p,v])=>`<tr><td class="pap">${p}</td><td class="num ${cls(v)}">${sign(v)}</td></tr>`).join("")+
    `<tr class="total"><td>Aktieindkomst ${year}</td><td class="num ${cls(realized)}">${sign(realized)}</td></tr></tbody>` :
    `<tbody><tr><td class="empty">Ingen realiserede handler i ${year}.</td></tr></tbody>`;

  // trades of year
  const ty = trades.filter(t=>t.date.startsWith(String(year))).sort((a,b)=> a.date===b.date ? (b.seq||0)-(a.seq||0) : b.date.localeCompare(a.date));
  $("#secTradesH").textContent = `Handler ${year}`;
  $("#tradesMeta").textContent = `${ty.length} handler · ${ty.filter(t=>t.type==="sell").length} salg`;
  $("#tblTrades").innerHTML = ty.length ? `<thead><tr><th>Dato</th><th>Papir</th><th>Depot</th><th></th><th class="num">Antal</th><th class="num">Kurs</th><th class="num">Valutakurs</th><th class="num">Omk.</th><th class="num">Beløb DKK</th><th class="num">Snit v. salg</th><th class="num">Realiseret</th><th></th></tr></thead><tbody>`+
    ty.map(t=>{const r=calc.perTrade[t.id]||{}; return `<tr>
      <td>${fmtDate(t.date)}</td><td class="pap">${t.paper}${t.note?` <span class="muted" title="${t.note}">·</span>`:""}</td>
      <td><span class="tag ${t.depot==="Nordnet"?"nn":"db"}">${t.depot}</span></td>
      <td class="${t.type}">${t.type==="buy"?"Køb":"Salg"}</td>
      <td class="num">${t.qty}</td><td class="num">${fmtP(t.price)} ${t.ccy}</td><td class="num muted">${t.ccy==="DKK"?"":fmt2.format(t.fx)}</td>
      <td class="num muted">${fmt2.format(t.fee)}</td><td class="num">${fmt0.format(t.amount)}</td>
      <td class="num muted">${t.type==="sell"?fmt2.format(r.avg||0):""}</td>
      <td class="num ${t.type==="sell"?cls(r.realized):''}">${t.type==="sell"?sign(r.realized||0)+(r.warn?" ⚠":""):""}</td>
      <td><button class="ghost rowbtn" data-edit="${t.id}">Ret</button></td></tr>`;}).join("")+`</tbody>` :
    `<tbody><tr><td class="empty">Ingen handler i ${year}. Tilføj en, eller importér fra Nordnet.</td></tr></tbody>`;
  $("#tblTrades").querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=>openTrade(trades.find(t=>t.id===b.dataset.edit)));

  // all years
  const allYears = Object.keys(calc.byYear).sort();
  const papers = [...new Set(allYears.flatMap(y=>Object.keys(calc.byYear[y])))].sort();
  $("#tblYears").innerHTML = allYears.length ? `<thead><tr><th>Papir</th>${allYears.map(y=>`<th class="num">${y}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>`+
    papers.map(p=>{const vs=allYears.map(y=>calc.byYear[y][p]||0); const s=vs.reduce((a,b)=>a+b,0); return `<tr><td class="pap">${p}</td>${vs.map(v=>`<td class="num ${v?cls(v):'muted'}">${v?sign(v):"·"}</td>`).join("")}<td class="num ${cls(s)}">${sign(s)}</td></tr>`;}).join("")+
    `<tr class="total"><td>Total</td>${allYears.map(y=>{const s=Object.values(calc.byYear[y]).reduce((a,b)=>a+b,0);return `<td class="num ${cls(s)}">${sign(s)}</td>`;}).join("")}<td class="num">${(()=>{const s=allYears.reduce((a,y)=>a+Object.values(calc.byYear[y]).reduce((x,z)=>x+z,0),0);return `<span class="${cls(s)}">${sign(s)}</span>`})()}</td></tr></tbody>` : "";

  $("#papers").innerHTML = [...new Set(trades.map(t=>t.paper))].sort().map(p=>`<option value="${p}">`).join("");
}

/* ---------- trade dialog ---------- */
let editing = null, fType = "buy";
function setType(v){ fType=v; $("#segType").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.v===v)); recalc(); }
$("#segType").querySelectorAll("button").forEach(b=> b.onclick=()=>setType(b.dataset.v));
["#fQty","#fPrice","#fFx","#fFee","#fCcy"].forEach(s=> $(s).addEventListener("input",recalc));
$("#fPaper").addEventListener("change",()=>{ // guess ccy/fx from history
  const last=[...trades].reverse().find(t=>t.paper===$("#fPaper").value);
  if(last){ $("#fCcy").value=last.ccy; $("#fFx").value = last.ccy==="DKK"?1:(prices.fx[last.ccy]||last.fx); recalc(); }
});
$("#fCcy").addEventListener("change",()=>{ const c=$("#fCcy").value; $("#fFx").value = c==="DKK"?1:(prices.fx[c]||""); recalc(); });
function recalc(){
  const q=+$("#fQty").value||0, p=+$("#fPrice").value||0, fx=+$("#fFx").value||0, fee=+$("#fFee").value||0;
  const gross=q*p*fx; let net = fType==="buy" ? -(gross+fee) : gross-fee; if (Math.abs(net)<0.005) net=0;
  $("#fCcyLab").textContent = $("#fCcy").value;
  $("#calcVal").textContent = fmt2.format(net);
  if (!$("#fAmount").dataset.touched) $("#fAmount").value = net.toFixed(2);
}
$("#fAmount").addEventListener("input",()=>{$("#fAmount").dataset.touched="1";});
function openTrade(t){
  editing = t||null;
  $("#tradeTitle").textContent = t ? "Ret handel" : "Ny handel";
  $("#btnDelete").classList.toggle("hide",!t);
  $("#fDate").value = t?t.date:new Date().toISOString().slice(0,10);
  $("#fDepot").value = t?t.depot:"Nordnet";
  $("#fPaper").value = t?t.paper:""; $("#fCcy").value=t?t.ccy:"DKK";
  $("#fQty").value = t?t.qty:""; $("#fPrice").value = t?t.price:""; $("#fFx").value = t?t.fx:1; $("#fFee").value = t?t.fee:0;
  $("#fNote").value = t?.note||"";
  delete $("#fAmount").dataset.touched;
  setType(t?t.type:"buy");
  if (t){ $("#fAmount").value=t.amount; $("#fAmount").dataset.touched="1"; }
  $("#dlgTrade").showModal();
}
$("#btnNew").onclick = ()=>openTrade();
$("#btnCancel").onclick = ()=>$("#dlgTrade").close();
$("#formTrade").addEventListener("submit", async e=>{
  e.preventDefault();
  const t = { date:$("#fDate").value, depot:$("#fDepot").value, paper:$("#fPaper").value.trim(), ccy:$("#fCcy").value, type:fType,
    qty:+$("#fQty").value, price:+$("#fPrice").value, fee:+$("#fFee").value||0, fx:+$("#fFx").value||1, amount:+$("#fAmount").value,
    note:$("#fNote").value.trim(), source: editing?.source||"manual", nordnetId: editing?.nordnetId||null,
    seq: editing?.seq || (Math.max(0,...trades.map(x=>x.seq||0))+1) };
  if (t.type==="buy" && t.amount>0) t.amount=-t.amount;
  if (t.type==="sell" && t.amount<0) t.amount=-t.amount;
  try{ if (editing) await colTrades.doc(editing.id).set(t); else await colTrades.add(t); $("#dlgTrade").close(); toast(editing?"Handel rettet":"Handel gemt"); }
  catch(err){ alert("Kunne ikke gemme: "+err.message); }
});
$("#btnDelete").onclick = async ()=>{ if(editing && confirm("Slet denne handel?")){ await colTrades.doc(editing.id).delete(); $("#dlgTrade").close(); toast("Handel slettet"); } };

/* ---------- prices dialog ---------- */
function openPrices(){
  const pos = positions(); const ccys=[...new Set(pos.map(p=>p.ccy).filter(c=>c!=="DKK"))];
  $("#tblPrices").innerHTML = `<thead><tr><th>Papir</th><th class="num">Kurs</th></tr></thead><tbody>`+
    pos.map(p=>`<tr><td>${p.paper} <span class="tag">${p.ccy}</span></td><td class="num"><input type="number" step="0.01" data-paper="${p.paper}" value="${p.price??""}" placeholder="kurs"></td></tr>`).join("")+
    (ccys.length?`<tr><th colspan="2" style="padding-top:16px">Valutakurser</th></tr>`:"")+
    ccys.map(c=>`<tr><td>${c} i DKK</td><td class="num"><input type="number" step="0.0001" data-ccy="${c}" value="${prices.fx[c]??""}"></td></tr>`).join("")+`</tbody>`;
  $("#dlgPrices").showModal();
}
$("#btnPrices").onclick=$("#btnPrices2").onclick=openPrices;
$("#btnPricesCancel").onclick=()=>$("#dlgPrices").close();
$("#btnPricesSave").onclick=async()=>{
  const papers={...prices.papers}, fx={...prices.fx};
  $("#tblPrices").querySelectorAll("[data-paper]").forEach(i=>{ if(i.value) papers[i.dataset.paper]=+i.value; });
  $("#tblPrices").querySelectorAll("[data-ccy]").forEach(i=>{ if(i.value) fx[i.dataset.ccy]=+i.value; });
  const p={papers,fx,updated:new Date().toISOString().slice(0,10)};
  try{ await docRoot.set({prices:p},{merge:true}); $("#dlgPrices").close(); toast("Kurser gemt"); }catch(err){alert(err.message);}
};

/* ---------- Nordnet import ---------- */
const NN_NAMES = {"NVIDIA":"Nvidia","Rheinmetall":"Rheinmetall","Royal UNIBREW":"Royal Unibrew","Novo Nordisk B":"Novo Nordisk B"};
let pending=[];
$("#btnImport").onclick=()=>{ $("#fileImport").value=""; $("#importPreview").innerHTML=""; $("#btnImportGo").classList.add("hide"); $("#dlgImport").showModal(); };
$("#btnImportCancel").onclick=()=>$("#dlgImport").close();
$("#fileImport").addEventListener("change", async e=>{
  const f=e.target.files[0]; if(!f) return;
  const buf=await f.arrayBuffer(); const u8=new Uint8Array(buf);
  let text = (u8[0]===0xFF&&u8[1]===0xFE)||(u8[0]===0xFE&&u8[1]===0xFF) ? new TextDecoder("utf-16").decode(buf) : new TextDecoder("utf-8").decode(buf);
  const lines=text.split(/\r?\n/).filter(l=>l.trim()); const sep=lines[0].includes("\t")?"\t":";";
  const head=lines[0].split(sep).map(h=>h.trim());
  const idx=n=>head.indexOf(n); const num=s=>parseFloat(String(s).replace(/\s/g,"").replace(",","."))||0;
  const existing=new Set(trades.map(t=>t.nordnetId).filter(Boolean));
  const names={}; trades.forEach(t=>{ names[t.paper.toLowerCase()]=t.paper; });
  const valIdx=head.map((h,i)=>h==="Valuta"?i:-1).filter(i=>i>=0); const ccyIdx = valIdx.length>=4 ? valIdx[3] : -1; // 4. "Valuta" = papirets valuta
  pending=[]; let dup=0, skipped=0;
  for (const line of lines.slice(1)){
    const c=line.split(sep); const typ=c[idx("Transaktionstype")];
    if (typ!=="KØBT"&&typ!=="SOLGT"){skipped++;continue;}
    const id=+c[idx("Id")]; if(existing.has(id)){dup++;continue;}
    const raw=c[idx("Værdipapirer")].trim(); const paper=NN_NAMES[raw]||names[raw.toLowerCase()]||raw;
    const fx=num(c[idx("Vekslingskurs")])||1;
    pending.push({date:c[idx("Handelsdag")],depot:"Nordnet",paper,ccy:(ccyIdx>=0&&c[ccyIdx]?c[ccyIdx].trim():"DKK"),type:typ==="KØBT"?"buy":"sell",qty:num(c[idx("Antal")]),price:num(c[idx("Kurs")]),fee:num(c[idx("Samlede afgifter")]),fx,amount:num(c[idx("Beløb")]),source:"nordnet",note:"",nordnetId:id});
  }
  pending.sort((a,b)=>a.date.localeCompare(b.date)||a.nordnetId-b.nordnetId);
  let seq=Math.max(0,...trades.map(x=>x.seq||0)); pending.forEach(p=>p.seq=++seq);
  $("#importPreview").innerHTML = `<p>${pending.length} nye handler · ${dup} allerede i databasen · ${skipped} øvrige posteringer ignoreret.</p>`+
    (pending.length?`<div class="tablewrap" style="max-height:260px;overflow:auto"><table><tbody>${pending.map(p=>`<tr><td>${fmtDate(p.date)}</td><td>${p.paper}</td><td>${p.type==="buy"?"Køb":"Salg"}</td><td class="num">${p.qty}</td><td class="num">${fmtP(p.price)} ${p.ccy}</td><td class="num">${fmt0.format(p.amount)}</td></tr>`).join("")}</tbody></table></div>`:"");
  $("#btnImportGo").classList.toggle("hide",!pending.length);
});
$("#btnImportGo").onclick=async()=>{
  try{ const b=db.batch(); pending.forEach(p=>b.set(colTrades.doc(),p)); await b.commit(); $("#dlgImport").close(); toast(`${pending.length} handler importeret`); }
  catch(err){ alert("Import fejlede: "+err.message); }
};

/* ---------- misc ---------- */
let tt; function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("on"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("on"),2200); }
