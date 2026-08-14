import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const LOCAL_UPDATED_KEY = "myVocabularyLocalUpdatedAt_v5_2";
const LAST_SYNC_KEY = "myVocabularyLastCloudSync_v5_2";

const configured =
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.startsWith("YOUR_") &&
  !SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_");

const OFFLINE_AUTH_KEY = "myVocabularyOfflineAuthorization_v5_2";
const OFFLINE_READY_KEY = "myVocabularyOfflineAssetsReady_v5_2";
const OFFLINE_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FSRS_ASSET_URL = "https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm";
const SUPABASE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let createClient = null;
let supabase = null;
let currentUser = null;
let approved = false;
let suppressLocalEvent = false;
let syncTimer = null;

function $(id){ return document.getElementById(id); }
function esc(s=""){
  return String(s).replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}
function nowISO(){ return new Date().toISOString(); }
function setLocalUpdated(ts=nowISO()){ localStorage.setItem(LOCAL_UPDATED_KEY, ts); }
function getLocalUpdated(){ return localStorage.getItem(LOCAL_UPDATED_KEY) || "1970-01-01T00:00:00.000Z"; }
function setLastSync(ts){ localStorage.setItem(LAST_SYNC_KEY, ts); renderCloudStatus(); }
function getLastSync(){ return localStorage.getItem(LAST_SYNC_KEY) || ""; }

function gate(mode){
  const usable = mode==="unlocked" || mode==="offline";
  document.body.classList.toggle("invite-unlocked", usable);
  document.body.classList.toggle("invite-locked", !usable);
  document.body.classList.toggle("offline-study-mode", mode==="offline");

  const login=$("inviteLoginArea"), checking=$("inviteChecking"), denied=$("inviteDenied");
  if(login) login.style.display = mode==="login" ? "block" : "none";
  if(checking) checking.style.display = mode==="checking" ? "block" : "none";
  if(denied) denied.style.display = mode==="denied" ? "block" : "none";

  if(mode==="offline"){
    // Force the only network-free feature: local vocabulary review.
    const studyTab=document.querySelector('.tab[data-tab="study"]');
    if(studyTab) studyTab.click();
  }
}

function inviteMessage(text,type="ok"){
  const el=$("inviteMessage");
  if(el) el.innerHTML=`<span class="${type}">${esc(text)}</span>`;
}


function saveOfflineAuthorization(){
  if(!currentUser?.email) return;
  localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify({
    email: currentUser.email,
    authorized_at: new Date().toISOString()
  }));
}

function readOfflineAuthorization(){
  try{
    const v=JSON.parse(localStorage.getItem(OFFLINE_AUTH_KEY) || "null");
    if(!v?.email || !v?.authorized_at) return null;
    const age=Date.now()-new Date(v.authorized_at).getTime();
    if(!Number.isFinite(age) || age<0 || age>OFFLINE_AUTH_TTL_MS) return null;
    return v;
  }catch{
    return null;
  }
}

function hasLocalCards(){
  try{
    const state=window.VocabApp?.exportState?.();
    return Array.isArray(state?.cards) && state.cards.length>0;
  }catch{
    return false;
  }
}

function enterOfflineStudy(reason=""){
  const auth=readOfflineAuthorization();
  const ready=localStorage.getItem(OFFLINE_READY_KEY)==="1";

  if(!auth){
    gate("login");
    inviteMessage(
      "オフライン利用には、30日以内にこの端末で一度オンライン認証が必要です。",
      "warn"
    );
    return false;
  }
  if(!ready){
    gate("login");
    inviteMessage(
      "この端末はオフライン準備が完了していません。オンラインでログイン後、「オフラインテストを準備」を実行してください。",
      "warn"
    );
    return false;
  }
  if(!hasLocalCards()){
    gate("login");
    inviteMessage(
      "この端末に復習用カードが保存されていません。オンラインで一度同期してください。",
      "warn"
    );
    return false;
  }

  currentUser={email:auth.email,id:"offline-local"};
  approved=true;
  gate("offline");
  return true;
}

async function ensureSupabaseModule(){
  if(createClient) return true;
  if(!navigator.onLine) return false;
  try{
    const mod=await import(SUPABASE_MODULE_URL);
    createClient=mod.createClient;
    return typeof createClient==="function";
  }catch(e){
    console.error("Supabase module load failed",e);
    return false;
  }
}

async function prepareOfflineAssets(){
  if(!navigator.onLine){
    cloudMessage("オフライン準備はオンライン時に実行してください。","warn");
    return;
  }
  if(!currentUser || !approved){
    cloudMessage("ログイン・許可確認後に実行してください。","warn");
    return;
  }

  cloudMessage("オフライン用ファイルを保存しています…");

  try{
    if(!("caches" in window)){
      throw new Error("このブラウザはCache Storageに対応していません。");
    }
    if("serviceWorker" in navigator){
      await navigator.serviceWorker.ready;
    }

    const cache=await caches.open("my-vocab-offline-v5-2");
    const localAssets=[
      "./","./index.html","./cloud-sync.js","./config.js",
      "./manifest.webmanifest","./service-worker.js",
      "./icon-192.png","./icon-512.png"
    ];

    for(const asset of localAssets){
      const req=new Request(new URL(asset,location.href).href,{cache:"reload"});
      const response=await fetch(req);
      if(!response.ok) throw new Error(`${asset} の保存に失敗しました。`);
      await cache.put(req,response.clone());
    }

    const fsrsRequest=new Request(FSRS_ASSET_URL,{mode:"cors",cache:"reload"});
    const fsrsResponse=await fetch(fsrsRequest);
    if(!fsrsResponse.ok) throw new Error("FSRSライブラリの保存に失敗しました。");
    await cache.put(fsrsRequest,fsrsResponse.clone());

    localStorage.setItem(OFFLINE_READY_KEY,"1");
    saveOfflineAuthorization();

    const el=$("offlineReadyStatus");
    if(el) el.innerHTML='<span class="ok">✓ 準備完了。ネットを切っても単語テストできます。</span>';
    cloudMessage("オフラインテストの準備が完了しました。");
  }catch(e){
    console.error(e);
    const el=$("offlineReadyStatus");
    if(el) el.innerHTML=`<span class="err">${esc(e.message)}</span>`;
    cloudMessage(`オフライン準備エラー: ${e.message}`,"err");
  }
}

function injectSettingsUI(){
  const settings=document.getElementById("settings");
  if(!settings) return;

  const cloud=document.createElement("div");
  cloud.className="box";
  cloud.style.marginTop="14px";
  cloud.innerHTML=`
    <h2 style="margin-top:0">アカウント / 同期 <span class="badge">Invite-only</span></h2>
    <div class="quick-note">
      <b id="cloudUser">—</b>
      <div class="help" id="cloudLastSync"></div>
    </div>
    <div class="actions">
      <button class="btn primary" id="cloudSyncNow">今すぐ同期</button>
      <button class="btn" id="cloudPush">この端末 → クラウド</button>
      <button class="btn" id="cloudPull">クラウド → この端末</button>
      <button class="btn bad" id="cloudLogout">ログアウト</button>
    </div>
    <p class="help">
      アクセス権はSupabaseの approved_users で管理されます。管理者が許可を外すと、
      次回オンライン時の権限確認から利用できなくなります。
    </p>

    <div class="offline-ready">
      <b>通信なしで単語テスト</b>
      <p class="help">
        この端末へアプリ本体・FSRSを保存します。一度準備すれば、
        ネットを切った状態でも「復習」だけ利用できます。
      </p>
      <button class="btn primary" id="prepareOfflineBtn">オフラインテストを準備</button>
      <div id="offlineReadyStatus" class="status"></div>
    </div>

    <div id="cloudMessage" class="status"></div>
  `;
  settings.appendChild(cloud);

  $("cloudSyncNow").onclick=()=>smartSync(true);
  $("cloudPush").onclick=async()=>{
    if(confirm("この端末の内容でクラウドを上書きしますか？")) await pushState(true);
  };
  $("cloudPull").onclick=async()=>{
    if(confirm("クラウドの内容でこの端末を置き換えますか？")) await pullState(true);
  };
  $("cloudLogout").onclick=logout;
  $("prepareOfflineBtn").onclick=prepareOfflineAssets;
  if(localStorage.getItem(OFFLINE_READY_KEY)==="1"){
    $("offlineReadyStatus").innerHTML='<span class="ok">✓ この端末はオフラインテスト準備済みです。</span>';
  }
  renderCloudStatus();
}

function cloudMessage(text,type="ok"){
  const el=$("cloudMessage");
  if(el) el.innerHTML=`<span class="${type}">${esc(text)}</span>`;
}

function renderCloudStatus(){
  if($("cloudUser")) $("cloudUser").textContent=currentUser?.email || "—";
  if($("cloudLastSync")){
    const s=getLastSync();
    $("cloudLastSync").textContent=s ? `最終同期: ${new Date(s).toLocaleString("ja-JP")}` : "まだ同期していません";
  }
}

async function isApprovedUser(){
  if(!navigator.onLine || !currentUser || !supabase) return false;
  const {data,error}=await supabase
    .from("approved_users")
    .select("email")
    .eq("email", currentUser.email)
    .maybeSingle();

  if(error){
    console.error("approval check failed",error);
    return false;
  }
  return !!data;
}

async function authorizeSession(){
  gate("checking");
  if(!currentUser){
    approved=false;
    gate("login");
    return false;
  }

  approved=await isApprovedUser();
  if(!approved){
    gate("denied");
    return false;
  }

  saveOfflineAuthorization();
  gate("unlocked");
  renderCloudStatus();
  return true;
}

async function login(){
  if(!configured) return;
  if(!navigator.onLine){
    inviteMessage("ログインにはインターネット接続が必要です。","warn");
    return;
  }
  if(!supabase){
    await initializeOnline();
  }
  if(!supabase){
    inviteMessage("認証サービスへ接続できません。","err");
    return;
  }
  const email=$("inviteEmail").value.trim();
  if(!email) return inviteMessage("メールアドレスを入力してください。","err");

  inviteMessage("ログインリンクを送信しています…");
  const redirectTo=location.origin+location.pathname;

  // Critical invite-only behavior:
  // shouldCreateUser:false prevents magic-link login from silently creating
  // a brand-new user account.
  const {error}=await supabase.auth.signInWithOtp({
    email,
    options:{
      shouldCreateUser:false,
      emailRedirectTo:redirectTo
    }
  });

  if(error){
    // Avoid revealing whether a specific email is registered.
    console.error(error);
    return inviteMessage(
      "ログインリンクを送信できませんでした。招待済みのメールアドレスか確認してください。",
      "err"
    );
  }
  inviteMessage("メールを確認して、ログインリンクを開いてください。");
}

async function logout(){
  if(!supabase) return;
  await supabase.auth.signOut();
  currentUser=null;
  approved=false;
  localStorage.removeItem(OFFLINE_AUTH_KEY);
  gate("login");
}

async function fetchRemote(){
  if(!currentUser || !approved) return null;
  const {data,error}=await supabase
    .from("vocab_state")
    .select("state,updated_at")
    .eq("user_id",currentUser.id)
    .maybeSingle();
  if(error) throw error;
  return data;
}

async function pushState(force=false){
  if(!currentUser || !approved) return;
  const state=window.VocabApp?.exportState();
  if(!state) throw new Error("App state is not available.");

  const payload={
    user_id:currentUser.id,
    state,
    client_updated_at:getLocalUpdated(),
    updated_at:nowISO()
  };

  const {data,error}=await supabase
    .from("vocab_state")
    .upsert(payload,{onConflict:"user_id"})
    .select("updated_at")
    .single();

  if(error){
    // Access may have been revoked since last UI check.
    await recheckAfterAccessError(error);
    throw error;
  }

  setLastSync(data?.updated_at || nowISO());
  if(force) cloudMessage("この端末のデータをクラウドへ保存しました。");
}

async function pullState(force=false){
  if(!currentUser || !approved) return false;
  const remote=await fetchRemote();
  if(!remote?.state){
    if(force) cloudMessage("クラウド側にデータがありません。","warn");
    return false;
  }

  suppressLocalEvent=true;
  try{
    window.VocabApp.importState(remote.state);
    setLocalUpdated(remote.updated_at || nowISO());
    setLastSync(remote.updated_at || nowISO());
  }finally{
    setTimeout(()=>{suppressLocalEvent=false},100);
  }
  if(force) cloudMessage("クラウドのデータをこの端末へ読み込みました。");
  return true;
}

async function smartSync(forceMessage=false){
  if(!navigator.onLine || !currentUser || !approved || !supabase) return;
  try{
    if(forceMessage) cloudMessage("同期中…");

    // Re-check authorization on every explicit/initial sync.
    approved=await isApprovedUser();
    if(!approved){
      gate("denied");
      return;
    }

    const remote=await fetchRemote();
    if(!remote){
      await pushState();
      if(forceMessage) cloudMessage("初回データをクラウドへ保存しました。");
      return;
    }

    const localTime=new Date(getLocalUpdated()).getTime();
    const remoteTime=new Date(remote.updated_at || 0).getTime();

    if(remoteTime > localTime + 1000){
      await pullState();
      if(forceMessage) cloudMessage("クラウドの新しいデータを読み込みました。");
    }else if(localTime > remoteTime + 1000){
      await pushState();
      if(forceMessage) cloudMessage("この端末の新しいデータをクラウドへ保存しました。");
    }else{
      setLastSync(remote.updated_at || nowISO());
      if(forceMessage) cloudMessage("同期済みです。");
    }
  }catch(e){
    console.error(e);
    cloudMessage(`同期エラー: ${e.message}`,"err");
  }
}

async function recheckAfterAccessError(error){
  console.error("data access error",error);
  approved=await isApprovedUser();
  if(!approved) gate("denied");
}

function schedulePush(){
  if(suppressLocalEvent) return;
  setLocalUpdated();

  // In offline-test mode, ratings are stored locally only.
  if(!navigator.onLine || document.body.classList.contains("offline-study-mode")) return;
  if(!currentUser || !approved) return;

  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{
    pushState().catch(e=>{
      console.error(e);
      cloudMessage("自動同期に失敗しました。権限または通信状態を確認してください。","err");
    });
  },1200);
}

async function initialize(){
  injectSettingsUI();

  $("inviteLoginBtn").onclick=login;
  $("inviteEmail").addEventListener("keydown",e=>{
    if(e.key==="Enter"){ e.preventDefault(); login(); }
  });
  $("inviteDeniedLogout").onclick=logout;

  if(!configured){
    $("inviteConfigError").innerHTML=
      '<span class="err">管理者設定が未完了です。config.js にSupabaseのURLとPublishable keyを設定してください。</span>';
    $("inviteLoginArea").style.display="none";
    gate("login");
    return;
  }

  // Truly offline startup: do not load Supabase or call any remote endpoint.
  if(!navigator.onLine){
    enterOfflineStudy("startup-offline");
    window.addEventListener("vocab-data-changed",schedulePush);
    window.addEventListener("online",()=>initializeOnline().catch(console.error),{once:true});
    return;
  }

  await initializeOnline();
  window.addEventListener("vocab-data-changed",schedulePush);

  window.addEventListener("offline",()=>{
    // If connectivity disappears while studying, continue locally.
    if(currentUser && approved && readOfflineAuthorization() && localStorage.getItem(OFFLINE_READY_KEY)==="1"){
      gate("offline");
    }
  });

  window.addEventListener("online",()=>{
    initializeOnline().catch(e=>console.error("reconnect failed",e));
  });
}

async function initializeOnline(){
  if(!navigator.onLine) return enterOfflineStudy("offline");

  const loaded=await ensureSupabaseModule();
  if(!loaded){
    // If CDN/network is temporarily unavailable, fall back to local study if possible.
    return enterOfflineStudy("supabase-module-unavailable");
  }

  if(!supabase){
    supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
      auth:{
        persistSession:true,
        autoRefreshToken:true,
        detectSessionInUrl:true
      }
    });

    supabase.auth.onAuthStateChange(async(event,session)=>{
      currentUser=session?.user || null;

      if(!currentUser){
        approved=false;
        gate("login");
        return;
      }

      if(["SIGNED_IN","INITIAL_SESSION","TOKEN_REFRESHED","USER_UPDATED"].includes(event)){
        if(await authorizeSession()){
          await smartSync(false);
        }
      }
    });
  }

  const {data:{session}}=await supabase.auth.getSession();
  currentUser=session?.user || null;

  if(!localStorage.getItem(LOCAL_UPDATED_KEY)) setLocalUpdated();

  if(await authorizeSession()){
    await smartSync(false);
  }

  // Re-check approval while online. Offline mode deliberately cannot know
  // about revocation until connectivity returns.
  if(!window.__vocabApprovalTimer){
    window.__vocabApprovalTimer=setInterval(async()=>{
      if(!navigator.onLine || !currentUser || !approved) return;
      const ok=await isApprovedUser();
      if(!ok){
        approved=false;
        localStorage.removeItem(OFFLINE_AUTH_KEY);
        gate("denied");
      }else{
        saveOfflineAuthorization();
      }
    },5*60*1000);
  }
}

initialize().catch(e=>{
  console.error(e);
  $("inviteConfigError").innerHTML=`<span class="err">認証初期化エラー: ${esc(e.message)}</span>`;
  gate("login");
});
